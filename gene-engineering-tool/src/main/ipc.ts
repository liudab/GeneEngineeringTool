import { ipcMain, dialog, app, shell, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { IPC_CHANNELS } from '../shared/types'
import type { Vector, GenBankFeature, GeneSequence } from '../shared/types'
import * as db from './database'
import { parseGenBank, parseFasta, parseDnaFormat, parseEMBL, exportEMBL, inferExonIntronFeatures } from './file-parser'
import { parseAb1 } from './ab1-parser'
import { readFeaturesFromFile } from './services/file-import-service'
import { processSequencingFile } from './services/sequencing-service'
import { importGeneFromNCBI, fetchMRNASequence, fetchProteinSequence } from './services/ncbi-service'
import * as speciesPluginService from './services/species-plugin-service'
import * as geneFileService from './services/gene-file-service'
import * as speciesRepo from './db/species-repo'
import * as geneRepo from './db/gene-repo'
import { getDataDir } from './db/base'
import { zipDirectory, unzipToDirectory } from './utils/zip-utils'
import { createEditorWindow, createGeneEditorWindow, createRelatedSeqEditorWindow } from './index'
import { setLanguage } from '../shared/i18n'
import { buildMenu } from './menu'
import { generateGenBank, generateFasta, generateDnaFormat } from './genbank-writer'
import { createLogger, logFromRenderer, getRecentLogs, getLogDir } from './logger'
import { LogLevel } from '../shared/logger-types'

const log = createLogger('IPC')

// ============ 导出文件写入工具 ============
function writeExportFile(filePath: string, format: string, vector: Vector, features: GenBankFeature[]) {
  if (format === 'dna') {
    const buf = generateDnaFormat(vector, features)
    writeFileSync(filePath, buf)
  } else if (format === 'fasta') {
    writeFileSync(filePath, generateFasta(vector), 'utf-8')
  } else {
    writeFileSync(filePath, generateGenBank(vector, features), 'utf-8')
  }
}

// ============ 调试日志工具 ============

/** 将参数序列化为摘要字符串，超长截断 */
function summarizeArg(arg: any): string {
  if (arg === undefined) return 'undefined'
  if (arg === null) return 'null'
  if (typeof arg === 'string') {
    return arg.length > 80 ? `"${arg.slice(0, 80)}…" (${arg.length}chars)` : `"${arg}"`
  }
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
  if (Array.isArray(arg)) return `Array(${arg.length})`
  if (typeof arg === 'object') {
    try {
      const s = JSON.stringify(arg)
      return s.length > 120 ? `${s.slice(0, 120)}…` : s
    } catch {
      return '[object]'
    }
  }
  return String(arg)
}

function summarizeArgs(args: any[]): string {
  if (args.length === 0) return '()'
  return `(${args.map(summarizeArg).join(', ')})`
}

/** 防重复注册的 ipcMain.handle 包装 */
function safeHandle(channel: string, handler: (...args: any[]) => any): void {
  try { ipcMain.removeHandler(channel) } catch (_e) { /* 首次注册 */ }
  ipcMain.handle(channel, handler)
}

/** 带日志的 ipcMain.handle 替代函数，自动防重复注册 */
// ============ 辅助函数 ============

/** 递归复制目录 */
function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src)) {
    const srcPath = path.join(src, entry)
    const destPath = path.join(dest, entry)
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/** 递归收集目录下所有文件的绝对路径 */
function collectAllFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const absPath = path.join(dir, entry)
    if (statSync(absPath).isDirectory()) {
      result.push(...collectAllFiles(absPath))
    } else {
      result.push(absPath)
    }
  }
  return result
}

function loggedHandle(channel: string, handler: (...args: any[]) => any): void {
  try { ipcMain.removeHandler(channel) } catch (_e) { /* 首次注册 */ }
  ipcMain.handle(channel, async (event, ...args: any[]) => {
    const t0 = Date.now()
    try {
      const result = await handler(event, ...args)
      const ms = Date.now() - t0
      const resultStr = summarizeArg(result)
      log.debug(`${channel} ${summarizeArgs(args)} => ${resultStr} (${ms}ms)`)
      return result
    } catch (err: any) {
      const ms = Date.now() - t0
      log.error(`${channel} ${summarizeArgs(args)} FAILED after ${ms}ms`, err)
      throw err
    }
  })
}

export function registerIpcHandlers(): void {
  // ============ 酶 ============
  loggedHandle(IPC_CHANNELS.ENZYME_LIST, () => {
    return db.getEnzymes()
  })

  loggedHandle(IPC_CHANNELS.ENZYME_GET, (_event, id: number) => {
    return db.getEnzyme(id)
  })

  loggedHandle(IPC_CHANNELS.ENZYME_SEARCH, (_event, query: string) => {
    return db.searchEnzymes(query)
  })

  loggedHandle(IPC_CHANNELS.ENZYME_UPDATE_LIBRARY, () => {
    const count = db.updateEnzymeLibrary()
    return { success: true, count }
  })

  loggedHandle(IPC_CHANNELS.ENZYME_CREATE, (_event, data) => {
    return db.createEnzyme(data)
  })

  loggedHandle(IPC_CHANNELS.ENZYME_UPDATE, (_event, id: number, data) => {
    return db.updateEnzyme(id, data)
  })

  loggedHandle(IPC_CHANNELS.ENZYME_DELETE, (_event, id: number) => {
    return db.deleteEnzyme(id)
  })

  // ============ 载体 ============
  loggedHandle(IPC_CHANNELS.VECTOR_LIST, () => {
    return db.getVectors()
  })

  loggedHandle(IPC_CHANNELS.VECTOR_GET, (_event, id: number) => {
    return db.getVector(id)
  })

  loggedHandle(IPC_CHANNELS.VECTOR_CREATE, (_event, data) => {
    return db.createVector(data)
  })

  loggedHandle(IPC_CHANNELS.VECTOR_UPDATE, (_event, id: number, data) => {
    return db.updateVector(id, data)
  })

  loggedHandle(IPC_CHANNELS.VECTOR_DELETE, (_event, id: number) => {
    return db.deleteVector(id)
  })

  loggedHandle(IPC_CHANNELS.VECTOR_ENZYME_SITES, (_event, vectorId: number) => {
    return db.getVectorEnzymeSites(vectorId)
  })

  // ============ 载体导入 ============
  safeHandle(IPC_CHANNELS.VECTOR_IMPORT, async (event) => {
    log.info('vector:import — dialog opening')
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入载体文件',
      filters: [
        { name: '序列文件', extensions: ['gb', 'gbk', 'genbank', 'fasta', 'fa', 'fna', 'dna', 'embl', 'emb'] },
        { name: 'GenBank', extensions: ['gb', 'gbk', 'genbank'] },
        { name: 'FASTA', extensions: ['fasta', 'fa', 'fna'] },
        { name: 'DNA Binary', extensions: ['dna'] },
        { name: 'EMBL', extensions: ['embl', 'emb'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled || result.filePaths.length === 0) return { success: false, count: 0 }

    // 确保载体文件夹存在
    const vectorsDir = path.join(db.getDataDir(), 'vectors')
    if (!existsSync(vectorsDir)) {
      mkdirSync(vectorsDir, { recursive: true })
    }

    const imported: number[] = []

    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase()

      // 复制文件到专用文件夹
      const destPath = path.join(vectorsDir, fileName)
      copyFileSync(filePath, destPath)

      if (ext === '.dna') {
        // 外部 .dna 二进制格式，需要以Buffer读取
        const buffer = readFileSync(filePath)
        const record = parseDnaFormat(buffer)
        const vectorId = db.createVector({
          name: record.name || fileName.replace('.dna', ''),
          type: record.topology === 'circular' ? 'plasmid' : 'other',
          size_bp: record.size,
          description: record.description,
          sequence: record.sequence,
          backbone_id: null,
          purpose: 'cloning',
          host_type: '[]',
          promoter_type: 'none',
          promoters: '',
          reporter_gene: '',
          is_recombinant: false,
          antibiotic_resistance: '',
          copy_number: '',
          file_path: destPath,
          topology: record.topology,
          source_file: fileName
        })
        imported.push(vectorId)
      } else if (['.gb', '.gbk', '.genbank'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const record = parseGenBank(content)
        const vectorId = db.createVector({
          name: record.name || fileName.replace(ext, ''),
          type: record.topology === 'circular' ? 'plasmid' : 'other',
          size_bp: record.size,
          description: record.description,
          sequence: record.sequence,
          backbone_id: null,
          purpose: 'cloning',
          host_type: '[]',
          promoter_type: 'none',
          promoters: '',
          reporter_gene: '',
          is_recombinant: false,
          antibiotic_resistance: '',
          copy_number: '',
          file_path: destPath,
          topology: record.topology,
          source_file: fileName
        })
        imported.push(vectorId)
      } else if (['.embl', '.emb'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const record = parseEMBL(content)
        const vectorId = db.createVector({
          name: record.name || fileName.replace(ext, ''),
          type: record.topology === 'circular' ? 'plasmid' : 'other',
          size_bp: record.size,
          description: record.description,
          sequence: record.sequence,
          backbone_id: null,
          purpose: 'cloning',
          host_type: '[]',
          promoter_type: 'none',
          promoters: '',
          reporter_gene: '',
          is_recombinant: false,
          antibiotic_resistance: '',
          copy_number: '',
          file_path: destPath,
          topology: record.topology,
          source_file: fileName
        })
        imported.push(vectorId)
      } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const records = parseFasta(content)
        for (const rec of records) {
          const vectorId = db.createVector({
            name: rec.id || fileName.replace(ext, ''),
            type: 'other',
            size_bp: rec.sequence.length,
            description: rec.description,
            sequence: rec.sequence,
            backbone_id: null,
            purpose: 'cloning',
            host_type: '[]',
            promoter_type: 'none',
            promoters: '',
            reporter_gene: '',
            is_recombinant: false,
            antibiotic_resistance: '',
            copy_number: '',
            file_path: destPath,
            topology: 'linear',
            source_file: fileName
          })
          imported.push(vectorId)
        }
      }
    }

    console.log(`[IPC] vector:import complete: ${imported.length} vectors imported`)
    return { success: true, count: imported.length, ids: imported }
  })

  // ============ 基因序列 ============
  loggedHandle(IPC_CHANNELS.GENE_LIST, (_event, type?: string) => {
    return db.getGenes(type as any)
  })

  loggedHandle(IPC_CHANNELS.GENE_GET, (_event, id: number) => {
    return db.getGene(id)
  })

  loggedHandle(IPC_CHANNELS.GENE_SEARCH, (_event, query: string, type?: string) => {
    return db.searchGenes(query, type as any)
  })

  loggedHandle(IPC_CHANNELS.GENE_CREATE, (_event, data) => {
    return db.createGene(data)
  })

  loggedHandle(IPC_CHANNELS.GENE_UPDATE, (_event, id: number, data) => {
    return db.updateGene(id, data)
  })

  loggedHandle(IPC_CHANNELS.GENE_DELETE, (_event, id: number) => {
    return db.deleteGene(id)
  })

  loggedHandle(IPC_CHANNELS.GENE_RELATIONS, (_event, geneId: number) => {
    return db.getGeneRelations(geneId)
  })

  // 基因详情（含转录本 + 交叉引用）
  loggedHandle(IPC_CHANNELS.GENE_GET_DETAILS, (_event, id: number) => {
    return db.getGeneWithDetails(id)
  })

  loggedHandle(IPC_CHANNELS.GENE_TRANSCRIPTS, (_event, geneId: number) => {
    return db.getGeneTranscripts(geneId)
  })

  loggedHandle('db:gene:exons', (_event, transcriptId: number) => {
    return db.getGeneExons(transcriptId)
  })

  loggedHandle(IPC_CHANNELS.GENE_CROSS_REFS, (_event, geneId: number) => {
    return db.getGeneCrossRefs(geneId)
  })

  loggedHandle(IPC_CHANNELS.GENE_SEARCH_SYMBOL, (_event, symbol: string) => {
    return db.searchGenesBySymbol(symbol)
  })

  // 从 NCBI 导入基因（LOC号）
  loggedHandle(IPC_CHANNELS.GENE_IMPORT_NCBI, async (_event, geneId: string) => {
    const apiKey = db.getSetting('ncbi_api_key') || undefined
    return importGeneFromNCBI(geneId, apiKey)
  })

  // 导出基因序列
  safeHandle(IPC_CHANNELS.GENE_EXPORT, async (event, geneId: number, format: string) => {
    const gene = db.getGene(geneId)
    if (!gene) return { success: false, message: '基因不存在' }

    const win = event.sender.getOwnerBrowserWindow()

    if (format === 'json') {
      // JSON 导出：含完整元数据 + 转录本
      const details = db.getGeneWithDetails(geneId)
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${gene.gene_name || gene.id}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { success: false }
      writeFileSync(result.filePath, JSON.stringify(details, null, 2), 'utf-8')
      return { success: true, path: result.filePath }
    }

    if (format === 'gff3') {
      // GFF3 导出
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${gene.gene_name || gene.id}.gff3`,
        filters: [{ name: 'GFF3', extensions: ['gff3', 'gff'] }]
      })
      if (result.canceled || !result.filePath) return { success: false }
      const gff = generateGFF3(gene)
      writeFileSync(result.filePath, gff, 'utf-8')
      return { success: true, path: result.filePath }
    }

    if (format === 'fasta') {
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${gene.gene_name || gene.id}.fasta`,
        filters: [{ name: 'FASTA', extensions: ['fasta', 'fa'] }]
      })
      if (result.canceled || !result.filePath) return { success: false }
      const fasta = `>${gene.gene_name} ${gene.description}\n${gene.sequence.match(/.{1,60}/g)?.join('\n') || ''}\n`
      writeFileSync(result.filePath, fasta, 'utf-8')
      return { success: true, path: result.filePath }
    }

    // GenBank 格式
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${gene.gene_name || gene.id}.gb`,
      filters: [{ name: 'GenBank', extensions: ['gb'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    let features: GenBankFeature[] = []
    if (gene.features_json) {
      try { features = JSON.parse(gene.features_json) } catch { /* ignore */ }
    }
    const gb = generateGeneGenBank(gene, features)
    writeFileSync(result.filePath, gb, 'utf-8')
    return { success: true, path: result.filePath }
  })

  // ============ 应用设置 ============
  loggedHandle(IPC_CHANNELS.SETTINGS_GET, (_event, key: string) => {
    return db.getSetting(key)
  })

  loggedHandle(IPC_CHANNELS.SETTINGS_SET, (_event, key: string, value: string) => {
    db.setSetting(key, value)
    return true
  })

  // ============ 实验室载体 ============
  loggedHandle(IPC_CHANNELS.LAB_VECTOR_LIST, () => {
    return db.getLabVectors()
  })

  loggedHandle(IPC_CHANNELS.LAB_VECTOR_GET, (_event, id: number) => {
    return db.getLabVector(id)
  })

  loggedHandle(IPC_CHANNELS.LAB_VECTOR_CREATE, (_event, data) => {
    return db.createLabVector(data)
  })

  loggedHandle(IPC_CHANNELS.LAB_VECTOR_UPDATE, (_event, id: number, data) => {
    return db.updateLabVector(id, data)
  })

  loggedHandle(IPC_CHANNELS.LAB_VECTOR_DELETE, (_event, id: number) => {
    return db.deleteLabVector(id)
  })

  // ============ 文件操作 ============
  safeHandle(IPC_CHANNELS.FILE_OPEN, async (event) => {
    log.info('file:open — dialog opening')
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      filters: [
        { name: '序列文件', extensions: ['gb', 'gbk', 'genbank', 'fasta', 'fa', 'fna', 'dna', 'embl', 'emb'] },
        { name: 'GenBank', extensions: ['gb', 'gbk', 'genbank'] },
        { name: 'FASTA', extensions: ['fasta', 'fa', 'fna'] },
        { name: 'DNA Binary', extensions: ['dna'] },
        { name: 'EMBL', extensions: ['embl', 'emb'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const filePath = result.filePaths[0]
    const ext = path.extname(filePath).toLowerCase()
    console.log(`[IPC] file:open — ${filePath} (${ext})`)

    if (ext === '.dna') {
      // 外部 .dna 二进制格式
      const buffer = readFileSync(filePath)
      return { type: 'genbank', data: parseDnaFormat(buffer), filePath }
    }

    const content = readFileSync(filePath, 'utf-8')
    if (['.gb', '.gbk', '.genbank'].includes(ext)) {
      return { type: 'genbank', data: parseGenBank(content), filePath }
    } else if (['.embl', '.emb'].includes(ext)) {
      return { type: 'genbank', data: parseEMBL(content), filePath }
    } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
      return { type: 'fasta', data: parseFasta(content), filePath }
    }

    return null
  })

  loggedHandle(IPC_CHANNELS.FILE_PARSE_GENBANK, (_event, content: string) => {
    return parseGenBank(content)
  })

  loggedHandle(IPC_CHANNELS.FILE_PARSE_FASTA, (_event, content: string) => {
    return parseFasta(content)
  })

  // ============ 编辑器窗口 ============
  loggedHandle(IPC_CHANNELS.EDITOR_OPEN, (_event, vectorId: number) => {
    createEditorWindow(vectorId)
  })

  loggedHandle(IPC_CHANNELS.EDITOR_GET_DATA, (_event, vectorId: number) => {
    const vector = db.getVector(vectorId)
    if (!vector) return null

    // 优先使用数据库中存储的 features_json（编辑器修改后的版本）
    let features: GenBankFeature[] = []
    if ((vector as any).features_json) {
      try { features = JSON.parse((vector as any).features_json) } catch { /* ignore */ }
    }

    // 如果 DB 中没有存储 features，从文件解析
    if (features.length === 0 && vector.file_path && existsSync(vector.file_path)) {
      features = readFeaturesFromFile(vector.file_path)
    }

    // 如果数据库没有序列但有文件，从文件读取
    let sequence = vector.sequence || ''
    if (!sequence && vector.file_path && existsSync(vector.file_path)) {
      const ext = path.extname(vector.file_path).toLowerCase()
      if (ext === '.dna') {
        const buffer = readFileSync(vector.file_path)
        const record = parseDnaFormat(buffer)
        sequence = record.sequence
        if (features.length === 0) features = record.features
      } else if (['.gb', '.gbk', '.genbank'].includes(ext)) {
        const content = readFileSync(vector.file_path, 'utf-8')
        const record = parseGenBank(content)
        sequence = record.sequence
        if (features.length === 0) features = record.features
      } else if (['.embl', '.emb'].includes(ext)) {
        const content = readFileSync(vector.file_path, 'utf-8')
        const record = parseEMBL(content)
        sequence = record.sequence
        if (features.length === 0) features = record.features
      } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
        const fastaContent = readFileSync(vector.file_path, 'utf-8')
        const records = parseFasta(fastaContent)
        if (records.length > 0) sequence = records[0].sequence
      }
    }

    const enzymeSites = db.getVectorEnzymeSites(vectorId)

    return {
      vector: { ...vector, sequence },
      features,
      enzymeSites
    }
  })

  loggedHandle(IPC_CHANNELS.EDITOR_SAVE_SEQUENCE, (_event, vectorId: number, sequence: string) => {
    db.updateVector(vectorId, { sequence, size_bp: sequence.length })
    return true
  })

  loggedHandle(IPC_CHANNELS.EDITOR_ADD_FEATURE, (_event, _vectorId: number, _feature: GenBankFeature) => {
    // Features are stored via GenBank file; for in-memory editing, handled in renderer
    return true
  })

  loggedHandle(IPC_CHANNELS.EDITOR_SAVE_FEATURES, (_event, vectorId: number, features: GenBankFeature[]) => {
    db.saveVectorFeatures(vectorId, features)
    return true
  })

  // ============ 菜单语言切换 ============
  ipcMain.on(IPC_CHANNELS.MENU_SET_LANGUAGE, (_event, lang: 'zh' | 'en') => {
    console.log(`[IPC] menu:set-language: ${lang}`)
    setLanguage(lang)
    buildMenu()
  })

  // ============ 文件另存为 ============
  loggedHandle(IPC_CHANNELS.FILE_SAVE_GENBANK, async (event, vectorId: number) => {
    const vector = db.getVector(vectorId)
    if (!vector) return false
    let features: GenBankFeature[] = []
    if (vector.file_path && existsSync(vector.file_path)) {
      const ext = path.extname(vector.file_path).toLowerCase()
      if (ext === '.dna') {
        const buffer = readFileSync(vector.file_path)
        const record = parseDnaFormat(buffer)
        features = record.features
      } else if (['.gb', '.gbk', '.genbank'].includes(ext)) {
        const content = readFileSync(vector.file_path, 'utf-8')
        const record = parseGenBank(content)
        features = record.features
      }
    }
    const genbank = generateGenBank(vector, features)
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${vector.name}.gb`,
      filters: [{ name: 'GenBank', extensions: ['gb'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, genbank, 'utf-8')
    return true
  })

  // 通用 GenBank 导出（接受原始数据，gene/vector 模式均可用）
  loggedHandle(IPC_CHANNELS.FILE_EXPORT_GENBANK_DATA, async (event, data: { name: string; sequence: string; features: GenBankFeature[]; topology?: string }) => {
    const fakeVector = {
      name: data.name || 'export',
      sequence: data.sequence || '',
      size_bp: (data.sequence || '').length,
      topology: (data.topology || 'linear') as 'circular' | 'linear'
    } as any
    const genbank = generateGenBank(fakeVector, data.features || [])
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${data.name || 'export'}.gb`,
      filters: [{ name: 'GenBank', extensions: ['gb'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, genbank, 'utf-8')
    return true
  })

  loggedHandle(IPC_CHANNELS.FILE_SAVE_FASTA, async (event, vectorId: number) => {
    const vector = db.getVector(vectorId)
    if (!vector) return false
    const fasta = generateFasta(vector)
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${vector.name}.fasta`,
      filters: [{ name: 'FASTA', extensions: ['fasta', 'fa'] }]
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, fasta, 'utf-8')
    return true
  })

  // ============ 载体批量导出 ============
  loggedHandle(IPC_CHANNELS.VECTOR_BATCH_EXPORT, async (event, vectorIds: number[], format: 'genbank' | 'fasta' | 'dna') => {
    const win = event.sender.getOwnerBrowserWindow()
    const extMap: Record<string, string> = { genbank: '.gb', fasta: '.fasta', dna: '.dna' }
    const filterMap: Record<string, { name: string; extensions: string[] }> = {
      genbank: { name: 'GenBank', extensions: ['gb'] },
      fasta: { name: 'FASTA', extensions: ['fasta', 'fa'] },
      dna: { name: 'DNA Binary', extensions: ['dna'] },
    }
    const ext = extMap[format] || '.gb'

    // 获取载体数据并解析 features
    type ExportItem = { vector: Vector; features: GenBankFeature[] }
    const items: ExportItem[] = []
    for (const id of vectorIds) {
      const vector = db.getVector(id)
      if (!vector) continue
      let features: GenBankFeature[] = []
      if (vector.features_json) {
        try { features = JSON.parse(vector.features_json) } catch (_) { features = [] }
      } else if (vector.file_path && existsSync(vector.file_path)) {
        const fext = path.extname(vector.file_path).toLowerCase()
        try {
          if (fext === '.dna') { features = parseDnaFormat(readFileSync(vector.file_path)).features }
          else if (['.gb', '.gbk', '.genbank'].includes(fext)) { features = parseGenBank(readFileSync(vector.file_path, 'utf-8')).features }
        } catch (_) { /* ignore parse errors */ }
      }
      items.push({ vector, features })
    }
    if (items.length === 0) return { success: false, count: 0, paths: [] }

    const savedPaths: string[] = []

    if (items.length === 1) {
      // 单个载体: showSaveDialog
      const { vector, features } = items[0]
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${vector.name}${ext}`,
        filters: [filterMap[format]]
      })
      if (result.canceled || !result.filePath) return { success: false, count: 0, paths: [] }
      writeExportFile(result.filePath, format, vector, features)
      savedPaths.push(result.filePath)
    } else {
      // 多个载体: showOpenDialog 选择文件夹
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory'],
        title: `选择导出文件夹（${items.length} 个载体）`
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, count: 0, paths: [] }
      const dir = result.filePaths[0]
      for (const { vector, features } of items) {
        const fileName = `${(vector.name || 'unnamed').replace(/[\\/:*?"<>|]/g, '_')}${ext}`
        const filePath = path.join(dir, fileName)
        writeExportFile(filePath, format, vector, features)
        savedPaths.push(filePath)
      }
    }

    return { success: true, count: savedPaths.length, paths: savedPaths }
  })

  // ============ 引物 ============
  loggedHandle(IPC_CHANNELS.PRIMER_LIST, (_event, category?: string) => {
    return db.getPrimers(category as any)
  })

  loggedHandle(IPC_CHANNELS.PRIMER_GET, (_event, id: number) => {
    return db.getPrimer(id)
  })

  loggedHandle(IPC_CHANNELS.PRIMER_SEARCH, (_event, query: string, category?: string) => {
    return db.searchPrimers(query, category as any)
  })

  loggedHandle(IPC_CHANNELS.PRIMER_CREATE, (_event, data: any) => {
    return db.createPrimer(data)
  })

  loggedHandle(IPC_CHANNELS.PRIMER_UPDATE, (_event, id: number, data: any) => {
    db.updatePrimer(id, data)
    return true
  })

  loggedHandle(IPC_CHANNELS.PRIMER_DELETE, (_event, id: number) => {
    db.deletePrimer(id)
    return true
  })

  loggedHandle(IPC_CHANNELS.PRIMER_ALIGN, (_event, primerId: number) => {
    return db.alignPrimerToGenes(primerId)
  })

  loggedHandle(IPC_CHANNELS.PRIMER_SCAN_VECTOR, (_event, vectorSeq: string) => {
    return db.scanVectorForUniversalPrimers(vectorSeq)
  })

  loggedHandle(IPC_CHANNELS.PRIMER_IMPORT_XLSX, async (event) => {
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return 0
    const buffer = readFileSync(result.filePaths[0])
    return db.importPrimersFromXlsx(buffer)
  })

  // ============ 测序文件 ============
  loggedHandle(IPC_CHANNELS.SEQUENCING_FILE_LIST, () => {
    return db.getSequencingFiles()
  })

  loggedHandle(IPC_CHANNELS.SEQUENCING_FILE_GET, (_event, id: number) => {
    return db.getSequencingFile(id)
  })

  loggedHandle(IPC_CHANNELS.SEQUENCING_FILE_SEARCH, (_event, query: string) => {
    return db.searchSequencingFiles(query)
  })

  loggedHandle(IPC_CHANNELS.SEQUENCING_FILE_CREATE, (_event, data: any) => {
    return db.createSequencingFile(data)
  })

  loggedHandle(IPC_CHANNELS.SEQUENCING_FILE_UPDATE, (_event, id: number, data: any) => {
    db.updateSequencingFile(id, data)
    return true
  })

  loggedHandle(IPC_CHANNELS.SEQUENCING_FILE_DELETE, (_event, id: number) => {
    db.deleteSequencingFile(id)
    return true
  })

  // ============ 测序文件导入 ============
  safeHandle(IPC_CHANNELS.SEQUENCING_FILE_IMPORT, async (event) => {
    log.info('sequencing:import — dialog opening')
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入测序文件',
      filters: [
        { name: '测序文件', extensions: ['ab1', 'seq', 'fasta', 'fa'] },
        { name: 'AB1 (Applied Biosystems)', extensions: ['ab1'] },
        { name: 'SEQ/FASTA', extensions: ['seq', 'fasta', 'fa'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, count: 0 }

    const seqDir = path.join(db.getDataDir(), 'sequencing')
    if (!existsSync(seqDir)) mkdirSync(seqDir, { recursive: true })

    const imported: number[] = []
    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const destPath = path.join(seqDir, fileName)
      copyFileSync(filePath, destPath)

      let fileType: 'ab1' | 'seq' | 'fasta' = 'seq'
      if (ext === '.ab1') fileType = 'ab1'
      else if (['.fasta', '.fa'].includes(ext)) fileType = 'fasta'

      let sequence = ''
      let traceData = ''
      let peakPositions = ''
      let qualityValues = ''
      let runInfo = ''
      let sampleName = fileName.replace(ext, '')

      if (ext === '.ab1') {
        try {
          const buffer = readFileSync(filePath)
          console.log(`[AB1] Parsing file: ${fileName} (${buffer.length} bytes)`)
          const ab1 = parseAb1(buffer)
          sequence = ab1.sequence
          traceData = JSON.stringify(ab1.traces)
          peakPositions = JSON.stringify(ab1.peakPositions)
          qualityValues = JSON.stringify(ab1.qualityValues)
          runInfo = ab1.runInfo
          sampleName = ab1.sampleName || sampleName
          console.log(`[AB1] Parse success: seq=${ab1.sequence.length}bp, traces=${ab1.dataPoints}pts, peaks=${ab1.peakPositions.length}`)
        } catch (err: any) {
          console.error(`[AB1] 解析失败 ${fileName}:`, err.message)
          // 解析失败仍然导入文件，只是没有 trace 数据
        }
      } else if (['.fasta', '.fa'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const records = parseFasta(content)
        if (records.length > 0) {
          sequence = records[0].sequence
          sampleName = records[0].id || sampleName
        }
      } else if (ext === '.seq') {
        // .seq 文件可能是纯序列或 FASTA 格式
        const content = readFileSync(filePath, 'utf-8').replace(/\r/g, '').trim()
        if (content.startsWith('>')) {
          // FASTA 格式
          const records = parseFasta(content)
          if (records.length > 0) {
            sequence = records[0].sequence.toUpperCase()
            sampleName = records[0].id || sampleName
          }
        } else {
          // 纯序列格式：去除数字、空格、换行等非序列字符
          sequence = content.replace(/[^A-Za-z]/g, '').toUpperCase()
        }
      }

      const id = db.createSequencingFile({
        file_name: fileName,
        file_path: destPath,
        file_type: fileType,
        sample_name: sampleName,
        direction: 'forward',
        primer_id: null,
        sequence,
        trace_data: traceData,
        peak_positions: peakPositions,
        quality_values: qualityValues,
        run_info: runInfo,
        notes: ''
      })
      imported.push(id)
    }
    console.log(`[IPC] sequencing:import complete: ${imported.length} files imported`)
    return { success: true, count: imported.length, ids: imported }
  })

  safeHandle(IPC_CHANNELS.SEQUENCING_FILE_READ, (_event, id: number) => {
    return processSequencingFile(id)
  })

  // ============ 基因序列文件导入 ============
  safeHandle(IPC_CHANNELS.GENE_IMPORT_FILE, async () => {
    log.info('gene:import-file — dialog opening')
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Sequence Files', extensions: ['gb', 'gbk', 'genbank', 'fasta', 'fa', 'fna'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, count: 0 }

    let count = 0
    for (const filePath of result.filePaths) {
      try {
        const ext = path.extname(filePath).toLowerCase()
        const fileName = path.basename(filePath)
        const nameWithoutExt = fileName.replace(/\.[^.]+$/, '')

        if (['.gb', '.gbk', '.genbank'].includes(ext)) {
          const content = readFileSync(filePath, 'utf-8')
          const record = parseGenBank(content)
          db.createGene({
            gene_name: record.name || nameWithoutExt,
            type: 'genomic',
            species: '',
            sequence: record.sequence || '',
            accession_number: record.accession || '',
            description: record.description || '',
            features_json: JSON.stringify(record.features || []),
            topology: record.topology || 'linear',
            file_path: filePath
          })
          count++
        } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
          const content = readFileSync(filePath, 'utf-8')
          const records = parseFasta(content)
          for (const rec of records) {
            // 推断 type：检查是否含终止密码子或全是蛋白字符
            const seq = rec.sequence.toUpperCase()
            const isProtein = !/[^ACDEFGHIKLMNPQRSTVWY]/.test(seq) && /[KRHLY]/.test(seq)
            db.createGene({
              gene_name: rec.id || nameWithoutExt,
              type: isProtein ? 'protein' : 'genomic',
              species: '',
              sequence: rec.sequence,
              accession_number: '',
              description: rec.description || '',
              features_json: '[]',
              topology: 'linear',
              file_path: filePath
            })
            count++
          }
        }
      } catch (e) {
        console.error(`[GeneImport] Failed to import ${filePath}:`, e)
      }
    }
    console.log(`[IPC] gene:import-file complete: ${count} genes imported`)
    return { success: true, count }
  })

  // ============ 基因编辑器窗口 ============
  loggedHandle(IPC_CHANNELS.GENE_EDITOR_OPEN, (_event, geneId: number) => {
    createGeneEditorWindow(geneId)
  })

  // 打开转录本/蛋白质序列编辑器
  loggedHandle(IPC_CHANNELS.GENE_EDITOR_OPEN_TRANSCRIPT, (_event, geneId: number, transcriptId: number, seqType: 'mrna' | 'protein') => {
    createGeneEditorWindow(geneId, transcriptId, seqType)
  })

  loggedHandle(IPC_CHANNELS.GENE_EDITOR_GET_DATA, (_event, geneId: number, transcriptId?: number, seqType?: 'mrna' | 'protein') => {
    const gene = db.getGene(geneId)
    if (!gene) return null

    // 如果指定了转录本 ID，返回转录本/蛋白质序列
    if (transcriptId) {
      const transcript = db.getGeneTranscript(transcriptId)
      if (!transcript) return null

      if (seqType === 'protein') {
        // 返回蛋白质序列
        return {
          gene: {
            ...gene,
            sequence: transcript.protein_sequence || '',
            gene_name: `${transcript.transcript_id} (Protein)`,
            type: 'protein' as const
          },
          features: [],
          topology: 'linear' as const,
          isProtein: true
        }
      } else {
        // 返回 mRNA 序列，构建 CDS/UTR/exon features
        const features: GenBankFeature[] = []
        const mrnaLen = transcript.mrna_sequence?.length || 0
        const cdsLen = transcript.cds_sequence?.length || 0

        // 从外显子表构建 features
        const exons = db.getGeneExons(transcriptId)
        console.log(`[GeneEditor] mRNA features: transcriptId=${transcriptId}, exons count=${exons.length}, mrnaLen=${mrnaLen}, cdsLen=${cdsLen}`)
        for (const exon of exons) {
          console.log(`[GeneEditor] Exon ${exon.exon_number}: start=${exon.start}, end=${exon.end}, utr_type=${exon.utr_type}, strand=${exon.strand}`)
        }

        // 1. 添加所有外显子 features
        for (const exon of exons) {
          features.push({
            type: 'exon',
            location: `${exon.start}..${exon.end}`,
            start: exon.start - 1,
            end: exon.end,
            strand: exon.strand,
            qualifiers: { number: String(exon.exon_number) }
          })
        }

        // 2. 计算 CDS 坐标（从 transcript 表获取 cds_start/cds_end）
        let cdsStart = transcript.cds_start || 1
        let cdsEnd = transcript.cds_end || mrnaLen

        // 如果数据库中没有 CDS 坐标，从 cds_sequence 长度推断
        if ((!transcript.cds_start || !transcript.cds_end) && cdsLen > 0 && cdsLen <= mrnaLen) {
          // 简化处理：假设 CDS 从位置 157 开始（对于 XM_015779610.3）
          // 实际应该从 transcript 表获取 cds_start 字段
          cdsStart = 157  // TODO: 从数据库获取
          cdsEnd = cdsStart + cdsLen - 1
        }

        console.log(`[GeneEditor] CDS: ${cdsStart}..${cdsEnd} (cdsLen=${cdsLen}, from db: ${transcript.cds_start}..${transcript.cds_end})`)

        // 3. 添加 CDS feature
        if (cdsLen > 0) {
          features.push({
            type: 'CDS',
            location: `${cdsStart}..${cdsEnd}`,
            start: cdsStart - 1,
            end: cdsEnd,
            strand: 1,
            qualifiers: { product: transcript.name || 'CDS' }
          })
        }

        // 4. 添加 5'UTR feature（CDS 之前的区域）
        if (cdsStart > 1) {
          features.push({
            type: 'five_prime_UTR',
            location: `1..${cdsStart - 1}`,
            start: 0,
            end: cdsStart - 1,
            strand: 1,
            qualifiers: {}
          })
          console.log(`[GeneEditor] 5'UTR: 1..${cdsStart - 1}`)
        }

        // 5. 添加 3'UTR feature（CDS 之后的区域）
        if (cdsEnd < mrnaLen) {
          features.push({
            type: 'three_prime_UTR',
            location: `${cdsEnd + 1}..${mrnaLen}`,
            start: cdsEnd,
            end: mrnaLen,
            strand: 1,
            qualifiers: {}
          })
          console.log(`[GeneEditor] 3'UTR: ${cdsEnd + 1}..${mrnaLen}`)
        }

        return {
          gene: {
            ...gene,
            sequence: transcript.mrna_sequence || '',
            gene_name: transcript.transcript_id,
            type: 'mrna' as const
          },
          features,
          topology: 'linear' as const,
          isProtein: false
        }
      }
    }

    // 默认返回基因组序列
    let features: GenBankFeature[] = []
    // 从 features_json 解析
    if (gene.features_json) {
      try { features = JSON.parse(gene.features_json) } catch { /* ignore */ }
    }
    // 如果有文件路径且 features 为空，尝试从文件解析
    if (features.length === 0 && gene.file_path && existsSync(gene.file_path)) {
      try {
        features = readFeaturesFromFile(gene.file_path)
      } catch (e) { console.error('[GeneEditor] Failed to parse file:', e) }
    }
    // 从 mRNA join() 推断 exon/intron（对已导入但缺少 exon/intron 的旧数据生效）
    if (features.length > 0) {
      const beforeCount = features.length
      inferExonIntronFeatures(features)
      if (features.length > beforeCount) {
        console.log(`[GeneEditor] Inferred exon/intron: ${beforeCount} → ${features.length} features`)
      }
    }

    return {
      gene: { ...gene },
      features,
      topology: gene.topology || 'linear',
      isProtein: false
    }
  })

  loggedHandle(IPC_CHANNELS.GENE_EDITOR_SAVE_SEQUENCE, (_event, geneId: number, sequence: string) => {
    db.updateGene(geneId, { sequence })
    return true
  })

  // 获取基因的相关序列
  loggedHandle(IPC_CHANNELS.GENE_GET_RELATED_SEQUENCES, (_event, geneId: number) => {
    return db.getGeneRelatedSequences(geneId)
  })

  // 打开相关序列编辑器：按需下载序列并打开编辑器窗口
  loggedHandle(IPC_CHANNELS.GENE_RELATED_SEQ_OPEN_EDITOR, async (_event, geneId: number, relatedSeqId: number, seqType: string) => {
    const relatedSeq = db.getGeneRelatedSequence(relatedSeqId)
    if (!relatedSeq) {
      console.warn(`[IPC] Related seq ${relatedSeqId} not found`)
      return { success: false, message: 'Related sequence not found' }
    }

    const accession = relatedSeq.nucleotide_accession || relatedSeq.protein_accession || ''
    if (!accession) {
      return { success: false, message: 'No accession for this related sequence' }
    }

    // 获取 API Key
    const settings = db.getAllSettings()
    const apiKey = settings['ncbi_api_key'] || ''

    // 如果本地没有缓存内容，从 NCBI 下载
    if (!relatedSeq.ncbi_content) {
      console.log(`[IPC] Downloading related seq: ${accession} (type=${relatedSeq.seq_type})`)
      try {
        let content = ''
        if (relatedSeq.seq_type === 'protein') {
          // 蛋白质用 FASTA 格式下载
          const proteinSeq = await fetchProteinSequence(accession, apiKey || undefined)
          // 包装为简单 GenBank 格式以便解析
          content = `LOCUS       ${accession}               ${proteinSeq.length} aa    linear   UNK
DEFINITION  ${relatedSeq.description}
ACCESSION   ${accession}
ORIGIN
        1 ${proteinSeq.toLowerCase()}
//
`
        } else {
          // genomic/mRNA 用 GenBank 格式下载
          const result = await fetchMRNASequence(accession, apiKey || undefined)
          content = result.content
        }
        // 缓存到数据库
        db.updateGeneRelatedSequenceContent(relatedSeqId, content)
        console.log(`[IPC] Downloaded and cached: ${accession} (${content.length} bytes)`)
      } catch (err: any) {
        console.warn(`[IPC] Failed to download ${accession}:`, err.message)
        return { success: false, message: `Download failed: ${err.message}` }
      }
    }

    // 打开编辑器窗口
    createRelatedSeqEditorWindow(geneId, relatedSeqId, seqType)
    return { success: true }
  })

  // 获取相关序列编辑器数据
  loggedHandle(IPC_CHANNELS.GENE_RELATED_SEQ_GET_DATA, (_event, relatedSeqId: number) => {
    const relatedSeq = db.getGeneRelatedSequence(relatedSeqId)
    if (!relatedSeq) {
      console.warn(`[IPC] Related seq ${relatedSeqId} not found`)
      return null
    }

    const content = relatedSeq.ncbi_content
    if (!content) {
      console.warn(`[IPC] Related seq ${relatedSeqId} has no cached content`)
      return null
    }

    // 解析序列内容（支持 GenBank 和 FASTA 两种格式）
    try {
      const accession = relatedSeq.nucleotide_accession || relatedSeq.protein_accession || ''
      const gene = db.getGene(relatedSeq.gene_id)
      const isProtein = relatedSeq.seq_type === 'protein'

      let sequence = ''
      let features: any[] = []

      if (content.startsWith('LOCUS') || content.includes('ORIGIN')) {
        // GenBank 格式
        const record = parseGenBank(content)
        sequence = record.sequence
        features = record.features || []
      } else if (content.startsWith('>')) {
        // FASTA 格式：提取纯序列
        sequence = content.replace(/^>[^\n]*\n?/, '').replace(/\s+/g, '')
      } else {
        // 纯序列
        sequence = content.replace(/\s+/g, '')
      }

      if (!sequence) {
        console.warn(`[IPC] Related seq ${relatedSeqId} has empty sequence after parsing`)
        return null
      }

      const typeLabel = isProtein ? 'Protein' : relatedSeq.seq_type === 'genomic' ? 'Genomic' : 'mRNA'
      return {
        gene: {
          ...gene,
          sequence,
          gene_name: `${accession.replace(/^(MSU|RAPDB):/, '').replace(/:(CDS|Protein|mRNA)$/, '')} (${typeLabel})`,
          type: isProtein ? 'protein' as const : relatedSeq.seq_type as any
        },
        features,
        topology: 'linear' as const,
        isProtein
      }
    } catch (err: any) {
      console.warn(`[IPC] Failed to parse content for related seq ${relatedSeqId}:`, err.message)
      return null
    }
  })

  // ============ 物种基因数据库插件 ============

  // 获取所有物种插件（含注释统计）
  loggedHandle(IPC_CHANNELS.SPECIES_PLUGIN_LIST, () => {
    const plugins = db.getSpeciesPlugins()
    return plugins.map(plugin => {
      const stats = db.getPluginAnnotationStats(plugin.id)
      return { ...plugin, annotation_count: stats.total, annotation_matched: stats.matched }
    })
  })

  // 安装物种插件（打开文件对话框选择 .plugin 文件，解压后安装，自动导入数据）
  safeHandle(IPC_CHANNELS.SPECIES_PLUGIN_INSTALL, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || undefined
    const sendProgress = (message: string, percent: number) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SPECIES_PLUGIN_PROGRESS, { message, percent })
      }
    }

    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      title: '选择 .plugin 插件文件',
      filters: [
        { name: 'Plugin Files', extensions: ['plugin'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, message: '已取消' }
    }
    const pluginFile = result.filePaths[0]

    sendProgress('正在解压插件文件...', 3)

    // Unzip .plugin file to temp directory
    const tmpDir = path.join(tmpdir(), `helixcraft-plugin-${Date.now()}`)
    try {
      const zipBuffer = readFileSync(pluginFile)
      unzipToDirectory(zipBuffer, tmpDir)
    } catch (unzipErr: any) {
      return { success: false, message: `插件文件解压失败: ${unzipErr.message}` }
    }

    // Find the inner plugin directory (should contain plugin.json)
    let pluginDir = tmpDir
    const entries = readdirSync(tmpDir)
    if (entries.length === 1) {
      const candidate = path.join(tmpDir, entries[0])
      if (existsSync(path.join(candidate, 'plugin.json'))) {
        pluginDir = candidate
      }
    }

    if (!existsSync(path.join(pluginDir, 'plugin.json'))) {
      // Cleanup temp
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch (_e) {}
      return { success: false, message: '无效的插件文件：未找到 plugin.json' }
    }

    sendProgress('正在安装插件...', 5)
    let config: any, pluginId: number
    try {
      const installResult = await speciesPluginService.installPlugin(pluginDir)
      config = installResult.config
      pluginId = installResult.pluginId
    } finally {
      // Always cleanup temp directory
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch (_e) {}
    }

    // 安装后自动导入 CSV 数据
    let imported = 0
    let matched = 0
    try {
      console.log(`[IPC] Auto-importing data for plugin: ${config.speciesName} (id=${pluginId})`)
      sendProgress('正在导入 CSV 数据...', 10)
      const importResult = await speciesPluginService.importPluginData(pluginId, (msg, pct) => {
        sendProgress(msg, pct)
      })
      imported = importResult.imported
      matched = importResult.matched
    } catch (importErr: any) {
      console.warn(`[IPC] Auto-import failed (plugin still installed):`, importErr.message)
      sendProgress('安装完成，但数据导入失败', 100)
      return { success: true, message: `已安装物种插件: ${config.speciesName}，但数据导入失败: ${importErr.message}`, speciesName: config.speciesName, imported: 0, matched: 0 }
    }

    sendProgress('安装完成', 100)
    return { success: true, message: `已安装并导入物种插件: ${config.speciesName}（${imported} 条注释，${matched} 条已匹配）`, speciesName: config.speciesName, imported, matched }
  })

  // 卸载物种插件
  loggedHandle(IPC_CHANNELS.SPECIES_PLUGIN_UNINSTALL, (_event, pluginId: number) => {
    speciesPluginService.uninstallPlugin(pluginId)
    return { success: true }
  })

  // 启用/禁用物种插件
  loggedHandle(IPC_CHANNELS.SPECIES_PLUGIN_TOGGLE, (_event, pluginId: number, enabled: boolean) => {
    db.toggleSpeciesPlugin(pluginId, enabled)
    return { success: true }
  })

  // 导入物种插件数据（CSV）
  safeHandle(IPC_CHANNELS.SPECIES_PLUGIN_IMPORT_DATA, async (event, pluginId: number) => {
    const win = BrowserWindow.fromWebContents(event.sender) || undefined
    const sendProgress = (message: string, percent: number) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SPECIES_PLUGIN_PROGRESS, { message, percent })
      }
    }
    sendProgress('正在导入数据...', 5)
    const result = await speciesPluginService.importPluginData(pluginId, (msg, pct) => {
      sendProgress(msg, pct)
    })
    sendProgress('导入完成', 100)
    return { success: true, imported: result.imported, matched: result.matched }
  })

  // 导出物种插件备份（复制插件目录到用户选择位置）
  safeHandle(IPC_CHANNELS.SPECIES_PLUGIN_EXPORT, async (event, pluginId: number) => {
    const plugin = db.getSpeciesPlugin(pluginId)
    if (!plugin) return { success: false, message: 'Plugin not found' }

    const pluginDir = speciesPluginService.getPluginDataDir(plugin.species_name)

    if (!existsSync(pluginDir)) {
      return { success: false, message: `Plugin directory not found: ${pluginDir}` }
    }

    // Show save dialog for .plugin file
    const win = BrowserWindow.fromWebContents(event.sender) || undefined
    const saveResult = await dialog.showSaveDialog(win!, {
      title: `导出 ${plugin.species_name} 插件`,
      defaultPath: `species-${plugin.species_name}-v${plugin.version}.plugin`,
      filters: [
        { name: 'Plugin Files', extensions: ['plugin'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, message: '已取消' }
    }

    const targetFile = saveResult.filePath

    // Package directory into .plugin (zip) file
    const innerDirName = `species-${plugin.species_name}`
    const zipBuffer = zipDirectory(pluginDir, innerDirName)
    writeFileSync(targetFile, zipBuffer)

    console.log(`[IPC] Exported plugin ${plugin.species_name} to ${targetFile} (${zipBuffer.length} bytes)`)
    return { success: true, filePath: targetFile }
  })

  // 获取基因的物种注释
  loggedHandle(IPC_CHANNELS.SPECIES_GET_ANNOTATIONS, (_event, geneId: number) => {
    return db.getAnnotationsByGene(geneId)
  })

  // 从 MSU 网站获取基因信息
  loggedHandle(IPC_CHANNELS.SPECIES_FETCH_MSU_INFO, async (_event, accession: string) => {
    try {
      const info = await speciesPluginService.fetchMSUGeneInfo(accession)
      return { success: true, data: info }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从 MSU 网站获取基因序列
  loggedHandle(IPC_CHANNELS.SPECIES_FETCH_MSU_SEQUENCES, async (_event, accession: string, variants?: Array<{ id: string; url: string }>) => {
    try {
      const sequences = await speciesPluginService.fetchMSUSequences(accession, variants)
      return { success: true, data: sequences }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从国家水稻数据中心获取基因信息
  loggedHandle(IPC_CHANNELS.SPECIES_FETCH_RICEDATA_INFO, async (_event, ricedataId: string) => {
    try {
      const info = await speciesPluginService.fetchRiceDataGeneInfo(ricedataId)
      return { success: true, data: info }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 更新 RiceData 在线数据到本地数据库
  loggedHandle(IPC_CHANNELS.SPECIES_UPDATE_RICEDATA, async (_event, annotationIds: number[], data: any) => {
    try {
      const result = speciesPluginService.updateRiceDataAnnotation(annotationIds, data)
      return { success: true, data: result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 缓存 MSU 在线数据到本地数据库
  loggedHandle(IPC_CHANNELS.SPECIES_CACHE_MSU_INFO, async (_event, annotationId: number, msuData: any) => {
    try {
      const result = speciesPluginService.cacheMSUInfo(annotationId, msuData)
      return { success: result.success }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从 RAP-DB 获取基因座信息
  loggedHandle(IPC_CHANNELS.SPECIES_FETCH_RAPDB_INFO, async (_event, accession: string) => {
    try {
      const info = await speciesPluginService.fetchRAPDBLocusInfo(accession)
      return { success: true, data: info }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从 RAP-DB 获取转录本序列
  loggedHandle(IPC_CHANNELS.SPECIES_FETCH_RAPDB_TRANSCRIPT, async (_event, accession: string) => {
    try {
      const data = await speciesPluginService.fetchRAPDBTranscript(accession)
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从 RAP-DB 获取表达数据
  loggedHandle(IPC_CHANNELS.SPECIES_FETCH_RAPDB_EXPRESSION, async (_event, accession: string, rxpId: string) => {
    try {
      const data = await speciesPluginService.fetchRAPDBExpression(accession, rxpId)
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 从 RAP-DB 获取 RiceXPro 表达图片 URL
  loggedHandle(IPC_CHANNELS.SPECIES_FETCH_RAPDB_EXPRESSION_IMAGES, async (_event, accession: string) => {
    try {
      const data = await speciesPluginService.fetchRAPDBExpressionImages(accession)
      return { success: true, data }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 保存 RAP-DB 序列为 GenBank
  loggedHandle(IPC_CHANNELS.SPECIES_SAVE_RAPDB_GENBANK, async (event, accession: string, data: any) => {
    const win = BrowserWindow.fromWebContents(event.sender) || undefined
    const result = await dialog.showSaveDialog(win!, {
      title: `保存 ${accession} GenBank`,
      defaultPath: `${accession}.gb`,
      filters: [{ name: 'GenBank Files', extensions: ['gb'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, message: '已取消' }
    try {
      const filePath = speciesPluginService.saveRAPDBAsGenBank(accession, data, path.dirname(result.filePath))
      if (filePath !== result.filePath) { copyFileSync(filePath, result.filePath); rmSync(filePath) }
      return { success: true, path: result.filePath }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 保存 RAP-DB 转录本序列为 FASTA
  loggedHandle(IPC_CHANNELS.SPECIES_SAVE_RAPDB_FASTA, async (event, transcriptId: string, sequences: any) => {
    const win = BrowserWindow.fromWebContents(event.sender) || undefined
    const result = await dialog.showSaveDialog(win!, {
      title: `保存 ${transcriptId} FASTA`,
      defaultPath: `${transcriptId}.fasta`,
      filters: [{ name: 'FASTA Files', extensions: ['fasta', 'fa'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, message: '已取消' }
    try {
      const filePath = speciesPluginService.saveRAPDBAsFasta(transcriptId, sequences, path.dirname(result.filePath))
      if (filePath !== result.filePath) { copyFileSync(filePath, result.filePath); rmSync(filePath) }
      return { success: true, path: result.filePath }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 缓存 RAP-DB 数据到本地数据库
  loggedHandle(IPC_CHANNELS.SPECIES_CACHE_RAPDB_INFO, async (_event, annotationId: number, data: any) => {
    try {
      const result = speciesPluginService.cacheRAPDBInfo(annotationId, data)
      return { success: result.success }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  loggedHandle(IPC_CHANNELS.SPECIES_CACHE_RAPDB_EXPRESSION, async (_event, annotationId: number, rxpId: string, data: any) => {
    try {
      const result = speciesPluginService.cacheRAPDBExpressionData(annotationId, rxpId, data)
      return { success: result.success }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  loggedHandle(IPC_CHANNELS.SPECIES_FETCH_ALL_RAPDB_EXPRESSION, async (event, accession: string, annotationId: number) => {
    try {
      const win = event.sender.getOwnerBrowserWindow()
      const result = await speciesPluginService.fetchAllRAPDBExpressionData(accession, annotationId, (done, total, rxpId) => {
        win?.webContents.send(IPC_CHANNELS.SPECIES_PLUGIN_PROGRESS, { message: `正在获取表达数据 ${done}/${total} (${rxpId})...`, percent: Math.round((done / total) * 100) })
      })
      return { success: true, ...result }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 水稻基因搜索：按存取号/Ricedata ID 搜索注释
  loggedHandle(IPC_CHANNELS.SPECIES_SEARCH_ANNOTATIONS, (_event, keyword: string) => {
    try {
      const results = speciesRepo.searchAnnotationsByAccession(keyword)
      return { success: true, data: results }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 重新生成基因详情页 HTML（批量更新后调用）
  loggedHandle(IPC_CHANNELS.GENE_REGENERATE_HTML, async () => {
    try {
      geneFileService.regenerateGenesIndex()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ============ Phase 4: ZIP 导出/导入 ============

  // 导出基因数据包
  loggedHandle(IPC_CHANNELS.GENE_EXPORT_PACKAGE, async (_event, geneId: number) => {
    try {
      const gene = db.getGene(geneId)
      if (!gene) return { success: false, error: '基因不存在' }
      const identifier = geneFileService.getGeneIdentifier(gene)
      const geneDir = geneFileService.findGeneDir(identifier) || geneFileService.findGeneDirByGene(gene)
      if (!geneDir || !existsSync(geneDir)) return { success: false, error: '基因数据目录不存在，请先执行批量更新' }

      const safeName = (gene.gene_name || identifier).replace(/[<>:"/\\|?*]/g, '_')
      const result = await dialog.showSaveDialog({
        title: '导出基因数据包',
        defaultPath: `${safeName}_export.zip`,
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, error: '用户取消' }

      const dirName = path.basename(geneDir)
      const zipBuffer = zipDirectory(geneDir, dirName)
      writeFileSync(result.filePath, zipBuffer)
      console.log(`[GeneExport] Exported ${dirName} → ${result.filePath} (${(zipBuffer.length / 1024).toFixed(0)} KB)`)
      return { success: true, filePath: result.filePath, size: zipBuffer.length }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 导入基因数据包
  loggedHandle(IPC_CHANNELS.GENE_IMPORT_PACKAGE, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '导入基因数据包',
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, error: '用户取消' }

      const zipPath = result.filePaths[0]
      const zipBuffer = readFileSync(zipPath)

      // 解压到临时目录
      const tmpDir = path.join(getDataDir(), 'tmp-import-' + Date.now())
      unzipToDirectory(zipBuffer, tmpDir)

      // 找到解压后的基因目录（ZIP 内顶层目录）
      const topDirs = readdirSync(tmpDir).filter(d => statSync(path.join(tmpDir, d)).isDirectory())
      if (topDirs.length === 0) return { success: false, error: 'ZIP 中未找到基因目录' }
      const geneDirSrc = path.join(tmpDir, topDirs[0])

      // 读取 gene.json
      const geneJsonPath = path.join(geneDirSrc, 'gene.json')
      if (!existsSync(geneJsonPath)) return { success: false, error: 'ZIP 中缺少 gene.json' }
      const geneMeta = JSON.parse(readFileSync(geneJsonPath, 'utf-8'))

      // 创建/更新基因记录（填空式更新）
      let geneId: number
      const existingGene = geneMeta.ncbi_gene_id
        ? geneRepo.findGeneByNcbiId(geneMeta.ncbi_gene_id)
        : undefined
      if (existingGene) {
        geneId = existingGene.id
        // 填空式更新：只补充空字段
        const updates: any = {}
        if (!existingGene.gene_name && geneMeta.gene_name) updates.gene_name = geneMeta.gene_name
        if (!existingGene.species && geneMeta.species) updates.species = geneMeta.species
        if (!existingGene.description && geneMeta.description) updates.description = geneMeta.description
        if (Object.keys(updates).length > 0) db.updateGene(geneId, updates)
      } else {
        geneId = db.createGene({
          gene_name: geneMeta.gene_name || '导入基因',
          type: 'genomic',
          species: geneMeta.species || 'Oryza sativa',
          sequence: '',
          accession_number: geneMeta.accession_number || '',
          description: geneMeta.description || '',
          topology: 'linear',
          file_path: '',
          ncbi_gene_id: geneMeta.ncbi_gene_id || ''
        })
      }

      // 复制目录到 gene-data/genes/
      const identifier = geneFileService.getGeneIdentifier({ id: geneId, ncbi_gene_id: geneMeta.ncbi_gene_id || '' })
      const targetDir = geneFileService.getGeneDir(identifier, geneMeta.gene_name || identifier)
      copyDirRecursive(geneDirSrc, targetDir)

      // 解析 sequences/ 目录写入 gene_related_sequences
      const seqDir = path.join(targetDir, 'sequences')
      if (existsSync(seqDir)) {
        const seqFiles = collectAllFiles(seqDir)
        for (const sf of seqFiles) {
          if (!sf.endsWith('.fasta') && !sf.endsWith('.gb')) continue
          const content = readFileSync(sf, 'utf-8')
          const fileName = path.basename(sf)
          const molType = fileName.includes('protein') ? 'protein' : fileName.includes('CDS') || fileName.includes('mRNA') ? 'mRNA' : 'genomic'
          const accMatch = fileName.match(/^[a-z]+_(.+?)_(genomic|mRNA|CDS|protein)\./)
          const accession = accMatch ? accMatch[1] : fileName.replace(/\.[^.]+$/, '')
          const existing = geneRepo.findGeneRelatedSequenceByAccession(geneId, accession)
          if (!existing) {
            geneRepo.createGeneRelatedSequence({
              gene_id: geneId, seq_type: molType,
              nucleotide_accession: molType !== 'protein' ? accession : '',
              protein_accession: molType === 'protein' ? accession : null,
              genomic_range: null, description: `导入 ${fileName}`,
              ncbi_content: content, ncbi_imported_at: new Date().toISOString()
            })
          }
        }
      }

      // 解析 annotations/ 目录写入 species_gene_annotations
      const annDir = path.join(targetDir, 'annotations')
      if (existsSync(annDir)) {
        const sourceMap: Record<string, string> = { ncbi: 'NCBI', rapdb: 'RAP-DB', msu: 'MSU', ricedata: 'RiceData' }
        // 查找当前启用的物种插件 ID（避免硬编码 plugin_id=1）
        const enabledPlugins = speciesRepo.getEnabledPlugins()
        const pluginId = enabledPlugins.length > 0 ? enabledPlugins[0].id : 1

        for (const srcDir of readdirSync(annDir)) {
          const srcPath = path.join(annDir, srcDir)
          if (!statSync(srcPath).isDirectory()) continue
          const dbName = sourceMap[srcDir] || srcDir
          const jsonFiles = readdirSync(srcPath).filter(f => f.endsWith('.json') && !f.startsWith('_'))
          const annotationData: Record<string, any> = {}
          for (const jf of jsonFiles) {
            try {
              const data = JSON.parse(readFileSync(path.join(srcPath, jf), 'utf-8'))
              delete data._meta
              Object.assign(annotationData, data)
            } catch {}
          }
          if (Object.keys(annotationData).length > 0) {
            // 查找已有注释或创建新注释
            const existingAnns = speciesRepo.getAnnotationsByGene(geneId)
            const existingAnn = existingAnns.find((a: any) => a.source_database === dbName)
            if (existingAnn) {
              // 填空式合并（保留对象/数组类型，不转为字符串）
              let current: Record<string, any> = {}
              try { current = JSON.parse(existingAnn.annotation_data || '{}') } catch {}
              for (const [k, v] of Object.entries(annotationData)) {
                if (current[k] === undefined || current[k] === null || current[k] === '') {
                  current[k] = v // 直接保留原始类型（数组/对象/字符串）
                }
              }
              speciesRepo.updateAnnotationData(existingAnn.id, JSON.stringify(current))
            } else {
              // 确定 source_accession：优先用该数据源特有的 accession
              let acc = ''
              if (dbName === 'RAP-DB' && annotationData.rapdb_accession) acc = annotationData.rapdb_accession
              else if (dbName === 'MSU' && annotationData.msu_accession) acc = annotationData.msu_accession
              else if (dbName === 'RiceData' && annotationData.ricedata_id) acc = annotationData.ricedata_id
              if (!acc) acc = geneMeta.ncbi_gene_id || geneMeta.accession_number || geneMeta.gene_name || `imported_${geneId}`

              speciesRepo.batchImportAnnotations(pluginId, [{
                source_database: dbName, source_accession: acc,
                ncbi_gene_id: geneMeta.ncbi_gene_id || '',
                gene_symbol: annotationData.gene_symbol || '', gene_name: geneMeta.gene_name || '',
                annotation_data: JSON.stringify(annotationData),
                external_links: '{}'
              }])
              // 关联到基因：查找刚创建的未关联注释
              const unlinked = speciesRepo.searchAnnotationsByAccession(acc)
              for (const ua of unlinked) {
                if (!ua.gene_id) speciesRepo.linkAnnotationToGene(ua.id, geneId)
              }
            }
          }
        }
      }

      // 刷新索引和 HTML
      geneFileService.regenerateGenesIndex()

      // 清理临时目录
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}

      console.log(`[GeneImport] Imported gene_id=${geneId} from ${path.basename(zipPath)}`)
      return { success: true, geneId, geneName: geneMeta.gene_name }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 从注释创建基因条目并关联
  loggedHandle(IPC_CHANNELS.SPECIES_CREATE_GENE_FROM_ANNOTATION, async (_event, annotationIds: number[], geneName: string) => {
    try {
      // 创建基因条目
      const geneId = db.createGene({
        gene_name: geneName || '未命名水稻基因',
        type: 'genomic',
        species: 'Oryza sativa',
        sequence: '',
        accession_number: '',
        description: '',
        topology: 'linear',
        file_path: '',
        ncbi_gene_id: ''
      })
      // 关联注释
      for (const annId of annotationIds) {
        speciesRepo.linkAnnotationToGene(annId, geneId)
      }
      // 从注释中提取 ncbi_gene_id 并更新基因记录
      let ncbiGeneId = ''
      for (const annId of annotationIds) {
        const ann = speciesRepo.getAnnotationById(annId)
        if (ann?.ncbi_gene_id && ann.ncbi_gene_id !== '该基因无NCBI可信ID') {
          ncbiGeneId = ann.ncbi_gene_id
          break
        }
      }
      if (ncbiGeneId) {
        db.updateGene(geneId, { ncbi_gene_id: ncbiGeneId })
      }
      // 初始化基因数据目录（无论是否有 NCBI ID）
      try {
        const identifier = ncbiGeneId || `gene${geneId}`
        geneFileService.initGeneDirectory(identifier, geneName || identifier, {
          id: geneId, gene_name: geneName || '', species: 'Oryza sativa',
          ncbi_gene_id: ncbiGeneId, accession_number: '', description: ''
        })
        // 全量同步 CSV 导入的注释数据到文件
        const annRecords = annotationIds.map(id => speciesRepo.getAnnotationById(id)).filter(Boolean)
        geneFileService.syncAllAnnotationsToFiles(identifier, geneName || identifier, annRecords as any)
      } catch (fileErr: any) {
        console.warn(`[RiceImport] File init failed: ${fileErr.message}`)
      }
      if (ncbiGeneId) {
        // 自动触发 NCBI 导入（补充序列、转录本、外显子、交叉引用）
        try {
          console.log(`[RiceImport] Auto-triggering NCBI import for gene_id=${geneId}, ncbi=${ncbiGeneId}`)
          const ncbiResult = await importGeneFromNCBI(ncbiGeneId)
          if (ncbiResult.success) {
            console.log(`[RiceImport] NCBI import success: ${ncbiResult.gene_name || ncbiGeneId}`)
          } else {
            console.warn(`[RiceImport] NCBI import failed: ${ncbiResult.error}`)
          }
        } catch (ncbiErr: any) {
          console.warn(`[RiceImport] NCBI import error: ${ncbiErr.message}`)
        }
      }

      // 自动触发 RAP-DB / MSU / RiceData 在线获取（首次导入完整性）
      for (const annId of annotationIds) {
        const ann = speciesRepo.getAnnotationById(annId)
        if (!ann) continue
        try {
          if (ann.source_database === 'RAP-DB') {
            const res = await speciesPluginService.fetchRAPDBLocusInfo(ann.source_accession)
            if (res.success && res.data) {
              speciesPluginService.cacheRAPDBInfo(annId, res.data)
              console.log(`[RiceImport] RAP-DB ${ann.source_accession} auto-fetched`)
            }
          } else if (ann.source_database === 'MSU') {
            const res = await speciesPluginService.fetchMSUGeneInfo(ann.source_accession)
            if (res.success && res.data) {
              speciesPluginService.cacheMSUInfo(annId, res.data)
              console.log(`[RiceImport] MSU ${ann.source_accession} auto-fetched`)
            }
          }
        } catch (srcErr: any) {
          console.warn(`[RiceImport] ${ann.source_database} ${ann.source_accession} auto-fetch error: ${srcErr.message}`)
        }
      }
      // RiceData 自动获取
      try {
        let ricedataId = ''
        for (const annId of annotationIds) {
          const ann = speciesRepo.getAnnotationById(annId)
          if (ann) {
            try {
              const data = JSON.parse(ann.annotation_data || '{}')
              if (data.ricedata_id) { ricedataId = data.ricedata_id; break }
            } catch {}
          }
        }
        if (ricedataId) {
          const rdRes = await speciesPluginService.fetchRiceDataGeneInfo(ricedataId)
          if (rdRes.success && rdRes.data) {
            speciesPluginService.updateRiceDataAnnotation(annotationIds, rdRes.data)
            console.log(`[RiceImport] RiceData (ID:${ricedataId}) auto-fetched`)
          }
        }
      } catch (rdErr: any) {
        console.warn(`[RiceImport] RiceData auto-fetch error: ${rdErr.message}`)
      }
      return { success: true, geneId }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 蛋白质 FASTA 独立导入（打开文件对话框 → 解析 FASTA → 返回序列）
  safeHandle(IPC_CHANNELS.PROTEIN_IMPORT_FASTA, async (event) => {
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入蛋白质序列',
      filters: [
        { name: 'FASTA', extensions: ['fasta', 'fa', 'faa'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const content = readFileSync(result.filePaths[0], 'utf-8')
    // 解析 FASTA
    const lines = content.split('\n')
    let name = ''
    let sequence = ''
    for (const line of lines) {
      if (line.startsWith('>')) {
        if (sequence) break // 只取第一条序列
        name = line.substring(1).trim().split(/\s/)[0] || 'protein'
      } else {
        sequence += line.trim()
      }
    }
    if (!sequence) return null
    // 直接打开蛋白质编辑器窗口
    const { createProteinEditorWindow } = require('./index')
    createProteinEditorWindow(name || 'protein', sequence)
    return { success: true }
  })

  // 蛋白质编辑器数据获取
  loggedHandle(IPC_CHANNELS.PROTEIN_EDITOR_GET_DATA, (_event, proteinKey: string) => {
    const { getProteinStoreData } = require('./index')
    const data = getProteinStoreData(proteinKey)
    if (!data) return null
    return {
      gene: { name: data.name, sequence: data.sequence, gene_name: data.name, type: 'protein' },
      features: [],
      topology: 'linear',
      isProtein: true
    }
  })

  // ============ 实验室载体文件导入 ============
  safeHandle(IPC_CHANNELS.LAB_VECTOR_IMPORT_FILE, async () => {
    log.info('lab-vector:import-file — dialog opening')
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Vector/Sequence Files', extensions: ['gb', 'gbk', 'genbank', 'fasta', 'fa', 'fna', 'dna'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, count: 0 }

    const dataDir = path.join(db.getDataDir(), 'data', 'vectors')
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

    let count = 0
    for (const filePath of result.filePaths) {
      try {
        const ext = path.extname(filePath).toLowerCase()
        const fileName = path.basename(filePath)
        const nameWithoutExt = fileName.replace(/\.[^.]+$/, '')
        const destPath = path.join(dataDir, fileName)
        copyFileSync(filePath, destPath)

        let sequence = ''
        let features: GenBankFeature[] = []
        let topology: 'circular' | 'linear' = 'circular'
        let description = ''
        let accession = ''

        if (ext === '.dna') {
          const buffer = readFileSync(filePath)
          const record = parseDnaFormat(buffer)
          sequence = record.sequence
          features = record.features || []
          topology = record.topology || 'circular'
          description = record.description || ''
        } else if (['.gb', '.gbk', '.genbank'].includes(ext)) {
          const content = readFileSync(filePath, 'utf-8')
          const record = parseGenBank(content)
          sequence = record.sequence || ''
          features = record.features || []
          topology = record.topology || 'circular'
          description = record.description || ''
          accession = record.accession || ''
        } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
          const content = readFileSync(filePath, 'utf-8')
          const records = parseFasta(content)
          if (records.length > 0) {
            sequence = records[0].sequence
            description = records[0].description || ''
          }
          topology = 'linear'
        }

        // 创建 vector 记录
        const vectorId = db.createVector({
          name: nameWithoutExt,
          type: 'other',
          size_bp: sequence.length,
          description,
          sequence,
          backbone_id: null,
          purpose: 'other',
          host_type: '[]',
          promoter_type: 'none',
          promoters: '',
          reporter_gene: '',
          is_recombinant: false,
          antibiotic_resistance: '',
          copy_number: '',
          file_path: destPath,
          topology,
          source_file: fileName
        })

        // 同时创建 lab_vector 记录
        db.createLabVector({
          vector_id: vectorId,
          name: nameWithoutExt,
          insert_gene_id: null,
          empty_vector_id: null,
          notes: `从文件导入: ${fileName}`
        })

        count++
      } catch (e) {
        console.error(`[LabVectorImport] Failed to import ${filePath}:`, e)
      }
    }
    console.log(`[IPC] lab-vector:import complete: ${count} vectors imported`)
    return { success: true, count }
  })

  // ============ 载体元件数据库 ============
  loggedHandle(IPC_CHANNELS.COMPONENT_LIST, () => {
    return db.getComponents()
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_GET, (_event, id: number) => {
    return db.getComponent(id)
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_SEARCH, (_event, query: string) => {
    return db.searchComponents(query)
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_CREATE, (_event, data: any) => {
    return db.createComponent(data)
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_UPDATE, (_event, id: number, data: any) => {
    db.updateComponent(id, data)
    return true
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_DELETE, (_event, id: number) => {
    db.deleteComponent(id)
    return true
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_SCAN_VECTOR, (_event, vectorSeq: string, features: any[]) => {
    return db.scanVectorForComponents(vectorSeq, features || [])
  })

  // 全序列扫描智能标注：不依赖 features，直接用载体全序列扫描元件数据库
  loggedHandle(IPC_CHANNELS.COMPONENT_SMART_ANNOTATE, (_event, vectorSequence: string) => {
    return db.smartAnnotateComponents(vectorSequence || '')
  })

  // Worker 化智能标注：主进程查询元件库快照返回给渲染进程 Worker
  loggedHandle(IPC_CHANNELS.COMPONENT_GET_SNAPSHOT, () => {
    const components = db.queryAll(
      'SELECT id, standard_name, sequence, amino_acid_sequence, type, tags FROM vector_components WHERE (sequence IS NOT NULL AND sequence != \'\') OR (amino_acid_sequence IS NOT NULL AND amino_acid_sequence != \'\')'
    )
    const allComponents = db.queryAll(
      'SELECT id, standard_name, type, tags, aliases FROM vector_components'
    )
    return { components, allComponents }
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_BATCH_IMPORT_FEATURES, (_event, features: any[], vectorSeq: string, sourceVectorName?: string) => {
    return db.batchImportComponentsFromFeatures(features || [], vectorSeq || '', sourceVectorName)
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_BATCH_IMPORT_PREVIEW, (_event, features: any[], vectorSeq: string, sourceVectorName?: string) => {
    return db.previewBatchImport(features || [], vectorSeq || '', sourceVectorName)
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_BATCH_IMPORT_EXECUTE, (_event, features: any[], vectorSeq: string, sourceVectorName: string | undefined, decisions: any[]) => {
    return db.executeBatchImport(features || [], vectorSeq || '', sourceVectorName, decisions || [])
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_SPECIES_LIST, () => {
    return db.getComponentSpeciesList()
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_BACKFILL_SPECIES, () => {
    return db.backfillComponentSpecies()
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_SYNC_NORMALIZATION, (_event, matches: any[], vectorSeq: string, features: any[], sourceOrganism?: string) => {
    return db.syncNormalizationToDb(matches || [], vectorSeq || '', features || [], sourceOrganism)
  })
  loggedHandle(IPC_CHANNELS.COMPONENT_IDENTIFY_FEATURE, (_event, featureSeq: string) => {
    return db.identifyFeatureSequence(featureSeq)
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_DEDUPLICATE, () => {
    return db.deduplicateComponents()
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_PURGE_SEED_DATA, () => {
    return db.purgeOldSeedComponents()
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_GET_VARIANTS, (_event, id: number) => {
    return db.getComponentVariants(id)
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_BATCH_DELETE, (_event, ids: number[]) => {
    return db.deleteComponents(ids || [])
  })

  loggedHandle(IPC_CHANNELS.COMPONENT_MERGE_VARIANTS, (_event, ids: number[]) => {
    return db.mergeComponentsBySimilarity(ids || [])
  })

  safeHandle(IPC_CHANNELS.COMPONENT_IMPORT_FILE, async (event) => {
    log.info('component:import-file — dialog opening')
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '批量导入元件文件',
      filters: [
        { name: 'GenBank/FASTA 文件', extensions: ['gb', 'gbk', 'genbank', 'fasta', 'fa', 'fna'] },
        { name: 'GenBank', extensions: ['gb', 'gbk', 'genbank'] },
        { name: 'FASTA', extensions: ['fasta', 'fa', 'fna'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, imported: 0, skipped: 0, linked: 0, speciesFilled: 0, failed: 0 }
    }

    const stats = db.importComponentsFromFiles(result.filePaths)
    return { success: true, ...stats }
  })

  // 导出元件数据库为 JSON
  loggedHandle(IPC_CHANNELS.COMPONENT_EXPORT_JSON, async (event) => {
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: '导出元件数据库',
      defaultPath: `helixcraft-components-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, message: '已取消' }
    try {
      const data = db.exportComponentsToJson()
      writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8')
      return { success: true, message: `已导出 ${data.count} 条元件到 ${result.filePath}` }
    } catch (e: any) {
      return { success: false, message: `导出失败: ${e.message}` }
    }
  })

  // 从 JSON 文件导入元件数据库
  safeHandle(IPC_CHANNELS.COMPONENT_IMPORT_JSON, async (event) => {
    log.info('component:import-json — dialog opening')
    const win = event.sender.getOwnerBrowserWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '导入元件数据库 (JSON)',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, imported: 0, skipped: 0, failed: 0 }
    }
    try {
      const content = readFileSync(result.filePaths[0], 'utf-8')
      const data = JSON.parse(content)
      if (!data.components || !Array.isArray(data.components)) {
        return { success: false, message: '无效的元件数据库文件格式' }
      }
      const stats = db.importComponentsFromJson(data)
      return { success: true, ...stats }
    } catch (e: any) {
      return { success: false, message: `导入失败: ${e.message}` }
    }
  })

  // 自动标注元件标签
  loggedHandle(IPC_CHANNELS.COMPONENT_AUTO_ANNOTATE, () => {
    const count = db.autoAnnotateAllComponents()
    return { count }
  })

  // ============ 数据库备份/恢复 ============
  loggedHandle(IPC_CHANNELS.DB_BACKUP, async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '备份数据库',
      defaultPath: `gene-engineering-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }]
    })
    if (canceled || !filePath) return { success: false, message: '已取消' }
    try {
      const data = db.exportDatabase()
      writeFileSync(filePath, data)
      return { success: true, message: `备份成功: ${filePath}` }
    } catch (e: any) {
      return { success: false, message: `备份失败: ${e.message}` }
    }
  })

  loggedHandle(IPC_CHANNELS.DB_RESTORE, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '恢复数据库',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { success: false, message: '已取消' }
    try {
      const buffer = readFileSync(filePaths[0])
      const result = await db.restoreDatabase(buffer)
      return result
    } catch (e: any) {
      return { success: false, message: `恢复失败: ${e.message}` }
    }
  })

  loggedHandle(IPC_CHANNELS.DB_AUTO_BACKUP, async () => {
    const backupPath = db.createAutoBackup()
    return { success: !!backupPath, path: backupPath }
  })

  // ============ 调试与诊断 ============

  // 渲染进程日志转发
  ipcMain.on(IPC_CHANNELS.LOG_FROM_RENDERER, (_event, level: LogLevel, module: string, message: string, detail?: string) => {
    logFromRenderer(level, module, message, detail)
  })

  // 获取日志
  loggedHandle(IPC_CHANNELS.DEBUG_GET_LOGS, () => {
    return getRecentLogs()
  })

  // 导出日志
  loggedHandle(IPC_CHANNELS.DEBUG_EXPORT_LOGS, async () => {
    const logDir = getLogDir()
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出日志',
      defaultPath: `app-log-${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      const logs = getRecentLogs()
      const content = logs.map(l => `[${new Date(l.timestamp).toISOString()}] [${l.module}] [${l.level}] ${l.message}${l.detail ? '\n  ' + l.detail : ''}`).join('\n')
      writeFileSync(filePath, content, 'utf-8')
      return { success: true, path: filePath }
    } catch (e: any) {
      return { success: false, message: e.message }
    }
  })

  // 打开日志目录
  loggedHandle(IPC_CHANNELS.DEBUG_OPEN_LOG_FOLDER, () => {
    const logDir = getLogDir()
    shell.openPath(logDir)
    return { success: true, path: logDir }
  })

  // 获取系统状态
  loggedHandle(IPC_CHANNELS.DEBUG_GET_SYSTEM_STATUS, () => {
    return {
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      logDir: getLogDir(),
      recentLogCount: getRecentLogs().length,
    }
  })

  // 在系统默认浏览器中打开外部链接
  safeHandle(IPC_CHANNELS.OPEN_EXTERNAL, (_event, url: string) => {
    // 安全检查：仅允许 http/https 协议
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      log.warn(`Blocked openExternal: invalid protocol in URL: ${url?.slice(0, 80)}`)
      return { success: false, message: 'Only http/https URLs are allowed' }
    }
    shell.openExternal(url)
    return { success: true }
  })
}

// ============ 基因导出工具函数 ============

/** 生成基因的 GFF3 格式文件 */
function generateGFF3(gene: GeneSequence): string {
  const lines: string[] = [
    '##gff-version 3',
    `##sequence-region ${gene.gene_name || 'unknown'} 1 ${gene.sequence.length}`
  ]

  const seqId = gene.chromosome || gene.gene_name || 'unknown'
  const strand = gene.strand === -1 ? '-' : '+'

  // 基因整体
  lines.push([
    seqId, 'HelixCraft', 'gene',
    String(gene.genomic_start || 1),
    String(gene.genomic_end || gene.sequence.length),
    '.', strand, '.',
    `ID=${gene.gene_name};Name=${gene.gene_name};biotype=${gene.biotype || 'unknown'}`
  ].join('\t'))

  // 解析 features
  if (gene.features_json) {
    try {
      const features: GenBankFeature[] = JSON.parse(gene.features_json)
      for (const feat of features) {
        if (['gene', 'source', 'organism'].includes(feat.type)) continue
        lines.push([
          seqId, 'HelixCraft', feat.type,
          String(feat.start),
          String(feat.end),
          '.', feat.strand === -1 ? '-' : '+', '.',
          `ID=${feat.type}_${feat.start};Parent=${gene.gene_name}` +
            (feat.qualifiers?.gene ? `;Name=${feat.qualifiers.gene}` : '') +
            (feat.qualifiers?.product ? `;product=${feat.qualifiers.product}` : '')
        ].join('\t'))
      }
    } catch { /* ignore */ }
  }

  return lines.join('\n') + '\n'
}

/** 生成基因的 GenBank 格式文件 */
function generateGeneGenBank(gene: GeneSequence, features: GenBankFeature[]): string {
  const lines: string[] = []
  const seqLen = gene.sequence.length
  const name = (gene.gene_name || 'unknown').substring(0, 16)
  const type = gene.type === 'mrna' ? 'mRNA' : gene.type === 'protein' ? 'AA' : 'DNA'

  lines.push(`LOCUS       ${name.padEnd(16)} ${String(seqLen).padStart(11)} bp    ${type.padEnd(6)}  linear   ${new Date().toISOString().slice(0, 11).replace(/-/g, '')}`)
  lines.push(`DEFINITION  ${gene.description || gene.gene_name}`)
  lines.push(`ACCESSION   ${gene.accession_number || 'unknown'}`)
  lines.push(`VERSION     ${gene.accession_number || 'unknown'}`)
  lines.push(`KEYWORDS    .`)
  lines.push(`SOURCE      ${gene.species || 'unknown'}`)
  lines.push(`  ORGANISM  ${gene.species || 'unknown'}`)
  lines.push(`COMMENT     Imported via HelixCraft Gene Browser.`)
  if (gene.ncbi_gene_id) lines.push(`            NCBI Gene ID: ${gene.ncbi_gene_id}`)

  // FEATURES
  lines.push('FEATURES             Location/Qualifiers')
  if (features.length > 0) {
    for (const feat of features) {
      const loc = feat.strand === -1
        ? `complement(${feat.start}..${feat.end})`
        : `${feat.start}..${feat.end}`
      lines.push(`     ${feat.type.padEnd(15)} ${loc}`)
      for (const [key, val] of Object.entries(feat.qualifiers || {})) {
        lines.push(`                     /${key}="${val}"`)
      }
    }
  }

  // ORIGIN + 序列
  lines.push('ORIGIN')
  const seq = gene.sequence.toLowerCase()
  for (let i = 0; i < seq.length; i += 60) {
    const lineNum = String(i + 1).padStart(9)
    const chunks: string[] = []
    for (let j = 0; j < 60 && i + j < seq.length; j += 10) {
      chunks.push(seq.substring(i + j, Math.min(i + j + 10, seq.length)))
    }
    lines.push(`${lineNum} ${chunks.join(' ')}`)
  }
  lines.push('//')

  return lines.join('\n') + '\n'
}
