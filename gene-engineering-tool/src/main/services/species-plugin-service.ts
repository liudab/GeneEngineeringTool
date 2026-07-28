/**
 * @module services/species-plugin-service
 * @description
 * 物种基因数据库插件服�?�?处理插件安装、数据导入、卸载等核心逻辑�?
 *
 * 核心职责�?
 * 1. 解压插件 zip 包到本地目录
 * 2. 读取 plugin.json 配置并写入数据库
 * 3. 解析 CSV 数据并批量导入基因注�?
 * 4. 插件卸载及数据清�?
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, copyFileSync, writeFileSync } from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { getDataDir } from '../db/base'
import * as speciesRepo from '../db/species-repo'
import * as geneRepo from '../db/gene-repo'
import * as geneFileService from './gene-file-service'
import type { SpeciesPluginSpec, DataSourceConfig } from '../../shared/types'
import { RXP_SAMPLE_LABELS } from './rxp-sample-labels'

/** 可重试的网络错误码 */
const RETRYABLE_ERRORS = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE'])
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

/** 简单的 HTTPS GET 请求，返回响应文本（支持 http/https、重定向、自动重试） */
function httpsGet(url: string, _retryCount = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      // 处理重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, _retryCount).then(resolve).catch(reject)
        return
      }
      // HTTP 5xx 服务器错误：可重试
      if (res.statusCode && res.statusCode >= 500 && _retryCount < MAX_RETRIES) {
        setTimeout(() => httpsGet(url, _retryCount + 1).then(resolve).catch(reject), RETRY_DELAY_MS * (_retryCount + 1))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        // 自动检测编码：从 meta charset 或 Content-Type 头判断是否为 GBK/GB2312
        const head = buf.slice(0, 1024).toString('ascii')
        const charsetMatch = head.match(/charset=["']?\s*([^"'\s;>]+)/i)
        const ctCharset = (res.headers['content-type'] || '').match(/charset=([^\s;]+)/i)
        const charset = ((charsetMatch && charsetMatch[1]) || (ctCharset && ctCharset[1]) || '').toLowerCase()
        if (charset.includes('gb2312') || charset.includes('gbk') || charset.includes('gb18030')) {
          resolve(new TextDecoder('gbk').decode(buf))
        } else {
          resolve(buf.toString('utf-8'))
        }
      })
    }).on('error', (err: NodeJS.ErrnoException) => {
      // 网络类错误：自动重试
      if (RETRYABLE_ERRORS.has(err.code || '') && _retryCount < MAX_RETRIES) {
        setTimeout(() => httpsGet(url, _retryCount + 1).then(resolve).catch(reject), RETRY_DELAY_MS * (_retryCount + 1))
        return
      }
      // 重试耗尽或不可重试错误：附加重试信息
      const msg = _retryCount > 0
        ? `网络请求失败（已重试 ${_retryCount} 次）：${err.message}`
        : err.message
      reject(new Error(msg))
    })
  })
}

// ============ 插件目录管理 ============

/** 获取插件存储目录 */
function getPluginsDir(): string {
  const dir = path.join(getDataDir(), 'species-plugins')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 启动时同步开发目录 plugin.json 到 APPDATA（仅开发模式有效）
 * 对比版本号，若开发目录版本更新则自动复制并更新数据库 fields_config
 */
export function syncDevPluginConfigs(): void {
  const devPluginsDir = path.join(process.cwd(), 'plugins')
  if (!existsSync(devPluginsDir)) return // 生产环境无 plugins 目录，跳过

  const appPluginsDir = getPluginsDir()
  const entries = readdirSync(devPluginsDir).filter(e => e.startsWith('species-'))

  for (const pluginName of entries) {
    const devConfigPath = path.join(devPluginsDir, pluginName, 'plugin.json')
    if (!existsSync(devConfigPath)) continue

    try {
      const devConfig = JSON.parse(readFileSync(devConfigPath, 'utf-8')) as SpeciesPluginSpec
      const appPluginDir = path.join(appPluginsDir, pluginName)
      const appConfigPath = path.join(appPluginDir, 'plugin.json')

      if (!existsSync(appConfigPath)) continue // APPDATA 中未安装该插件，跳过

      const appConfig = JSON.parse(readFileSync(appConfigPath, 'utf-8'))
      const devVer = devConfig.version || '0.0.0'
      const appVer = appConfig.version || '0.0.0'

      if (devVer !== appVer) {
        // 复制开发目录 plugin.json 到 APPDATA
        copyFileSync(devConfigPath, appConfigPath)
        // 更新数据库中的 fields_config
        const plugins = speciesRepo.getSpeciesPlugins()
        const dbPlugin = plugins.find(p => p.package_name === pluginName)
        if (dbPlugin) {
          speciesRepo.updateSpeciesPlugin(dbPlugin.id, {
            fields_config: JSON.stringify(devConfig.fieldDefinitions),
            mode: devConfig.mode,
            online_sources_config: JSON.stringify(devConfig.onlineSources || []),
            version: devVer
          } as any)
        }
        console.log(`[Plugin] Synced plugin.json from dev dir (${pluginName}: v${appVer} → v${devVer})`)
      } else {
        console.log(`[Plugin] plugin.json up-to-date (${pluginName}: v${appVer})`)
      }
    } catch (err) {
      console.warn(`[Plugin] Failed to sync ${pluginName}:`, err)
    }
  }
}

/** 获取指定插件的数据目�?*/
export function getPluginDataDir(pluginName: string): string {
  return path.join(getPluginsDir(), pluginName)
}

// ============ CSV 解析工具 ============

/** 解析 CSV 行（支持引号字段和换行） */
/**
 * 解析 CSV 内容，正确处理多行引号字段
 * CSV 规范：引号内可包含换行符、逗号、引号（用 "" 转义）
 */
function parseCSVContent(content: string): string[][] {
  const rows: string[][] = []
  let i = 0
  const len = content.length

  while (i < len) {
    const row: string[] = []
    let field = ''
    let inQuotes = false

    while (i < len) {
      const ch = content[i]

      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && content[i + 1] === '"') {
            field += '"'
            i += 2
          } else {
            inQuotes = false
            i++
          }
        } else {
          field += ch
          i++
        }
      } else {
        if (ch === '"') {
          inQuotes = true
          i++
        } else if (ch === ',') {
          row.push(field.trim())
          field = ''
          i++
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && i + 1 < len && content[i + 1] === '\n') {
            i++
          }
          row.push(field.trim())
          field = ''
          i++
          break
        } else {
          field += ch
          i++
        }
      }
    }

    if (i >= len && field.length > 0) {
      row.push(field.trim())
    }

    if (row.length > 1 || (row.length === 1 && row[0].length > 0)) {
      rows.push(row)
    }
  }

  return rows
}

/**
 * 清洗参考文献字段：将多行松散格式压缩为紧凑格式
 * 利用原始 \n\n 结构识别 authors / title / journal 边界
 */
function cleanReferences(raw: string): string {
  if (!raw) return raw

  // 预处理：将 "数字\n     \n     ." 合并为 "数字."
  let text = raw.replace(/(\d+)\s*\n\s*\n\s*\.\s*/g, '$1. ')

  // 按 "数字." 模式分割（不捕获，避免交替问题）
  const entries = text.split(/(?:^|\n)\s*\d+\.\s*/).filter(s => s.trim().length > 0)

  const formatted: string[] = []

  for (let i = 0; i < entries.length; i++) {
    const num = i + 1
    const entryText = entries[i].trim()
    if (!entryText) continue

    // 用 \n\n（空行）分割结构段落
    const chunks = entryText.split(/\n\s*\n/).map(s =>
      s.replace(/\s+/g, ' ').trim()
    ).filter(s => s.length > 0)

    // 识别 authors：包含分号的第一个 chunk
    let authors = ''
    let restChunks = chunks
    if (chunks.length > 0 && chunks[0].includes(';')) {
      authors = chunks[0].replace(/;\s*/g, ';')
      restChunks = chunks.slice(1)
    }

    // 合并剩余 chunk，定位年份以分离 title 和 journal
    const combined = restChunks.join(' ')
    const yearMatch = combined.match(/,\s*((?:19|20)\d{2})/)

    let title = combined
    let journal = ''

    if (yearMatch) {
      const yearIdx = yearMatch.index
      const afterYear = combined.substring(yearIdx + yearMatch[0].length)
      const beforeYear = combined.substring(0, yearIdx).trim()
      const words = beforeYear.split(/\s+/)
      const connectors = new Set(['in', 'of', 'the', 'and', '&'])
      let journalStart = words.length

      for (let j = words.length - 1; j >= 0; j--) {
        const w = words[j].replace(/[^a-zA-Z&]/g, '')
        if (!w) continue
        if (connectors.has(w.toLowerCase())) {
          journalStart = j
        } else if (w[0] === w[0].toUpperCase() && /[A-Z]/.test(w[0])) {
          journalStart = j
        } else {
          break
        }
      }

      // 处理 "Plant, Cell & Environment" 类型
      if (journalStart > 0) {
        const rawPrev = words[journalStart - 1]
        if (rawPrev.endsWith(',')) {
          const prevWord = rawPrev.replace(/[^a-zA-Z]/g, '')
          if (prevWord && prevWord[0] === prevWord[0].toUpperCase() && /[A-Z]/.test(prevWord[0])) {
            for (let j = journalStart - 1; j >= 0; j--) {
              const w = words[j].replace(/[^a-zA-Z&]/g, '')
              if (!w) { journalStart = j + 1; break }
              if (connectors.has(w.toLowerCase()) || (w[0] === w[0].toUpperCase() && /[A-Z]/.test(w[0]))) {
                journalStart = j
              } else {
                break
              }
            }
          }
        }
      }

      title = words.slice(0, journalStart).join(' ').trim()
      journal = words.slice(journalStart).join(' ') + yearMatch[0] + afterYear
      journal = journal.trim()
    }

    const parts: string[] = []
    if (authors) parts.push(authors + '.')
    if (title) parts.push(title + '.')
    if (journal) parts.push(journal)

    formatted.push(num + '.' + parts.join(' '))
  }

  // 全局后处理：修复括号/冒号周围多余空格（保留换行符）
  let result = formatted.join('\n')
  result = result.replace(/[^\S\n]*\([^\S\n]*/g, '(')
  result = result.replace(/[^\S\n]*\)[^\S\n]*/g, ')')
  result = result.replace(/[^\S\n]*:[^\S\n]*/g, ': ')
  result = result.replace(/\([^\S\n]+/g, '(')
  result = result.replace(/[^\S\n]+\)/g, ')')
  result = result.replace(/[^\S\n]+,/g, ',')
  result = result.replace(/,([^\s])/g, ', $1')
  result = result.replace(/\.[^\S\n]*\./g, '.')
  result = result.replace(/[^\S\n]+/g, ' ')
  return result
}

/** 解析 CSV 文件（处理大文件，支持多行引号字段） */
async function parseCSVStream(
  filePath: string,
  onRow: (fields: string[], rowIndex: number) => void,
  onProgress?: (processed: number, total: number) => void
): Promise<number> {
  return new Promise((resolve, reject) => {
    const content = readFileSync(filePath, 'utf-8')
    const cleanContent = content.replace(/^\uFEFF/, '')
    const allRows = parseCSVContent(cleanContent)
    const totalRows = allRows.length

    // 跳过表头（第一行）
    let processed = 0
    for (let i = 1; i < allRows.length; i++) {
      onRow(allRows[i], i)
      processed++

      if (onProgress && processed % 1000 === 0) {
        onProgress(processed, totalRows)
      }
    }

    resolve(processed)
  })
}

// ============ 插件安装 ============

/**
 * 安装物种插件
 * @param pluginDir 解压后的插件目录路径
 * @returns 插件配置信息
 */
export async function installPlugin(pluginDir: string): Promise<{ config: SpeciesPluginSpec; pluginId: number }> {
  // 读取 plugin.json
  const configPath = path.join(pluginDir, 'plugin.json')
  if (!existsSync(configPath)) {
    throw new Error('plugin.json not found in plugin directory')
  }

  const configText = readFileSync(configPath, 'utf-8')
  const config: SpeciesPluginSpec = JSON.parse(configText)

  // 验证配置
  if (!config.speciesName || !config.dataSources || config.dataSources.length === 0) {
    throw new Error('Invalid plugin.json: missing speciesName or dataSources')
  }

  // 复制到本地插件目�?
  const targetDir = getPluginDataDir(config.speciesName)
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  // 复制 plugin.json
  writeFileSync(path.join(targetDir, 'plugin.json'), configText, 'utf-8')

  // 复制 data 目录（如果存在）
  const srcDataDir = path.join(pluginDir, 'data')
  if (existsSync(srcDataDir)) {
    const targetDataDir = path.join(targetDir, 'data')
    if (!existsSync(targetDataDir)) mkdirSync(targetDataDir, { recursive: true })

    const { readdirSync, copyFileSync, statSync } = require('fs')
    const files = readdirSync(srcDataDir)
    for (const file of files) {
      const srcFile = path.join(srcDataDir, file)
      const targetFile = path.join(targetDataDir, file)
      if (statSync(srcFile).isFile()) {
        copyFileSync(srcFile, targetFile)
      }
    }
  }

  // 查找数据文件（CSV�?
  let dataFile = ''
  const dataDir = path.join(targetDir, 'data')
  if (existsSync(dataDir)) {
    const { readdirSync } = require('fs')
    const csvFiles = readdirSync(dataDir).filter((f: string) => f.endsWith('.csv'))
    if (csvFiles.length > 0) {
      dataFile = path.join('data', csvFiles[0])
    }
  }

  // 检查是否已存在同名插件（更新场景）
  const existing = speciesRepo.getSpeciesPlugins().find(p => p.species_name === config.speciesName)
  let pluginId: number

  if (existing) {
    // 更新已有插件：更新配�?
    speciesRepo.updateSpeciesPlugin(existing.id, {
      version: config.version || existing.version,
      data_file: dataFile,
      fields_config: JSON.stringify(config.fieldDefinitions || []),
      url_templates: JSON.stringify(config.urlTemplates || {}),
      mode: config.mode,
      online_sources_config: JSON.stringify(config.onlineSources || []),
    })
    pluginId = existing.id
    console.log(`[SpeciesPlugin] Updated plugin: ${config.speciesName} (id=${pluginId})`)
  } else {
    // 写入数据库（新建�?
    pluginId = speciesRepo.createSpeciesPlugin({
      species_name: config.speciesName,
      species_latin: config.speciesLatin || '',
      package_name: config.name || '',
      version: config.version || '1.0.0',
      data_file: dataFile,
      fields_config: JSON.stringify(config.fieldDefinitions || []),
      url_templates: JSON.stringify(config.urlTemplates || {}),
      enabled: true,
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      mode: config.mode || 'offline',
      online_sources_config: JSON.stringify(config.onlineSources || [])
    })
    console.log(`[SpeciesPlugin] Installed plugin: ${config.speciesName} (id=${pluginId})`)
  }

  return { config, pluginId }
}

// ============ 数据导入 ============

/**
 * 导入插件�?CSV 数据
 * @param pluginId 插件 ID
 * @param onProgress 进度回调
 * @returns 导入的注释数�?
 */
export async function importPluginData(
  pluginId: number,
  onProgress?: (message: string, percent: number) => void
): Promise<{ imported: number; matched: number }> {
  const plugin = speciesRepo.getSpeciesPlugin(pluginId)
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)

  const pluginDir = getPluginDataDir(plugin.species_name)
  const dataFilePath = path.join(pluginDir, plugin.data_file)

  if (!existsSync(dataFilePath)) {
    throw new Error(`Data file not found: ${dataFilePath}`)
  }

  // 读取 plugin.json 配置
  const configPath = path.join(pluginDir, 'plugin.json')
  const configText = readFileSync(configPath, 'utf-8')
  const config: SpeciesPluginSpec = JSON.parse(configText)

  onProgress?.('正在解析 CSV 文件...', 10)

  const annotationRows: Array<{
    source_database: string
    source_accession: string
    ncbi_gene_id: string
    gene_symbol: string
    gene_name: string
    annotation_data: string
    external_links: string
  }> = []

  // 流式解析 CSV
  await parseCSVStream(
    dataFilePath,
    (fields, rowIndex) => {
      // 对每�?data source 生成注释记录
      for (const source of config.dataSources) {
        const accession = fields[source.csvColumn]
        if (!accession || accession.trim().length === 0) continue

        // 提取 NCBI Gene ID（去�?LOC 前缀�?
        let ncbiGeneId = ''
        if (source.ncbiColumn !== undefined && source.ncbiColumn < fields.length) {
          const rawNcbiId = fields[source.ncbiColumn] || ''
          ncbiGeneId = rawNcbiId.replace(/^LOC/i, '').trim()
        }

        // 提取导入列数�?
        const annotationData: Record<string, string> = {}
        const externalLinks: Record<string, string> = {}

        for (const col of source.importColumns) {
          if (col.csvColumn < fields.length) {
            const value = fields[col.csvColumn] || ''
            if (col.fieldType === 'link') {
              externalLinks[col.fieldName] = value
            } else if (col.fieldName === 'references') {
              // 参考文献字段专门清洗格式
              annotationData[col.fieldName] = cleanReferences(value)
            } else {
              annotationData[col.fieldName] = value
            }
          }
        }

        annotationRows.push({
          source_database: source.name,
          source_accession: accession,
          ncbi_gene_id: ncbiGeneId,
          gene_symbol: annotationData['gene_symbol'] || '',
          gene_name: annotationData['gene_name'] || '',
          annotation_data: JSON.stringify(annotationData),
          external_links: JSON.stringify(externalLinks)
        })
      }
    },
    (processed, total) => {
      const percent = Math.round(10 + (processed / total) * 60)
      onProgress?.(`正在解析数据... (${processed}/${total})`, percent)
    }
  )

  onProgress?.(`正在导入 ${annotationRows.length} 条注�?..`, 75)

  // 批量导入（分批，每批 500 条）
  const batchSize = 500
  let imported = 0

  for (let i = 0; i < annotationRows.length; i += batchSize) {
    const batch = annotationRows.slice(i, i + batchSize)
    const count = speciesRepo.batchImportAnnotations(pluginId, batch)
    imported += count

    if (onProgress) {
      const percent = Math.round(75 + (i / annotationRows.length) * 15)
      onProgress(`已导�?${imported} 条注�?..`, percent)
    }
  }

  onProgress?.('正在匹配本地基因记录...', 92)

  // 自动匹配基因
  const matched = speciesRepo.matchAnnotationsToGenes(pluginId)

  console.log(`[SpeciesPlugin] Imported ${imported} annotations, matched ${matched} genes`)

  return { imported, matched }
}

// ============ 插件卸载 ============

/**
 * 卸载物种插件
 * @param pluginId 插件 ID
 */
export function uninstallPlugin(pluginId: number): void {
  const plugin = speciesRepo.getSpeciesPlugin(pluginId)
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)

  // 删除本地文件
  const pluginDir = getPluginDataDir(plugin.species_name)
  if (existsSync(pluginDir)) {
    rmSync(pluginDir, { recursive: true, force: true })
  }

  // 删除数据库记录（级联删除注释�?
  speciesRepo.deleteSpeciesPlugin(pluginId)

  console.log(`[SpeciesPlugin] Uninstalled plugin: ${plugin.species_name}`)
}

// ============ 目录复制工具 ============

/** 递归复制目录 */
export function copyDirRecursive(src: string, dest: string): void {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src)
  for (const entry of entries) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

// ============ MSU 在线数据获取 ============

/**
 * 从 MSU 网站获取基因信息
 * @param accession MSU 基因存取号（如 LOC_Os12g40710）
 * @returns 基因信息对象
 */
export async function fetchMSUGeneInfo(accession: string): Promise<{
  gene_product_name: string
  locus_name: string
  go_terms: Array<{ go_id: string; type: string; name: string; evidence_code: string }>
  coexpression_modules: Array<{ module_id: string; peak_expression: string }>
  splice_variants: Array<{ id: string; url: string }>
  rnaseq_tpm: Array<{ sra_run: string; sra_url: string; sample: string; tpm: number }>
  _parse_warnings: string[]
}> {
  const url = `https://rice.uga.edu/cgi-bin/ORF_infopage.cgi?orf=${accession}`
  const warnings: string[] = []
  
  try {
    const html = await httpsGet(url)
    
    // 页面有效性检查
    if (!html || html.length < 100 || html.includes('No information available')) {
      throw new Error(`MSU 页面无有效内容（${accession}），可能已下线或存取号无效`)
    }
    
    // 解析 Gene Product Name
    const productNameMatch = html.match(/Gene Product Name:<\/td>\s*<td[^>]*>([^<]+)</i)
    const gene_product_name = productNameMatch ? productNameMatch[1].trim() : ''
    if (!gene_product_name) warnings.push('gene_product_name')
    
    // 解析 Locus Name
    const locusNameMatch = html.match(/Locus Name:<\/td>\s*<td[^>]*>([^<]+)</i)
    const locus_name = locusNameMatch ? locusNameMatch[1].trim() : accession
    if (!locusNameMatch) warnings.push('locus_name')
    
    // 解析可变剪接形式（Gene Identification 区域中的 .1/.2/.3 链接）
    const splice_variants: Array<{ id: string; url: string }> = []
    // 变体链接指向 ORF_infopage.cgi，序列需从 sequence_display.cgi 获取
    const variantRegex = /<a\s+href="[^"]*(?:ORF_infopage|sequence_display)\.cgi\?orf=([^"]+)"[^>]*>[^<]*<\/a>/gi
    let varMatch
    while ((varMatch = variantRegex.exec(html)) !== null) {
      const varId = varMatch[1].trim()
      // 只收集带 .N 后缀的剪接形式
      if (varId.includes('.')) {
        if (!splice_variants.some(v => v.id === varId)) {
          splice_variants.push({ id: varId, url: `https://rice.uga.edu/cgi-bin/sequence_display.cgi?orf=${varId}` })
        }
      }
    }
    // 如果没有找到带后缀的变体，将当前基因本身作为唯一形式
    if (splice_variants.length === 0) {
      splice_variants.push({ id: accession, url: `https://rice.uga.edu/cgi-bin/sequence_display.cgi?orf=${accession}` })
    }
    
    // 解析 Gene Ontology Classification
    const goTerms: Array<{ go_id: string; type: string; name: string; evidence_code: string }> = []
    const goTableRegex = /<tr[^>]*>\s*<td[^>]*>(GO:\d+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/gi
    let goMatch
    while ((goMatch = goTableRegex.exec(html)) !== null) {
      goTerms.push({
        go_id: goMatch[1],
        type: goMatch[2].trim(),
        name: goMatch[3].trim(),
        evidence_code: goMatch[4].trim()
      })
    }
    
    // 解析 Coexpression Module Assignment
    const coexpressionModules: Array<{ module_id: string; peak_expression: string }> = []
    const coexpressionRegex = /Coexpression Module Assignment[\s\S]*?<\/tr>\s*<tr>\s*<th[^>]*>Module ID<\/th>\s*<th[^>]*>Module Peak Expression<\/th>\s*<\/tr>([\s\S]*?)<\/table>/i
    const coexpressionSectionMatch = html.match(coexpressionRegex)
    if (coexpressionSectionMatch) {
      const moduleRowsRegex = /<tr>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<\/tr>/gi
      let moduleMatch
      while ((moduleMatch = moduleRowsRegex.exec(coexpressionSectionMatch[1])) !== null) {
        coexpressionModules.push({
          module_id: moduleMatch[1].trim(),
          peak_expression: moduleMatch[2].trim()
        })
      }
    }
    
    // 解析 RNA-Seq TPM Expression Values 表格（3列：SRA Run / Sample / TPM）
    const rnaseq_tpm: Array<{ sra_run: string; sra_url: string; sample: string; tpm: number }> = []
    // 从标题文本开始匹配到其所在 table 的结束标签
    const rnaSeqTableMatch = html.match(/RNA-Seq TPM Expression[\s\S]*?<\/table>/i)
    if (rnaSeqTableMatch) {
      // 每行 3 个 td：第1列含<a>链接，第2列是样本名，第3列是 TPM 值
      const rowRegex = /<td[^>]*>\s*<a\s+href='([^']+)'[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>/gi
      let rowMatch
      while ((rowMatch = rowRegex.exec(rnaSeqTableMatch[0])) !== null) {
        const sra_url = rowMatch[1].trim()
        const sra_run = rowMatch[2].trim()
        const sample = rowMatch[3].trim()
        const tpm = parseFloat(rowMatch[4])
        if (sample && !isNaN(tpm)) rnaseq_tpm.push({ sra_run, sra_url, sample, tpm })
      }
    }
    if (rnaseq_tpm.length === 0 && rnaSeqTableMatch) warnings.push('rnaseq_tpm_parse_empty')

    // 关键结构校验
    if (warnings.length >= 2 && goTerms.length === 0) {
      warnings.push('MSU 页面结构可能已变更，多个字段解析失败')
    }
    
    return { gene_product_name, locus_name, go_terms: goTerms, coexpression_modules: coexpressionModules, splice_variants, rnaseq_tpm, _parse_warnings: warnings }
  } catch (error: any) {
    console.error(`[MSU] Failed to fetch gene info for ${accession}:`, error)
    throw new Error(error.message || `Failed to fetch MSU gene info: ${error}`)
  }
}

/**
 * 从 MSU 网站获取基因序列（支持多剪接形式）
 * @param accession MSU 基因存取号（如 LOC_Os12g40710）
 * @param variants 可变剪接形式列表（可选，由 fetchMSUGeneInfo 提供）
 * @returns 序列数据对象（含多转录本）
 */
export async function fetchMSUSequences(accession: string, variants?: Array<{ id: string; url: string }>): Promise<{
  genomic_sequence: string
  cds_sequence: string
  protein_sequence: string
  genomic_length: number
  cds_length: number
  protein_length: number
  putative_function: string
  transcripts: Array<{ variant_id: string; cds_sequence: string; protein_sequence: string; cds_length: number; protein_length: number }>
  _parse_warnings: string[]
}> {
  const warnings: string[] = []
  
  // 确定要获取的变体列表
  const variantList = (variants && variants.length > 0) ? variants : [{ id: accession, url: `https://rice.uga.edu/cgi-bin/sequence_display.cgi?orf=${accession}` }]
  
  try {
    // 获取第一个变体页面（含基因组序列）
    const firstHtml = await httpsGet(variantList[0].url)
    if (!firstHtml || firstHtml.length < 100) {
      throw new Error(`MSU 序列页面无有效内容（${variantList[0].id}）`)
    }
    
    // 解析 Genomic Sequence（所有变体共享，只获取一次）
    const genomicMatch = firstHtml.match(/Genomic Sequence<\/p>\s*<pre>\s*>([^<]+)<\/pre>/i)
    const genomic_sequence = genomicMatch ? genomicMatch[1].replace(/^[^\n]*\n/, '').replace(/\s+/g, '').trim() : ''
    if (!genomic_sequence) warnings.push('genomic_sequence')
    
    const genomicLengthMatch = firstHtml.match(/Genomic sequence length:\s*<\/b>\s*(\d+)/i)
    const putativeFunctionMatch = firstHtml.match(/Putative Function:\s*<\/b>\s*([^<]+)/i)
    
    // 解析每个变体的 CDS 和 Protein
    const transcripts: Array<{ variant_id: string; cds_sequence: string; protein_sequence: string; cds_length: number; protein_length: number }> = []
    
    for (let i = 0; i < variantList.length; i++) {
      const variant = variantList[i]
      let html = firstHtml // 第一个变体已获取
      if (i > 0) {
        try {
          html = await httpsGet(variant.url)
          // 间隔避免请求过快
          if (i < variantList.length - 1) await new Promise(r => setTimeout(r, 300))
        } catch (e: any) {
          warnings.push(`variant_${variant.id}_fetch_failed`)
          transcripts.push({ variant_id: variant.id, cds_sequence: '', protein_sequence: '', cds_length: 0, protein_length: 0 })
          continue
        }
      }
      
      const cdsMatch = html.match(/CDS<\/p>\s*<pre>\s*>([^<]+)<\/pre>/i)
      const cds_sequence = cdsMatch ? cdsMatch[1].replace(/^[^\n]*\n/, '').replace(/\s+/g, '').trim() : ''
      const proteinMatch = html.match(/Protein<\/p>\s*<pre>\s*>([^<]+)<\/pre>/i)
      const protein_sequence = proteinMatch ? proteinMatch[1].replace(/^[^\n]*\n/, '').replace(/\s+/g, '').trim() : ''
      const cdsLengthMatch = html.match(/CDS length:\s*<\/b>\s*(\d+)/i)
      const proteinLengthMatch = html.match(/Protein length:\s*<\/b>\s*(\d+)/i)
      
      if (!cds_sequence && !protein_sequence) warnings.push(`variant_${variant.id}_no_seq`)
      
      transcripts.push({
        variant_id: variant.id,
        cds_sequence,
        protein_sequence,
        cds_length: cdsLengthMatch ? parseInt(cdsLengthMatch[1]) : cds_sequence.length,
        protein_length: proteinLengthMatch ? parseInt(proteinLengthMatch[1]) : protein_sequence.length
      })
    }
    
    // 关键序列全部缺失时警告
    if (!genomic_sequence && transcripts.every(t => !t.cds_sequence && !t.protein_sequence)) {
      warnings.push('MSU 序列页面结构可能已变更，所有序列解析失败')
    }
    
    // 向后兼容：顶层字段使用第一个变体的数据
    const first = transcripts[0]
    return {
      genomic_sequence,
      cds_sequence: first?.cds_sequence || '',
      protein_sequence: first?.protein_sequence || '',
      genomic_length: genomicLengthMatch ? parseInt(genomicLengthMatch[1]) : genomic_sequence.length,
      cds_length: first?.cds_length || 0,
      protein_length: first?.protein_length || 0,
      putative_function: putativeFunctionMatch ? putativeFunctionMatch[1].trim() : '',
      transcripts,
      _parse_warnings: warnings
    }
  } catch (error: any) {
    console.error(`[MSU] Failed to fetch sequences for ${accession}:`, error)
    throw new Error(error.message || `Failed to fetch MSU sequences: ${error}`)
  }
}

// ============ RiceData 在线数据获取 ============

/**
 * 从国家水稻数据中心（ricedata.cn）获取基因信息
 * @param ricedataId Ricedata ID（如 "1"）
 * @returns 解析后的基因信息对象
 */
export async function fetchRiceDataGeneInfo(ricedataId: string): Promise<{
  gene_chinese_name: string
  gene_english_name: string
  gene_symbol: string
  basic_info: string
  mutant_phenotype: string
  mapping_cloning: string
  expression_pattern: string
  subcellular_location: string
  biological_function: string
  references: string
  ontology_phenotype: string
  ontology_molecular_function: string
  ontology_biological_process: string
  ontology_cellular_component: string
  _parse_warnings: string[]
}> {
  const url = `https://www.ricedata.cn/gene/list/${ricedataId}.htm`
  const warnings: string[] = []

  try {
    const html = await httpsGet(url)

    if (!html || html.length < 200) {
      throw new Error(`RiceData 页面无有效内容（ID: ${ricedataId}），可能已下线`)
    }

    // 解析基因(座)名称区块：第一行中文名称，第二行英文名称
    let gene_chinese_name = ''
    let gene_english_name = ''
    const nameMatch = html.match(/基因[\(（]座[\)）]名称[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i)
    if (nameMatch) {
      const nameContent = nameMatch[1].replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').trim()
      const lines = nameContent.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)
      if (lines.length >= 1) gene_chinese_name = lines[0]
      if (lines.length >= 2) gene_english_name = lines[1]
    }

    // 解析基因符号
    let gene_symbol = ''
    const symbolMatch = html.match(/基因符号[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i)
    if (symbolMatch) {
      gene_symbol = symbolMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    }

    // 解析各 section 内容（页面结构：<h5>【sectionName】</h5> 后跟 <p> 段落）
    const parseSection = (sectionName: string): string => {
      // 模式1：<h5>【sectionName】</h5>（备选 h4/h3 提高容错）
      const pattern1 = new RegExp(`<h[345]>[^<]*【${sectionName}】[^<]*<\\/h[345]>([\\s\\S]*?)(?=<h[345]>|<\\/td>)`, 'i')
      const match1 = html.match(pattern1)
      if (match1) {
        return match1[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim()
      }
      // 模式2：回退到 <td> 匹配
      const pattern2 = new RegExp(`${sectionName}[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i')
      const match2 = html.match(pattern2)
      if (match2) {
        return match2[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .trim()
      }
      return ''
    }

    const basic_info = parseSection('基本信息')
    const mutant_phenotype = parseSection('突变体表型')
    const mapping_cloning = parseSection('定位与克隆')
    const expression_pattern = parseSection('时空表达谱')
    const subcellular_location = parseSection('亚细胞定位')
    const biological_function = parseSection('生物学功能')

    // 记录解析失败的 section
    if (!basic_info) warnings.push('基本信息')
    if (!mutant_phenotype) warnings.push('突变体表型')
    if (!mapping_cloning) warnings.push('定位与克隆')
    if (!expression_pattern) warnings.push('时空表达谱')
    if (!subcellular_location) warnings.push('亚细胞定位')
    if (!biological_function) warnings.push('生物学功能')

    // 参考文献使用单独的表格结构（每条文献在独立的 <tr><td> 中）
    let rawReferences = ''
    // 匹配包含参考文献的整个表格（<th> 内可能有 <b> 等标签）
    const refTableMatch = html.match(/参考文献[\s\S]{0,50}<\/th>([\s\S]*?)<\/table>/i)
    if (refTableMatch) {
      rawReferences = refTableMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/td>\s*<\/tr>\s*<tr>\s*<td[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim()
    }
    const references = rawReferences ? cleanReferences(rawReferences) : ''

    // 解析 ONTOLOGY 及相关基因区块（独立表格，包含表型特征/分子功能/生物进程/细胞结构）
    const parseOntologyField = (fieldName: string): string => {
      // 匹配 <th>fieldName</th><td>content</td> 结构
      const pattern = new RegExp(`<th[^>]*>[^<]*${fieldName}[^<]*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i')
      const match = html.match(pattern)
      if (match) {
        return match[1]
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .trim()
      }
      return ''
    }

    const ontology_phenotype = parseOntologyField('表型特征')
    const ontology_molecular_function = parseOntologyField('分子功能')
    const ontology_biological_process = parseOntologyField('生物进程')
    const ontology_cellular_component = parseOntologyField('细胞结构')

    // 关键结构校验：如果基因名称和所有 section 都解析失败，可能页面已改版
    if (!gene_chinese_name && warnings.length >= 4) {
      warnings.push('RiceData 页面结构可能已变更，多个字段解析失败')
    }

    return {
      gene_chinese_name,
      gene_english_name,
      gene_symbol,
      basic_info,
      mutant_phenotype,
      mapping_cloning,
      expression_pattern,
      subcellular_location,
      biological_function,
      references,
      ontology_phenotype,
      ontology_molecular_function,
      ontology_biological_process,
      ontology_cellular_component,
      _parse_warnings: warnings
    }
  } catch (error: any) {
    console.error(`[RiceData] Failed to fetch gene info for ID ${ricedataId}:`, error)
    throw new Error(error.message || `Failed to fetch RiceData gene info: ${error}`)
  }
}

/**
 * 将 RiceData 在线获取的数据更新到本地数据库
 * @param annotationIds 要更新的注释记录 ID 列表
 * @param data 在线获取的数据
 * @returns 更新结果
 */
export function updateRiceDataAnnotation(
  annotationIds: number[],
  data: {
    gene_chinese_name: string
    gene_english_name: string
    gene_symbol: string
    basic_info: string
    mutant_phenotype: string
    mapping_cloning: string
    expression_pattern: string
    subcellular_location: string
    biological_function: string
    references: string
    ontology_phenotype?: string
    ontology_molecular_function?: string
    ontology_biological_process?: string
    ontology_cellular_component?: string
  }
): { updated: number } {
  let updated = 0
  const now = new Date().toISOString()

  for (const annId of annotationIds) {
    try {
      // 直接通过 ID 获取当前注释记录
      const existingAnn = speciesRepo.getAnnotationById(annId)
      if (!existingAnn) continue

      // 解析现有 annotation_data
      let annotationData: Record<string, string> = {}
      try {
        annotationData = JSON.parse(existingAnn.annotation_data || '{}')
      } catch {}

      // 记录时间戳
      if (!annotationData['fetched_at']) {
        annotationData['fetched_at'] = now
      }
      annotationData['updated_at'] = now

      // 覆盖更新字段（以最新在线数据为准）
      if (data.gene_chinese_name) annotationData['gene_chinese_name'] = data.gene_chinese_name
      if (data.gene_english_name) annotationData['gene_english_name'] = data.gene_english_name
      if (data.gene_symbol) annotationData['gene_symbol'] = data.gene_symbol
      if (data.basic_info) annotationData['basic_info'] = data.basic_info
      if (data.mutant_phenotype) annotationData['mutant_phenotype'] = data.mutant_phenotype
      if (data.mapping_cloning) annotationData['mapping_cloning'] = data.mapping_cloning
      if (data.expression_pattern) annotationData['expression_pattern'] = data.expression_pattern
      if (data.subcellular_location) annotationData['subcellular_location'] = data.subcellular_location
      if (data.biological_function) annotationData['biological_function'] = data.biological_function
      if (data.references) annotationData['references'] = data.references
      if (data.ontology_phenotype) annotationData['ontology_phenotype'] = data.ontology_phenotype
      if (data.ontology_molecular_function) annotationData['ontology_molecular_function'] = data.ontology_molecular_function
      if (data.ontology_biological_process) annotationData['ontology_biological_process'] = data.ontology_biological_process
      if (data.ontology_cellular_component) annotationData['ontology_cellular_component'] = data.ontology_cellular_component

      // 写入数据库
      speciesRepo.updateAnnotationData(
        annId,
        JSON.stringify(annotationData),
        data.gene_symbol || undefined
      )
      updated++
    } catch (err) {
      console.warn(`[RiceData] Failed to update annotation ${annId}:`, err)
    }
  }

  console.log(`[RiceData] Updated ${updated} annotations`)

  // 注释信息文件写入 (Phase 2)
  try {
    const firstAnn = speciesRepo.getAnnotationById(annotationIds[0])
    if (firstAnn && firstAnn.gene_id) {
      const gene = geneRepo.getGene(firstAnn.gene_id)
      if (gene) {
        const geneId = geneFileService.getGeneIdentifier(gene)
        geneFileService.writeRicedataAnnotations(geneId, gene.gene_name || geneId, data as any)
      }
    }
  } catch {}

  return { updated }
}

/**
 * 将 MSU 在线获取的数据缓存到本地数据库
 * @param annotationId 注释记录 ID
 * @param msuData MSU 在线数据
 */
export function cacheMSUInfo(annotationId: number, msuData: Record<string, any>): { success: boolean } {
  try {
    const existingAnn = speciesRepo.getAnnotationById(annotationId)
    if (!existingAnn) return { success: false }

    let annotationData: Record<string, any> = {}
    try {
      annotationData = JSON.parse(existingAnn.annotation_data || '{}')
    } catch {}

    const now = new Date().toISOString()
    if (!annotationData['msu_fetched_at']) {
      annotationData['msu_fetched_at'] = now
    }
    annotationData['msu_updated_at'] = now

    // 将 MSU 数据以 msu_ 前缀存入
    if (msuData.gene_product_name) annotationData['msu_gene_product_name'] = msuData.gene_product_name
    if (msuData.locus_name) annotationData['msu_locus_name'] = msuData.locus_name
    if (msuData.go_terms && msuData.go_terms.length > 0) annotationData['msu_go_terms'] = JSON.stringify(msuData.go_terms)
    if (msuData.coexpression_modules && msuData.coexpression_modules.length > 0) annotationData['msu_coexpression_modules'] = JSON.stringify(msuData.coexpression_modules)
    if (msuData.splice_variants && msuData.splice_variants.length > 0) annotationData['msu_splice_variants'] = JSON.stringify(msuData.splice_variants)
    if (msuData.rnaseq_tpm && msuData.rnaseq_tpm.length > 0) annotationData['msu_rnaseq_tpm'] = JSON.stringify(msuData.rnaseq_tpm)
    if (msuData.msu_sequences) annotationData['msu_sequences'] = JSON.stringify(msuData.msu_sequences)

    speciesRepo.updateAnnotationData(annotationId, JSON.stringify(annotationData))
    console.log(`[MSU] Cached info for annotation ${annotationId}`)

    // 将 MSU 序列保存到 gene_related_sequences（FASTA 格式，支持编辑器打开）
    if (msuData.msu_sequences && existingAnn.gene_id) {
      try {
        const seqData = typeof msuData.msu_sequences === 'string' ? JSON.parse(msuData.msu_sequences) : msuData.msu_sequences
        const geneId = existingAnn.gene_id
        const acc = existingAnn.source_accession
        if (seqData.genomic_sequence) {
          const fasta = `>${acc} genomic\n${seqData.genomic_sequence.match(/.{1,60}/g)?.join('\n') || seqData.genomic_sequence}`
          const existing = geneRepo.findGeneRelatedSequenceByAccession(geneId, `MSU:${acc}`)
          if (existing) geneRepo.updateGeneRelatedSequenceContent(existing.id, fasta)
          else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'genomic', nucleotide_accession: `MSU:${acc}`, protein_accession: null, genomic_range: null, description: `MSU Genomic ${acc}`, ncbi_content: fasta, ncbi_imported_at: now })
        }
        if (seqData.transcripts && seqData.transcripts.length > 0) {
          for (const tx of seqData.transcripts) {
            if (tx.cds_sequence) {
              const cdsFasta = `>${tx.variant_id} CDS\n${tx.cds_sequence.match(/.{1,60}/g)?.join('\n') || tx.cds_sequence}`
              const cdsAcc = `MSU:${tx.variant_id}:CDS`
              const ex1 = geneRepo.findGeneRelatedSequenceByAccession(geneId, cdsAcc)
              if (ex1) geneRepo.updateGeneRelatedSequenceContent(ex1.id, cdsFasta)
              else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'mRNA', nucleotide_accession: cdsAcc, protein_accession: null, genomic_range: null, description: `MSU CDS ${tx.variant_id}`, ncbi_content: cdsFasta, ncbi_imported_at: now })
            }
            if (tx.protein_sequence) {
              const protFasta = `>${tx.variant_id} protein\n${tx.protein_sequence.match(/.{1,60}/g)?.join('\n') || tx.protein_sequence}`
              const protAcc = `MSU:${tx.variant_id}:Protein`
              const ex2 = geneRepo.findGeneRelatedSequenceByAccession(geneId, protAcc)
              if (ex2) geneRepo.updateGeneRelatedSequenceContent(ex2.id, protFasta)
              else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'protein', nucleotide_accession: '', protein_accession: protAcc, genomic_range: null, description: `MSU Protein ${tx.variant_id}`, ncbi_content: protFasta, ncbi_imported_at: now })
            }
          }
        } else if (seqData.cds_sequence || seqData.protein_sequence) {
          // 回退：使用顶层 cds_sequence/protein_sequence（无 transcripts 数组时）
          const varId = acc
          if (seqData.cds_sequence) {
            const cdsFasta = `>${varId} CDS\n${seqData.cds_sequence.match(/.{1,60}/g)?.join('\n') || seqData.cds_sequence}`
            const cdsAcc = `MSU:${varId}:CDS`
            const ex1 = geneRepo.findGeneRelatedSequenceByAccession(geneId, cdsAcc)
            if (ex1) geneRepo.updateGeneRelatedSequenceContent(ex1.id, cdsFasta)
            else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'mRNA', nucleotide_accession: cdsAcc, protein_accession: null, genomic_range: null, description: `MSU CDS ${varId}`, ncbi_content: cdsFasta, ncbi_imported_at: now })
          }
          if (seqData.protein_sequence) {
            const protFasta = `>${varId} protein\n${seqData.protein_sequence.match(/.{1,60}/g)?.join('\n') || seqData.protein_sequence}`
            const protAcc = `MSU:${varId}:Protein`
            const ex2 = geneRepo.findGeneRelatedSequenceByAccession(geneId, protAcc)
            if (ex2) geneRepo.updateGeneRelatedSequenceContent(ex2.id, protFasta)
            else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'protein', nucleotide_accession: '', protein_accession: protAcc, genomic_range: null, description: `MSU Protein ${varId}`, ncbi_content: protFasta, ncbi_imported_at: now })
          }
        }
      } catch (seqErr: any) {
        console.warn(`[MSU] Failed to save sequences to related: ${seqErr.message}`)
      }
      // 文件持久化：将 MSU 序列写入基因目录
      try {
        const gene = geneRepo.getGene(existingAnn.gene_id)
        if (gene) {
          const geneId = geneFileService.getGeneIdentifier(gene)
          const geneName = gene.gene_name || geneId
          const acc = existingAnn.source_accession
          const seqData2 = typeof msuData.msu_sequences === 'string' ? JSON.parse(msuData.msu_sequences) : msuData.msu_sequences
          if (seqData2.genomic_sequence) {
            const fasta = `>${acc} genomic [source=MSU]\n${seqData2.genomic_sequence.match(/.{1,60}/g)?.join('\n') || seqData2.genomic_sequence}`
            geneFileService.writeSequenceFile(geneId, geneName, 'MSU', acc, 'genomic', fasta, 'FASTA')
          }
          const txArr = seqData2.transcripts && seqData2.transcripts.length > 0 ? seqData2.transcripts : (seqData2.cds_sequence ? [{ variant_id: acc, cds_sequence: seqData2.cds_sequence, protein_sequence: seqData2.protein_sequence }] : [])
          for (const tx of txArr) {
            if (tx.cds_sequence) geneFileService.writeSequenceFile(geneId, geneName, 'MSU', `${tx.variant_id}_CDS`, 'CDS', `>${tx.variant_id} CDS [source=MSU]\n${tx.cds_sequence.match(/.{1,60}/g)?.join('\n') || tx.cds_sequence}`, 'FASTA')
            if (tx.protein_sequence) geneFileService.writeSequenceFile(geneId, geneName, 'MSU', `${tx.variant_id}_protein`, 'protein', `>${tx.variant_id} protein [source=MSU]\n${tx.protein_sequence.match(/.{1,60}/g)?.join('\n') || tx.protein_sequence}`, 'FASTA')
          }
        }
      } catch (fileErr: any) {
        console.warn(`[MSU] File persistence failed: ${fileErr.message}`)
      }
    }

    // 注释信息文件写入 (Phase 2) —— 无论是否有序列数据都执行
    try {
      const gene = geneRepo.getGene(existingAnn.gene_id)
      if (gene) {
        const geneId = geneFileService.getGeneIdentifier(gene)
        geneFileService.writeMsuAnnotations(geneId, gene.gene_name || geneId, msuData)
      }
    } catch {}

    return { success: true }
  } catch (err) {
    console.warn(`[MSU] Failed to cache info for annotation ${annotationId}:`, err)
    return { success: false }
  }
}

// ============ RAP-DB 在线数据获取 ============

/**
 * 从 RAP-DB 获取基因座信息（序列 + 外显子结构 + 转录本元数据）
 */
export async function fetchRAPDBLocusInfo(accession: string): Promise<{
  locus_name: string
  locus_title: string
  seqid: string
  start_pos: number
  end_pos: number
  strand: string
  sequence: string
  exons: Array<{ start: number; end: number; phase: number | null }>
  transcripts: Array<{ name: string; symbol: string; go_terms: string[] }>
  oryzabase: Record<string, any>
  transcript_variants: Array<{
    variant_id: string
    mrna_sequence: string
    cds_sequence: string
    protein_sequence: string
    mrna_length: number
    cds_length: number
    protein_length: number
  }>
}> {
  const url = `https://rapdb.dna.naro.go.jp/tools/Feature?name=${accession}`
  const html = await httpsGet(url)
  const data = JSON.parse(html)

  const sequence: string = data.sequence || ''
  const startPos: number = data.start_pos || 0

  // 提取外显子坐标（type="CDS" 的条目，坐标为 1-based inclusive）
  const exons: Array<{ start: number; end: number; phase: number | null }> = []
  if (data.transcripts_feature && Array.isArray(data.transcripts_feature)) {
    for (const f of data.transcripts_feature) {
      if (f.type === 'CDS') {
        exons.push({ start: f.start_pos, end: f.end_pos + 1, phase: f.phase })
      }
    }
  }

  // 提取转录本元数据 + Oryzabase 信息
  const transcripts: Array<{ name: string; symbol: string; go_terms: string[] }> = []
  let oryzabase: Record<string, any> = {}
  if (data.transcripts_attributes && Array.isArray(data.transcripts_attributes)) {
    for (const t of data.transcripts_attributes) {
      transcripts.push({
        name: t.Name || '',
        symbol: t['CGSNL Gene Symbol'] || '',
        go_terms: t.GO || []
      })
    }
    // Oryzabase 数据（从第一个 transcript attribute 提取）
    const attr = data.transcripts_attributes[0]
    if (attr) {
      oryzabase = {
        gene_symbol: attr['CGSNL Gene Symbol'] || '',
        gene_name: attr['CGSNL Gene Name'] || '',
        oryzabase_gene_synonyms: attr['Oryzabase Gene Name Synonym(s)'] || '',
        oryzabase_symbol_synonyms: attr['Oryzabase Gene Symbol Synonym(s)'] || '',
        rapdb_gene_synonyms: attr['RAP-DB Gene Name Synonym(s)'] || '',
        rapdb_symbol_synonyms: attr['RAP-DB Gene Symbol Synonym(s)'] || '',
        note: attr['Note'] || '',
        interpro: attr.InterPro || [],
        go_terms: attr.GO || [],
        literature: attr['Literature_PMID'] || '',
        oryzabase_id: attr['Oryzabase'] || '',
        orf_evidence: attr['ORF_evidence'] || '',
        transcript_evidence: attr['Transcript_evidence'] || '',
        manual_curation: attr['Manual Curation'] || ''
      }
    }
  }

  // 推导每个 transcript variant 的序列（mRNA/CDS/Protein）
  const codonTable: Record<string, string> = {
    'TTT': 'F', 'TTC': 'F', 'TTA': 'L', 'TTG': 'L', 'CTT': 'L', 'CTC': 'L', 'CTA': 'L', 'CTG': 'L',
    'ATT': 'I', 'ATC': 'I', 'ATA': 'I', 'ATG': 'M', 'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V',
    'TCT': 'S', 'TCC': 'S', 'TCA': 'S', 'TCG': 'S', 'CCT': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
    'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T', 'GCT': 'A', 'GCC': 'A', 'GCA': 'A', 'GCG': 'A',
    'TAT': 'Y', 'TAC': 'Y', 'TAA': '*', 'TAG': '*', 'CAT': 'H', 'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q',
    'AAT': 'N', 'AAC': 'N', 'AAA': 'K', 'AAG': 'K', 'GAT': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E',
    'TGT': 'C', 'TGC': 'C', 'TGA': '*', 'TGG': 'W', 'CGT': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R',
    'AGT': 'S', 'AGC': 'S', 'AGA': 'R', 'AGG': 'R', 'GGT': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G'
  }

  const transcriptVariants: Array<{
    variant_id: string; mrna_sequence: string; cds_sequence: string
    protein_sequence: string; mrna_length: number; cds_length: number; protein_length: number
  }> = []

  if (data.transcripts_feature && Array.isArray(data.transcripts_feature) && sequence) {
    // 按 transcript_name 分组
    const variantMap = new Map<string, { mrna: any[]; cds: any[] }>()
    for (const f of data.transcripts_feature) {
      const name = f.transcript_name || ''
      if (!variantMap.has(name)) variantMap.set(name, { mrna: [], cds: [] })
      const group = variantMap.get(name)!
      if (f.type === 'mRNA') group.mrna.push(f)
      else if (f.type === 'CDS') group.cds.push(f)
    }

    for (const [variantId, group] of variantMap) {
      // CDS: 拼接所有 CDS 外显子（RAP-DB API 坐标为 1-based inclusive，需 +1）
      const cdsParts: string[] = []
      for (const cdsFeat of group.cds) {
        const relStart = cdsFeat.start_pos - startPos
        const relEnd = cdsFeat.end_pos - startPos + 1
        cdsParts.push(sequence.substring(relStart, relEnd))
      }
      const cds = cdsParts.join('')

      // mRNA: 剪接后的转录本序列（外显子拼接，含 UTR）
      // 当前 API 无独立 exon feature，用 CDS 拼接作为 mRNA（对无 UTR 基因两者相同）
      const mrna = cds

      // Protein: 翻译 CDS
      const cdsUpper = cds.toUpperCase()
      let protein = ''
      for (let i = 0; i + 2 < cdsUpper.length; i += 3) {
        const codon = cdsUpper.substring(i, i + 3)
        const aa = codonTable[codon] || 'X'
        if (aa === '*') break
        protein += aa
      }

      transcriptVariants.push({
        variant_id: variantId,
        mrna_sequence: mrna,
        cds_sequence: cds,
        protein_sequence: protein,
        mrna_length: mrna.length,
        cds_length: cds.length,
        protein_length: protein.length
      })
    }
  }

  return {
    locus_name: data.locus_name || accession,
    locus_title: data.locus_title || '',
    seqid: data.seqid || '',
    start_pos: data.start_pos || 0,
    end_pos: data.end_pos || 0,
    strand: data.strand || '+',
    sequence,
    exons,
    transcripts,
    oryzabase,
    transcript_variants: transcriptVariants
  }
}

/**
 * 从 RAP-DB 获取转录本序列（mRNA/CDS/Protein）
 * 通过 Feature API 获取基因组序列 + 外显子坐标，推导转录本序列
 */
export async function fetchRAPDBTranscript(accession: string): Promise<{
  transcript_name: string
  mrna_sequence: string
  cds_sequence: string
  protein_sequence: string
  mrna_length: number
  cds_length: number
  protein_length: number
}> {
  const url = `https://rapdb.dna.naro.go.jp/tools/Feature?name=${accession}`
  const html = await httpsGet(url)
  const data = JSON.parse(html)

  const sequence: string = data.sequence || ''
  const startPos: number = data.start_pos || 0
  const transcriptName = data.transcripts_attributes?.[0]?.Name || accession

  // 提取外显子坐标（type="CDS"）
  const exons: Array<{ start: number; end: number }> = []
  if (data.transcripts_feature && Array.isArray(data.transcripts_feature)) {
    for (const f of data.transcripts_feature) {
      if (f.type === 'CDS') {
        exons.push({ start: f.start_pos, end: f.end_pos })
      }
    }
  }

  // mRNA = 完整基因组序列（从 start_pos 到 end_pos）
  const mrna = sequence

  // CDS = 拼接所有外显子序列
  const cdsParts: string[] = []
  for (const exon of exons) {
    const relStart = exon.start - startPos
    const relEnd = exon.end - startPos
    cdsParts.push(sequence.substring(relStart, relEnd))
  }
  const cds = cdsParts.join('')

  // Protein = 翻译 CDS（标准遗传密码）
  const codonTable: Record<string, string> = {
    'TTT': 'F', 'TTC': 'F', 'TTA': 'L', 'TTG': 'L', 'CTT': 'L', 'CTC': 'L', 'CTA': 'L', 'CTG': 'L',
    'ATT': 'I', 'ATC': 'I', 'ATA': 'I', 'ATG': 'M', 'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V',
    'TCT': 'S', 'TCC': 'S', 'TCA': 'S', 'TCG': 'S', 'CCT': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
    'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T', 'GCT': 'A', 'GCC': 'A', 'GCA': 'A', 'GCG': 'A',
    'TAT': 'Y', 'TAC': 'Y', 'TAA': '*', 'TAG': '*', 'CAT': 'H', 'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q',
    'AAT': 'N', 'AAC': 'N', 'AAA': 'K', 'AAG': 'K', 'GAT': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E',
    'TGT': 'C', 'TGC': 'C', 'TGA': '*', 'TGG': 'W', 'CGT': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R',
    'AGT': 'S', 'AGC': 'S', 'AGA': 'R', 'AGG': 'R', 'GGT': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G'
  }
  const cdsUpper = cds.toUpperCase()
  let protein = ''
  for (let i = 0; i + 2 < cdsUpper.length; i += 3) {
    const codon = cdsUpper.substring(i, i + 3)
    const aa = codonTable[codon] || 'X'
    if (aa === '*') break
    protein += aa
  }

  return {
    transcript_name: transcriptName,
    mrna_sequence: mrna,
    cds_sequence: cds,
    protein_sequence: protein,
    mrna_length: mrna.length,
    cds_length: cds.length,
    protein_length: protein.length
  }
}

/**
 * 从 RAP-DB 获取表达数据 (RiceXPro)
 */
export async function fetchRAPDBExpression(accession: string, rxpId: string): Promise<{
  data: string
  feature_num: number
  rxp_name: string
  data_processing: string
  sample_labels: string[]
  /** 所有原始重复数据记录（rep1/rep2/rep3...），用于箱型图展示分布 */
  repeats: Array<{ repeat_number: string; data_processing: string; data: string }>
}> {
  const url = `https://rapdb.dna.naro.go.jp/tools/Expression?id=${accession}&rxp=${rxpId}`
  const html = await httpsGet(url)
  const arr = JSON.parse(html)
  // X 轴样本标签（来自硬编码的实验设计标签，与数值顺序一一对应）
  const sample_labels = RXP_SAMPLE_LABELS[rxpId] || []
  if (Array.isArray(arr) && arr.length > 0) {
    // 提取所有含 "rep" 的原始重复记录（用于箱型图），保留 raw 和 nrm 两种处理
    const repeats = arr
      .filter((item: any) => typeof item.repeat_number === 'string' && item.repeat_number.indexOf('rep') > -1)
      .map((item: any) => ({
        repeat_number: item.repeat_number as string,
        data_processing: (item.data_processing || 'raw') as string,
        data: (item.data || '') as string
      }))
    return {
      data: arr[0].data || '',
      feature_num: arr[0].feature_num || 0,
      rxp_name: arr[0].rxp_name || rxpId,
      data_processing: arr[0].data_processing || '',
      sample_labels,
      repeats
    }
  }
  return { data: '', feature_num: 0, rxp_name: rxpId, data_processing: '', sample_labels, repeats: [] }
}

/**
 * 构造 RAP-DB RiceXPro 表达图谱完整列表（5 大类 30 个实验）
 * - 图片型（RXP_3001-3003/4001-4002）：预渲染 PNG，返回 URL
 * - 图表型（RXP_0001-0012/1001-1012/5002）：返回 rxpId，前端按需获取数值渲染图表
 */
export async function fetchRAPDBExpressionImages(accession: string): Promise<{
  feature_num: number
  categories: Array<{ id: string; name: string; views: Array<{ id: string; label: string; type: 'image' | 'chart'; url?: string; footerUrl?: string; rxpId?: string }> }>
}> {
  // 从 Expression API 获取 feature_num（依次尝试各数据集，取首个有效值）
  let featureNum = 0
  for (const rxp of ['RXP_0001', 'RXP_3001', 'RXP_4001', 'RXP_1001', 'RXP_5002']) {
    try {
      const html = await httpsGet(`https://rapdb.dna.naro.go.jp/tools/Expression?id=${accession}&rxp=${rxp}`)
      const arr = JSON.parse(html)
      if (Array.isArray(arr) && arr.length > 0 && arr[0].feature_num) {
        featureNum = arr[0].feature_num
        break
      }
    } catch {}
  }
  if (!featureNum) return { feature_num: 0, categories: [] }

  const base = 'https://rapdb.dna.naro.go.jp/assets/static/images/ricexpro'
  const n5 = featureNum.toString().padStart(5, '0')
  const n6 = featureNum.toString().padStart(6, '0')
  const r = accession

  // 图表型实验定义（前端按需获取数值渲染柱状图）
  const chartExps: Record<string, string> = {
    RXP_0001: '田间整个生长期各组织/器官时空表达',
    RXP_0002: '叶片昼夜节律表达谱（整个生长期）',
    RXP_0003: '叶片表达谱（田间 12:00）',
    RXP_0004: '叶片表达谱（田间 00:00）',
    RXP_0005: '叶片日出期间表达谱',
    RXP_0006: '叶片日落期间表达谱',
    RXP_0007: '根系表达谱（田间 12:00）',
    RXP_0008: '根系表达谱（田间 00:00）',
    RXP_0009: '根系昼夜节律表达谱',
    RXP_0010: '生殖器官发育表达谱',
    RXP_0011: '谷物早期发育表达谱',
    RXP_0012: '成熟期胚与胚乳表达谱',
    RXP_1001: '根系对脱落酸(ABA)的响应',
    RXP_1006: '芽对脱落酸(ABA)的响应',
    RXP_1002: '根系对赤霉素(GA)的响应',
    RXP_1007: '芽对赤霉素(GA)的响应',
    RXP_1003: '根系对生长素(Auxin)的响应',
    RXP_1008: '芽对生长素(Auxin)的响应',
    RXP_1004: '根系对油菜素内酯(BR)的响应',
    RXP_1009: '芽对油菜素内酯(BR)的响应',
    RXP_1005: '根系对细胞分裂素(Cytokinin)的响应',
    RXP_1010: '芽对细胞分裂素(Cytokinin)的响应',
    RXP_1011: '根系对茉莉酸(JA)的响应',
    RXP_1012: '芽对茉莉酸(JA)的响应',
    RXP_5002: '根系对营养元素的响应'
  }
  const makeCharts = (ids: string[]) => ids.map(id => ({ id, label: `${id}: ${chartExps[id] || id}`, type: 'chart' as const, rxpId: id }))

  const categories: Array<{ id: string; name: string; views: Array<{ id: string; label: string; type: 'image' | 'chart'; url?: string; footerUrl?: string; rxpId?: string }> }> = [
    {
      id: 'field_dev', name: 'Field / Development（田间与发育）',
      views: makeCharts(['RXP_0001','RXP_0002','RXP_0003','RXP_0004','RXP_0005','RXP_0006','RXP_0007','RXP_0008','RXP_0009','RXP_0010','RXP_0011','RXP_0012'])
    },
    {
      id: 'hormone', name: 'Plant Hormone（植物激素响应）',
      views: makeCharts(['RXP_1001','RXP_1006','RXP_1002','RXP_1007','RXP_1003','RXP_1008','RXP_1004','RXP_1009','RXP_1005','RXP_1010','RXP_1011','RXP_1012'])
    },
    {
      id: 'pathogen', name: 'Responses to pathogen（病原菌接种响应）',
      views: [
        { id: 'RXP_3001_01', label: 'RXP_3001 稻瘟病(叶) 时间过程', type: 'image', url: `${base}/RXP_3001/BLAST_graph.20110823/BLST-${r}-${n5}_01.png`, footerUrl: `${base}/RXP_3001/imochi-01-footer.png` },
        { id: 'RXP_3001_02', label: 'RXP_3001 稻瘟病(叶) 抗性vs感性', type: 'image', url: `${base}/RXP_3001/BLAST_graph.20110823/BLST-${r}-${n5}_02.png`, footerUrl: `${base}/RXP_3001/imochi-02-footer.png` },
        { id: 'RXP_3001_03', label: 'RXP_3001 稻瘟病(叶) 真菌分离株', type: 'image', url: `${base}/RXP_3001/BLAST_graph.20110823/BLST-${r}-${n5}_03.png`, footerUrl: `${base}/RXP_3001/imochi-03-footer.png` },
        { id: 'RXP_3001_04', label: 'RXP_3001 稻瘟病(叶) Fold change', type: 'image', url: `${base}/RXP_3001/BLAST_graph.20110823/BLST-${r}-${n5}_04.png` },
        { id: 'RXP_3002_raw', label: 'RXP_3002 白叶枯病(叶) Raw', type: 'image', url: `${base}/RXP_3002/XTHN_graph_raw.20110826/XNTH-${r}-${n5}.png` },
        { id: 'RXP_3002_nrm', label: 'RXP_3002 白叶枯病(叶) Normalized', type: 'image', url: `${base}/RXP_3002/XNTH_graph.20110422/XTHN-${r}-${n5}_med_nrm.png` },
        { id: 'RXP_3003_01', label: 'RXP_3003 稻瘟病(根) 时间过程', type: 'image', url: `${base}/RXP_3003/BLAST_graph/BLST-${r}-${n5}_01.png` },
        { id: 'RXP_3003_02', label: 'RXP_3003 稻瘟病(根) 抗性vs感性', type: 'image', url: `${base}/RXP_3003/BLAST_graph/BLST-${r}-${n5}_02.png` },
        { id: 'RXP_3003_04', label: 'RXP_3003 稻瘟病(根) Fold change', type: 'image', url: `${base}/RXP_3003/BLAST_graph/BLST-${r}-${n5}_04.png` }
      ]
    },
    {
      id: 'lmd', name: 'Cell- and Tissue-Type（激光显微切割）',
      views: [
        { id: 'RXP_4001_dev_bar', label: 'RXP_4001 发育阶段（柱状图）', type: 'image', url: `${base}/RXP_4001/dev_barplot/RXP_4001-${r}-${n5}_bar.png`, footerUrl: `${base}/RXP_4001/dev-footer.png` },
        { id: 'RXP_4001_dev_line', label: 'RXP_4001 发育阶段（折线图）', type: 'image', url: `${base}/RXP_4001/dev_lineplot/RXP_4001-${r}-${n5}_line.png`, footerUrl: `${base}/RXP_4001/dev-footer.png` },
        { id: 'RXP_4001_tissue_bar', label: 'RXP_4001 组织类型（柱状图）', type: 'image', url: `${base}/RXP_4001/tissue_barplot/RXP_4001-${r}-${n5}_bar.png`, footerUrl: `${base}/RXP_4001/tissue-footer.png` },
        { id: 'RXP_4001_tissue_line', label: 'RXP_4001 组织类型（折线图）', type: 'image', url: `${base}/RXP_4001/tissue_lineplot/RXP_4001-${r}-${n5}_line.png`, footerUrl: `${base}/RXP_4001/tissue-footer.png` },
        { id: 'RXP_4001_picto_raw', label: 'RXP_4001 信号强度象形图(Raw)', type: 'image', url: `${base}/RXP_4001/pictograph_raw/${n6}.png` },
        { id: 'RXP_4001_picto_nrm1', label: 'RXP_4001 相对表达量象形图', type: 'image', url: `${base}/RXP_4001/pictograph_nrm1/${n6}.png` },
        { id: 'RXP_4001_picto_nrm2', label: 'RXP_4001 相对表达量象形图(Max/Min)', type: 'image', url: `${base}/RXP_4001/pictograph_nrm2/${n6}.png` },
        { id: 'RXP_4002_temp_bar', label: 'RXP_4002 时间序列（柱状图）', type: 'image', url: `${base}/RXP_4002/temporal_barplot_images/RXP_4002-${r}-${n5}_bar.png`, footerUrl: `${base}/RXP_4002/sample-part-temporal.png` },
        { id: 'RXP_4002_temp_line', label: 'RXP_4002 时间序列（折线图）', type: 'image', url: `${base}/RXP_4002/temporal_lineplot_images/RXP_4002-${r}-${n5}_line.png`, footerUrl: `${base}/RXP_4002/sample-part-temporal.png` },
        { id: 'RXP_4002_spatial_bar', label: 'RXP_4002 空间分布（柱状图）', type: 'image', url: `${base}/RXP_4002/spatial_barplot_images/RXP_4002-${r}-${n5}_bar.png`, footerUrl: `${base}/RXP_4002/sample-part-spatial.png` },
        { id: 'RXP_4002_spatial_line', label: 'RXP_4002 空间分布（折线图）', type: 'image', url: `${base}/RXP_4002/spatial_lineplot_images/RXP_4002-${r}-${n5}_line.png`, footerUrl: `${base}/RXP_4002/sample-part-spatial.png` },
        { id: 'RXP_4002_expsite', label: 'RXP_4002 表达位点图', type: 'image', url: `${base}/RXP_4002/spatial_expsite_graph_images/RXP_4002-${r}-${n5}_expsite.png` },
        { id: 'RXP_4002_7dap_bar', label: 'RXP_4002 7DAP空间（柱状图）', type: 'image', url: `${base}/RXP_4002/7DAP_spatial_barplot_images/RXP_4002-${r}-${n5}_bar.png` },
        { id: 'RXP_4002_7dap_line', label: 'RXP_4002 7DAP空间（折线图）', type: 'image', url: `${base}/RXP_4002/7DAP_spatial_lineplot_images/RXP_4002-${r}-${n5}_line.png` }
      ]
    },
    {
      id: 'nutrient', name: 'Nutrient（营养元素响应）',
      views: makeCharts(['RXP_5002'])
    }
  ]

  return { feature_num: featureNum, categories }
}

/**
 * 将 RAP-DB 序列数据保存为 GenBank 格式
 */
export function saveRAPDBAsGenBank(
  accession: string,
  data: { sequence: string; seqid: string; start_pos: number; end_pos: number; strand: string; locus_title: string; exons: Array<{ start: number; end: number }> },
  outputDir: string
): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${accession}.gb`)
  const lines: string[] = []
  const seqLen = data.sequence.length

  lines.push(`LOCUS       ${accession}             ${seqLen} bp    DNA     linear   PLN`)
  lines.push(`DEFINITION  ${accession} ${data.locus_title} (${data.seqid}:${data.start_pos}..${data.end_pos} ${data.strand} strand)`)
  lines.push(`ACCESSION   ${accession}`)
  lines.push(`VERSION     ${accession}.1`)
  lines.push(`KEYWORDS    .`)
  lines.push(`SOURCE      Oryza sativa`)
  lines.push(`  ORGANISM  Oryza sativa`)
  lines.push(`            Eukaryota; Viridiplantae; Streptophyta; Embryophyta; Tracheophyta;`)
  lines.push(`            Spermatophyta; Magnoliopsida; Liliopsida; Poales; Poaceae;`)
  lines.push(`            BOP clade; Oryzoideae; Oryzeae; Oryza`)
  lines.push(`COMMENT     Automatically generated from RAP-DB (https://rapdb.dna.naro.go.jp/)`)
  lines.push(`FEATURES             Location/Qualifiers`)
  lines.push(`     source          1..${seqLen}`)
  lines.push(`                     /organism="Oryza sativa"`)
  lines.push(`                     /mol_type="genomic DNA"`)
  lines.push(`                     /db_xref="taxon:39947"`)
  lines.push(`                     /chromosome="${data.seqid}"`)

  // 外显子 features（坐标相对于基因组序列）
  for (let i = 0; i < data.exons.length; i++) {
    const exon = data.exons[i]
    const relStart = exon.start - data.start_pos + 1
    const relEnd = exon.end - data.start_pos + 1
    lines.push(`     exon            ${relStart}..${relEnd}`)
    lines.push(`                     /number=${i + 1}`)
    lines.push(`                     /note="Exon ${i + 1} of ${data.exons.length}"`)
  }

  // CDS（join 所有外显子）
  if (data.exons.length > 0) {
    const cdsLocs = data.exons.map(e => `${e.start - data.start_pos + 1}..${e.end - data.start_pos + 1}`)
    lines.push(`     CDS             join(${cdsLocs.join(',')})`)
    lines.push(`                     /locus_tag="${accession}"`)
  }

  lines.push(`ORIGIN`)
  const seq = data.sequence.toLowerCase()
  for (let i = 0; i < seq.length; i += 60) {
    const lineNum = (i + 1).toString().padStart(9)
    const seqLine = seq.substring(i, i + 60)
    const formattedSeq = seqLine.match(/.{1,10}/g)?.join(' ') || seqLine
    lines.push(`${lineNum} ${formattedSeq}`)
  }
  lines.push(`//`)

  writeFileSync(outputPath, lines.join('\n'), 'utf-8')
  console.log(`[RAP-DB] Saved GenBank file: ${outputPath}`)
  return outputPath
}

/**
 * 将 RAP-DB 转录本序列保存为 FASTA 格式
 */
export function saveRAPDBAsFasta(
  transcriptId: string,
  sequences: { mrna?: string; cds?: string; protein?: string },
  outputDir: string
): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `${transcriptId}.fasta`)
  const lines: string[] = []

  const formatFasta = (header: string, seq: string) => {
    lines.push(`>${header}`)
    for (let i = 0; i < seq.length; i += 70) {
      lines.push(seq.substring(i, i + 70))
    }
  }

  if (sequences.mrna) formatFasta(`${transcriptId} mRNA`, sequences.mrna)
  if (sequences.cds) formatFasta(`${transcriptId} CDS`, sequences.cds)
  if (sequences.protein) formatFasta(`${transcriptId} Protein`, sequences.protein)

  writeFileSync(outputPath, lines.join('\n'), 'utf-8')
  console.log(`[RAP-DB] Saved FASTA file: ${outputPath}`)
  return outputPath
}

/**
 * 将 RAP-DB 在线获取的数据缓存到本地数据库
 */
export function cacheRAPDBInfo(annotationId: number, rapdbData: Record<string, any>): { success: boolean } {
  try {
    const existingAnn = speciesRepo.getAnnotationById(annotationId)
    if (!existingAnn) return { success: false }

    let annotationData: Record<string, any> = {}
    try {
      annotationData = JSON.parse(existingAnn.annotation_data || '{}')
    } catch {}

    const now = new Date().toISOString()
    if (!annotationData['rapdb_fetched_at']) {
      annotationData['rapdb_fetched_at'] = now
    }
    annotationData['rapdb_updated_at'] = now

    // 存储 RAP-DB 数据
    if (rapdbData.locus_title) annotationData['rapdb_locus_title'] = rapdbData.locus_title
    if (rapdbData.seqid) annotationData['rapdb_seqid'] = rapdbData.seqid
    if (rapdbData.start_pos) annotationData['rapdb_start_pos'] = String(rapdbData.start_pos)
    if (rapdbData.end_pos) annotationData['rapdb_end_pos'] = String(rapdbData.end_pos)
    if (rapdbData.strand) annotationData['rapdb_strand'] = rapdbData.strand
    if (rapdbData.sequence) annotationData['rapdb_sequence'] = rapdbData.sequence
    if (rapdbData.exons && rapdbData.exons.length > 0) annotationData['rapdb_exons'] = JSON.stringify(rapdbData.exons)
    if (rapdbData.transcripts && rapdbData.transcripts.length > 0) annotationData['rapdb_transcripts'] = JSON.stringify(rapdbData.transcripts)
    if (rapdbData.expression_data) annotationData['rapdb_expression_data'] = rapdbData.expression_data
    if (rapdbData.expression_rxp_name) annotationData['rapdb_expression_rxp_name'] = rapdbData.expression_rxp_name
    if (rapdbData.expression_images && rapdbData.expression_images.length > 0) annotationData['rapdb_expression_images'] = JSON.stringify(rapdbData.expression_images)
    if (rapdbData.expression_categories && rapdbData.expression_categories.length > 0) annotationData['rapdb_expression_categories'] = JSON.stringify(rapdbData.expression_categories)
    if (rapdbData.oryzabase && Object.keys(rapdbData.oryzabase).length > 0) annotationData['rapdb_oryzabase'] = JSON.stringify(rapdbData.oryzabase)
    if (rapdbData.transcript_variants && rapdbData.transcript_variants.length > 0) annotationData['rapdb_transcript_variants'] = JSON.stringify(rapdbData.transcript_variants)

    speciesRepo.updateAnnotationData(annotationId, JSON.stringify(annotationData))
    console.log(`[RAP-DB] Cached info for annotation ${annotationId}`)

    // 将 RAP-DB 序列保存到 gene_related_sequences（FASTA 格式）
    if (existingAnn.gene_id) {
      try {
        const geneId = existingAnn.gene_id
        const acc = existingAnn.source_accession
        // Genomic 序列
        if (rapdbData.sequence) {
          const fasta = `>${acc} genomic\n${rapdbData.sequence.match(/.{1,60}/g)?.join('\n') || rapdbData.sequence}`
          const rAcc = `RAPDB:${acc}`
          const ex = geneRepo.findGeneRelatedSequenceByAccession(geneId, rAcc)
          if (ex) geneRepo.updateGeneRelatedSequenceContent(ex.id, fasta)
          else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'genomic', nucleotide_accession: rAcc, protein_accession: null, genomic_range: null, description: `RAP-DB Genomic ${acc}`, ncbi_content: fasta, ncbi_imported_at: now })
        }
        // Transcript variants
        if (rapdbData.transcript_variants && rapdbData.transcript_variants.length > 0) {
          for (const tv of rapdbData.transcript_variants) {
            if (tv.mrna_sequence) {
              const mrnaFasta = `>${tv.variant_id} mRNA\n${tv.mrna_sequence.match(/.{1,60}/g)?.join('\n') || tv.mrna_sequence}`
              const mAcc = `RAPDB:${tv.variant_id}:mRNA`
              const ex1 = geneRepo.findGeneRelatedSequenceByAccession(geneId, mAcc)
              if (ex1) geneRepo.updateGeneRelatedSequenceContent(ex1.id, mrnaFasta)
              else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'mRNA', nucleotide_accession: mAcc, protein_accession: null, genomic_range: null, description: `RAP-DB mRNA ${tv.variant_id}`, ncbi_content: mrnaFasta, ncbi_imported_at: now })
            }
            if (tv.cds_sequence) {
              const cdsFasta = `>${tv.variant_id} CDS\n${tv.cds_sequence.match(/.{1,60}/g)?.join('\n') || tv.cds_sequence}`
              const cAcc = `RAPDB:${tv.variant_id}:CDS`
              const ex2 = geneRepo.findGeneRelatedSequenceByAccession(geneId, cAcc)
              if (ex2) geneRepo.updateGeneRelatedSequenceContent(ex2.id, cdsFasta)
              else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'mRNA', nucleotide_accession: cAcc, protein_accession: null, genomic_range: null, description: `RAP-DB CDS ${tv.variant_id}`, ncbi_content: cdsFasta, ncbi_imported_at: now })
            }
            if (tv.protein_sequence) {
              const protFasta = `>${tv.variant_id} protein\n${tv.protein_sequence.match(/.{1,60}/g)?.join('\n') || tv.protein_sequence}`
              const pAcc = `RAPDB:${tv.variant_id}:Protein`
              const ex3 = geneRepo.findGeneRelatedSequenceByAccession(geneId, pAcc)
              if (ex3) geneRepo.updateGeneRelatedSequenceContent(ex3.id, protFasta)
              else geneRepo.createGeneRelatedSequence({ gene_id: geneId, seq_type: 'protein', nucleotide_accession: '', protein_accession: pAcc, genomic_range: null, description: `RAP-DB Protein ${tv.variant_id}`, ncbi_content: protFasta, ncbi_imported_at: now })
            }
          }
        }
      } catch (seqErr: any) {
        console.warn(`[RAP-DB] Failed to save sequences to related: ${seqErr.message}`)
      }
      // 文件持久化：将 RAP-DB 序列写入基因目录
      try {
        const gene = geneRepo.getGene(existingAnn.gene_id)
        if (gene) {
          const geneId = geneFileService.getGeneIdentifier(gene)
          const geneName = gene.gene_name || geneId
          const acc = existingAnn.source_accession
          if (rapdbData.sequence) {
            geneFileService.writeSequenceFile(geneId, geneName, 'RAP-DB', acc, 'genomic', `>${acc} genomic [source=RAP-DB]\n${rapdbData.sequence.match(/.{1,60}/g)?.join('\n') || rapdbData.sequence}`, 'FASTA')
          }
          if (rapdbData.transcript_variants) {
            for (const tv of rapdbData.transcript_variants) {
              if (tv.mrna_sequence) geneFileService.writeSequenceFile(geneId, geneName, 'RAP-DB', `${tv.variant_id}_mRNA`, 'mRNA', `>${tv.variant_id} mRNA [source=RAP-DB]\n${tv.mrna_sequence.match(/.{1,60}/g)?.join('\n') || tv.mrna_sequence}`, 'FASTA')
              if (tv.cds_sequence) geneFileService.writeSequenceFile(geneId, geneName, 'RAP-DB', `${tv.variant_id}_CDS`, 'CDS', `>${tv.variant_id} CDS [source=RAP-DB]\n${tv.cds_sequence.match(/.{1,60}/g)?.join('\n') || tv.cds_sequence}`, 'FASTA')
              if (tv.protein_sequence) geneFileService.writeSequenceFile(geneId, geneName, 'RAP-DB', `${tv.variant_id}_protein`, 'protein', `>${tv.variant_id} protein [source=RAP-DB]\n${tv.protein_sequence.match(/.{1,60}/g)?.join('\n') || tv.protein_sequence}`, 'FASTA')
            }
          }
        }
      } catch (fileErr: any) {
        console.warn(`[RAP-DB] File persistence failed: ${fileErr.message}`)
      }
      // 注释信息文件写入 (Phase 2)
      try {
        const gene = geneRepo.getGene(existingAnn.gene_id)
        if (gene) {
          const geneId = geneFileService.getGeneIdentifier(gene)
          geneFileService.writeRapdbAnnotations(geneId, gene.gene_name || geneId, rapdbData)
          // 下载表达图谱 PNG 图片到本地
          if (rapdbData.expression_categories && rapdbData.expression_categories.length > 0) {
            geneFileService.downloadExpressionImages(geneId, gene.gene_name || geneId, rapdbData.expression_categories).catch(() => {})
          }
        }
      } catch {}
    }

    return { success: true }
  } catch (err) {
    console.warn(`[RAP-DB] Failed to cache info for annotation ${annotationId}:`, err)
    return { success: false }
  }
}

/**
 * 缓存单个 RiceXPro 图表型实验的数值数据到 annotation_data
 * 键名：rapdb_expression_{rxpId}，值为 JSON 字符串
 */
export function cacheRAPDBExpressionData(annotationId: number, rxpId: string, data: Record<string, any>): { success: boolean } {
  try {
    const existingAnn = speciesRepo.getAnnotationById(annotationId)
    if (!existingAnn) return { success: false }

    let annotationData: Record<string, any> = {}
    try {
      annotationData = JSON.parse(existingAnn.annotation_data || '{}')
    } catch {}

    annotationData[`rapdb_expression_${rxpId}`] = JSON.stringify(data)
    speciesRepo.updateAnnotationData(annotationId, JSON.stringify(annotationData))

    // 文件持久化：写入 annotations/rapdb/expression/{rxpId}.json
    try {
      if (existingAnn.gene_id) {
        const gene = geneRepo.getGene(existingAnn.gene_id)
        if (gene) {
          const geneId = geneFileService.getGeneIdentifier(gene)
          geneFileService.writeAnnotationFile(geneId, gene.gene_name || geneId, 'rapdb', `expression/${rxpId}.json`, data)
        }
      }
    } catch {}

    return { success: true }
  } catch (err) {
    console.warn(`[RAP-DB] Failed to cache expression ${rxpId} for annotation ${annotationId}:`, err)
    return { success: false }
  }
}

/** 全部 25 个图表型实验 RXP ID */
const ALL_CHART_RXP_IDS = Object.keys(RXP_SAMPLE_LABELS)

/**
 * 批量获取全部图表型实验数据并缓存到本地
 * 每次 API 调用间隔 400ms 避免请求过快
 * @param onProgress 进度回调 (done, total, rxpId)
 */
export async function fetchAllRAPDBExpressionData(
  accession: string,
  annotationId: number,
  onProgress?: (done: number, total: number, rxpId: string) => void
): Promise<{ success: number; failed: number }> {
  const total = ALL_CHART_RXP_IDS.length
  let success = 0, failed = 0

  for (let i = 0; i < total; i++) {
    const rxpId = ALL_CHART_RXP_IDS[i]
    try {
      const result = await fetchRAPDBExpression(accession, rxpId)
      if (result.data) {
        const nums = result.data.split(' ').filter(Boolean).map(Number).filter(n => !isNaN(n))
        const cachePayload: Record<string, any> = { data: nums, sample_labels: result.sample_labels || [] }
        // 解析重复数据
        const rawReps = (result.repeats || []).filter(r => r.data_processing === 'raw')
        if (rawReps.length > 1) {
          cachePayload.repeats = rawReps.map(r => ({
            data_processing: r.data_processing,
            values: r.data.split(' ').filter(Boolean).map(Number).filter((n: number) => !isNaN(n))
          }))
        }
        cacheRAPDBExpressionData(annotationId, rxpId, cachePayload)
        success++
      } else {
        failed++
      }
    } catch {
      failed++
    }
    onProgress?.(i + 1, total, rxpId)
    // 间隔 400ms
    if (i < total - 1) await new Promise(r => setTimeout(r, 400))
  }

  console.log(`[RAP-DB] Batch expression fetch done: ${success} success, ${failed} failed`)
  return { success, failed }
}
