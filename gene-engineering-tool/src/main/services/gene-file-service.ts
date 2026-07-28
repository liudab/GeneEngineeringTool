/**
 * @module services/gene-file-service
 * @description
 * 基因数据文件持久化服务 — Phase 1
 * 在 SQLite 主存储之外，提供附加的文件系统持久化层（双写策略）。
 *
 * 目录结构：
 *   APPDATA/HelixCraft/gene-data/genes/{ncbi_gene_id}_{gene_symbol}/
 *     ├── gene.json
 *     ├── annotations/  (Phase 2)
 *     └── sequences/
 *         ├── manifest.json
 *         ├── genomic/
 *         ├── transcripts/
 *         └── proteins/
 */

import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import { getDataDir } from '../db/base'
import { generateGenePageHtml } from './gene-html-generator'

// ============ 目录管理 ============

/** 获取 gene-data 根目录 */
export function getGeneDataRoot(): string {
  return path.join(getDataDir(), 'gene-data')
}

/** 获取基因数据目录路径（支持无 NCBI ID 的基因） */
export function getGeneDir(identifier: string, geneSymbol: string): string {
  const safeName = sanitizeDirName(`${identifier}_${geneSymbol}`)
  return path.join(getGeneDataRoot(), 'genes', safeName)
}

/** 获取基因的最佳标识符（NCBI ID 优先，否则用数据库 ID） */
export function getGeneIdentifier(gene: { id: number; ncbi_gene_id?: string }): string {
  const ncbiId = gene.ncbi_gene_id?.trim() || ''
  // 拒绝空值和已知占位符文本（CSV 导入的“无NCBI ID”标记）
  if (ncbiId && !ncbiId.includes('无') && !ncbiId.includes('该基因') && !ncbiId.includes('N/A')) {
    return ncbiId
  }
  return `gene${gene.id}`
}

/** 清理目录名中的非法字符 */
function sanitizeDirName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').substring(0, 100)
}

/** 确保目录存在（递归创建） */
function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

// ============ 基因目录生命周期 ============

/**
 * 创建基因数据目录结构
 * 在 createGene、importGeneFromNCBI、水稻插件导入 完成后调用
 */
export function initGeneDirectory(identifier: string, geneSymbol: string, geneMeta: {
  id: number
  gene_name: string
  species: string
  ncbi_gene_id: string
  accession_number?: string
  description?: string
}): string {
  const geneDir = getGeneDir(identifier, geneSymbol)

  // 创建子目录
  ensureDir(geneDir)
  ensureDir(path.join(geneDir, 'sequences'))
  ensureDir(path.join(geneDir, 'sequences', 'genomic'))
  ensureDir(path.join(geneDir, 'sequences', 'transcripts'))
  ensureDir(path.join(geneDir, 'sequences', 'proteins'))
  ensureDir(path.join(geneDir, 'annotations'))

  // 写入 gene.json
  const geneJson = {
    _meta: { version: '1.0', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    id: geneMeta.id,
    gene_name: geneMeta.gene_name,
    species: geneMeta.species,
    ncbi_gene_id: geneMeta.ncbi_gene_id,
    accession_number: geneMeta.accession_number || '',
    description: geneMeta.description || ''
  }
  writeJsonFile(path.join(geneDir, 'gene.json'), geneJson)

  console.log(`[GeneFile] Initialized gene directory: ${geneDir}`)
  // 生成基因详情页 HTML
  generateGenePageHtml(geneDir)
  return geneDir
}

/**
 * 删除基因数据目录
 * 在 deleteGene 时调用
 */
export function removeGeneDirectory(identifier: string, geneSymbol: string): void {
  const geneDir = getGeneDir(identifier, geneSymbol)
  if (existsSync(geneDir)) {
    rmSync(geneDir, { recursive: true, force: true })
    console.log(`[GeneFile] Removed gene directory: ${geneDir}`)
  }
}

/**
 * 查找已存在的基因目录（通过标识符前缀匹配）
 * 支持 NCBI ID 和 gene{id} 两种命名方式
 */
export function findGeneDir(identifier: string): string | null {
  const genesRoot = path.join(getGeneDataRoot(), 'genes')
  if (!existsSync(genesRoot)) return null
  try {
    const dirs = readdirSync(genesRoot)
    const match = dirs.find(d => d.startsWith(`${identifier}_`))
    return match ? path.join(genesRoot, match) : null
  } catch {
    return null
  }
}

/**
 * 通过基因记录查找目录（自动确定标识符）
 */
export function findGeneDirByGene(gene: { id: number; ncbi_gene_id?: string; gene_name?: string }): string | null {
  // 优先用 NCBI ID 查找
  if (gene.ncbi_gene_id && gene.ncbi_gene_id.trim()) {
    const dir = findGeneDir(gene.ncbi_gene_id)
    if (dir) return dir
  }
  // 回退用 gene{id} 查找
  return findGeneDir(`gene${gene.id}`)
}

// ============ 序列文件写入 ============

/**
 * 确保基因目录下存在 gene.json（防御性补建）
 * 解决 initGeneDirectory 未被调用时 regenerateGenesIndex 跳过该目录的问题
 */
function ensureGeneJson(geneDir: string, identifier: string, geneSymbol: string): void {
  const geneJsonPath = path.join(geneDir, 'gene.json')
  if (existsSync(geneJsonPath)) return
  ensureDir(geneDir)
  // 从标识符提取基因 ID（gene27 → 27）
  const idMatch = identifier.match(/^gene(\d+)$/)
  const geneJson = {
    _meta: { version: '1.0', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    id: idMatch ? parseInt(idMatch[1]) : 0,
    gene_name: geneSymbol,
    species: 'Oryza sativa',
    ncbi_gene_id: identifier.startsWith('gene') ? '' : identifier,
    accession_number: '',
    description: ''
  }
  writeJsonFile(geneJsonPath, geneJson)
  console.log(`[GeneFile] Auto-created gene.json for ${identifier}_${geneSymbol}`)
}

export interface SequenceFileInfo {
  source: string        // 'NCBI' | 'RAP-DB' | 'MSU'
  accession: string     // 原始 accession
  molType: string       // 'genomic' | 'mRNA' | 'CDS' | 'protein'
  format: string        // 'GenBank' | 'FASTA'
  fileName: string      // 文件名
  length: number        // 序列长度
  description: string   // 描述
  fetched_at: string    // 获取时间
}

/**
 * 写入序列文件到基因目录
 * @returns 写入的文件路径，失败返回 null
 */
export function writeSequenceFile(
  identifier: string,
  geneSymbol: string,
  source: string,
  accession: string,
  molType: 'genomic' | 'mRNA' | 'CDS' | 'protein',
  content: string,
  format: 'GenBank' | 'FASTA'
): string | null {
  try {
    const geneDir = findGeneDir(identifier) || getGeneDir(identifier, geneSymbol)
    ensureGeneJson(geneDir, identifier, geneSymbol)
    const seqDir = path.join(geneDir, 'sequences')

    // 确定子目录
    let subDir: string
    if (molType === 'genomic') subDir = 'genomic'
    else if (molType === 'protein') subDir = 'proteins'
    else subDir = 'transcripts' // mRNA, CDS

    const targetDir = path.join(seqDir, subDir)
    ensureDir(targetDir)

    // 生成文件名: {source}_{accession}_{molType}.{ext}
    const sourcePrefix = source.toLowerCase().replace(/[^a-z0-9]/g, '')
    const safeAcc = accession.replace(/[^a-zA-Z0-9._-]/g, '_')
    const ext = format === 'GenBank' ? 'gb' : 'fasta'
    const fileName = `${sourcePrefix}_${safeAcc}_${molType}.${ext}`
    const filePath = path.join(targetDir, fileName)

    // 写入文件（幂等覆盖）
    writeFileSync(filePath, content, 'utf-8')

    // 更新 manifest.json
    const seqLength = calculateSequenceLength(content, format)
    updateManifest(geneDir, {
      source,
      accession,
      molType,
      format,
      fileName: `${subDir}/${fileName}`,
      length: seqLength,
      description: `${source} ${molType} ${accession}`,
      fetched_at: new Date().toISOString()
    })

    console.log(`[GeneFile] Written sequence: ${fileName} (${seqLength} ${molType === 'protein' ? 'aa' : 'bp'})`)
    return filePath
  } catch (err: any) {
    console.warn(`[GeneFile] Failed to write sequence file: ${err.message}`)
    return null
  }
}

/**
 * 批量写入序列文件（NCBI 导入完成后调用）
 */
export function writeGeneSequences(
  identifier: string,
  geneSymbol: string,
  sequences: {
    genomicGenBank?: string       // NCBI 基因组 GenBank 全文
    transcripts?: Array<{
      accession: string
      mrnaGenBank?: string        // mRNA GenBank 全文
      proteinFasta?: string       // 蛋白质 FASTA
    }>
    relatedSequences?: Array<{
      accession: string
      seqType: string
      content: string             // GenBank 或 FASTA 内容
    }>
  }
): void {
  // 1. 基因组 GenBank
  if (sequences.genomicGenBank && sequences.genomicGenBank.length > 50) {
    writeSequenceFile(identifier, geneSymbol, 'NCBI', identifier, 'genomic', sequences.genomicGenBank, 'GenBank')
  }

  // 2. 转录本
  if (sequences.transcripts) {
    for (const tx of sequences.transcripts) {
      if (tx.mrnaGenBank && tx.mrnaGenBank.length > 50) {
        writeSequenceFile(identifier, geneSymbol, 'NCBI', tx.accession, 'mRNA', tx.mrnaGenBank, 'GenBank')
      }
      if (tx.proteinFasta && tx.proteinFasta.length > 10) {
        writeSequenceFile(identifier, geneSymbol, 'NCBI', tx.accession, 'protein', tx.proteinFasta, 'FASTA')
      }
    }
  }

  // 3. 相关序列（跳过超过 200kb 的染色体/支架级序列）
  const MAX_FILE_SEQ_SIZE = 200000
  if (sequences.relatedSequences) {
    for (const rel of sequences.relatedSequences) {
      if (!rel.content || rel.content.length < 50 || rel.content.startsWith('SKIPPED')) continue
      const format = rel.content.startsWith('LOCUS') || rel.content.includes('ORIGIN') ? 'GenBank' : 'FASTA'
      const seqLen = calculateSequenceLength(rel.content, format)
      if (seqLen > MAX_FILE_SEQ_SIZE) {
        console.log(`[GeneFile] Skipping oversized sequence ${rel.accession} (${seqLen} bp > ${MAX_FILE_SEQ_SIZE})`)
        continue
      }
      const molType = rel.seqType === 'protein' ? 'protein' : rel.seqType === 'genomic' ? 'genomic' : 'mRNA'
      writeSequenceFile(identifier, geneSymbol, 'NCBI', rel.accession, molType as any, rel.content, format as any)
    }
  }
}

// ============ manifest.json 管理 ============

function updateManifest(geneDir: string, entry: SequenceFileInfo): void {
  const manifestPath = path.join(geneDir, 'sequences', 'manifest.json')
  let manifest: SequenceFileInfo[] = []

  try {
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf-8'))
    }
  } catch {}

  // 幂等：按 fileName 去重覆盖
  const idx = manifest.findIndex(m => m.fileName === entry.fileName)
  if (idx >= 0) manifest[idx] = entry
  else manifest.push(entry)

  writeJsonFile(manifestPath, manifest)
}

// ============ 工具函数 ============

function writeJsonFile(filePath: string, data: any): void {
  ensureDir(path.dirname(filePath))
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function calculateSequenceLength(content: string, format: string): number {
  if (format === 'GenBank') {
    // 从 ORIGIN 到 // 之间提取纯序列
    const originIdx = content.indexOf('ORIGIN')
    if (originIdx === -1) return 0
    const seqPart = content.substring(originIdx).replace(/ORIGIN/, '').replace(/\/\//, '').replace(/[\d\s]/g, '')
    return seqPart.length
  } else {
    // FASTA：去 header 和空白
    return content.replace(/^>[^\n]*\n?/, '').replace(/\s+/g, '').length
  }
}

// ============ 索引生成 ============

/**
 * 重新生成 genes-index.json（所有基因的概览列表）
 */
export function regenerateGenesIndex(): void {
  try {
    const genesRoot = path.join(getGeneDataRoot(), 'genes')
    if (!existsSync(genesRoot)) return

    const dirs = readdirSync(genesRoot)
    const index: any[] = []

    for (const dir of dirs) {
      const geneJsonPath = path.join(genesRoot, dir, 'gene.json')
      if (existsSync(geneJsonPath)) {
        try {
          const geneData = JSON.parse(require('fs').readFileSync(geneJsonPath, 'utf-8'))
          index.push({ dir_name: dir, ...geneData })
        } catch {}
      }
    }

    writeJsonFile(path.join(getGeneDataRoot(), 'genes-index.json'), index)
    console.log(`[GeneFile] Regenerated genes-index.json (${index.length} genes)`)
    // 自动生成全局 index.html + 每个基因的详情页
    generateIndexHtml(index)
    for (const dir of dirs) {
      generateGenePageHtml(path.join(genesRoot, dir))
    }
  } catch (err: any) {
    console.warn(`[GeneFile] Failed to regenerate index: ${err.message}`)
  }
}

/**
 * 生成纯静态 index.html 本地网页（双击即可查看，无服务器依赖）
 */
function generateIndexHtml(genes: any[]): void {
  try {
    const geneListJson = JSON.stringify(genes.map(g => ({
      dir: g.dir_name,
      name: g.gene_name || g.dir_name,
      species: g.species || '',
      ncbi_id: g.ncbi_gene_id || '',
      id: g.id
    })))

    const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>HelixCraft 基因数据库</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b}
.container{display:flex;height:100vh}
.sidebar{width:320px;border-right:1px solid #e2e8f0;overflow-y:auto;background:#fff}
.main{flex:1;overflow-y:auto;padding:24px}
h1{font-size:16px;padding:16px;border-bottom:1px solid #e2e8f0;background:#f1f5f9}
.gene-item{padding:12px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background .15s}
.gene-item:hover{background:#f1f5f9}
.gene-item.active{background:#eff6ff;border-left:3px solid #3b82f6}
.gene-name{font-weight:600;font-size:13px}
.gene-meta{font-size:11px;color:#64748b;margin-top:2px}
.detail-title{font-size:20px;font-weight:700;margin-bottom:8px}
.detail-meta{font-size:12px;color:#64748b;margin-bottom:16px}
.section{margin-bottom:16px;padding:16px;background:#fff;border:1px solid #e2e8f0;border-radius:8px}
.section h3{font-size:13px;font-weight:600;color:#475569;margin-bottom:8px}
.file-list{list-style:none;font-size:12px}
.file-list li{padding:4px 0;font-family:monospace;color:#3b82f6}
.file-list a{color:#3b82f6;text-decoration:none}
.file-list a:hover{text-decoration:underline}
.empty{color:#94a3b8;font-size:13px;padding:40px;text-align:center}
.badge{display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;margin-right:4px}
.badge-ncbi{background:#dbeafe;color:#1d4ed8}
.badge-rapdb{background:#e0e7ff;color:#4338ca}
.badge-msu{background:#e0f2fe;color:#0369a1}
</style>
</head>
<body>
<div class="container">
<div class="sidebar">
<h1>🧬 HelixCraft 基因数据库 (${genes.length} 个基因)</h1>
<div id="gene-list"></div>
</div>
<div class="main" id="detail">
<div class="empty">← 选择左侧基因查看详情</div>
</div>
</div>
<script>
const genes = ${geneListJson};
const listEl = document.getElementById('gene-list');
const detailEl = document.getElementById('detail');
let activeIdx = -1;

genes.forEach((g, i) => {
  const div = document.createElement('div');
  div.className = 'gene-item';
  div.innerHTML = '<div class="gene-name"><a href="genes/' + g.dir + '/index.html">' + g.name + '</a></div><div class="gene-meta">' + (g.ncbi_id ? 'NCBI: ' + g.ncbi_id + ' | ' : '') + g.species + '</div>';
  div.onclick = () => selectGene(i);
  listEl.appendChild(div);
});

function selectGene(idx) {
  if (activeIdx >= 0) listEl.children[activeIdx].classList.remove('active');
  activeIdx = idx;
  listEl.children[idx].classList.add('active');
  const g = genes[idx];
  detailEl.innerHTML = '<div class="detail-title">' + g.name + '</div>' +
    '<div class="detail-meta">' + (g.ncbi_id ? '<span class="badge badge-ncbi">NCBI: ' + g.ncbi_id + '</span>' : '') + g.species + '</div>' +
    '<div class="section"><h3>📁 数据目录</h3><p style="font-size:12px;font-family:monospace;color:#64748b">genes/' + g.dir + '/</p></div>' +
    '<div class="section"><h3>📄 注释文件</h3><ul class="file-list">' +
    '<li><a href="genes/' + g.dir + '/gene.json">gene.json</a></li>' +
    '<li><a href="genes/' + g.dir + '/annotations/ncbi/summary.json">ncbi/summary.json</a></li>' +
    '<li><a href="genes/' + g.dir + '/annotations/ncbi/transcripts.json">ncbi/transcripts.json</a></li>' +
    '<li><a href="genes/' + g.dir + '/annotations/rapdb/locus_info.json">rapdb/locus_info.json</a></li>' +
    '<li><a href="genes/' + g.dir + '/annotations/rapdb/oryzabase.json">rapdb/oryzabase.json</a></li>' +
    '<li><a href="genes/' + g.dir + '/annotations/msu/gene_info.json">msu/gene_info.json</a></li>' +
    '<li><a href="genes/' + g.dir + '/annotations/ricedata/gene_info.json">ricedata/gene_info.json</a></li>' +
    '</ul></div>' +
    '<div class="section"><h3>🧬 序列文件</h3><ul class="file-list">' +
    '<li><a href="genes/' + g.dir + '/sequences/manifest.json">manifest.json (序列清单)</a></li>' +
    '<li>genomic/ | transcripts/ | proteins/</li>' +
    '</ul></div>';
}
</script>
</body>
</html>`

    writeFileSync(path.join(getGeneDataRoot(), 'index.html'), html, 'utf-8')
  } catch (err: any) {
    console.warn(`[GeneFile] Failed to generate index.html: ${err.message}`)
  }
}

// ============ 注释信息文件写入 (Phase 2) ============

/**
 * 写入注释 JSON 文件到基因目录的 annotations/ 子目录
 * @param identifier 基因标识符
 * @param geneSymbol 基因名称
 * @param source 数据源子目录名 ('ncbi' | 'rapdb' | 'msu' | 'ricedata')
 * @param fileName 文件名 ('summary.json', 'locus_info.json' 等)
 * @param data 注释数据对象
 */
export function writeAnnotationFile(
  identifier: string,
  geneSymbol: string,
  source: 'ncbi' | 'rapdb' | 'msu' | 'ricedata',
  fileName: string,
  data: Record<string, any>
): void {
  try {
    const geneDir = findGeneDir(identifier) || getGeneDir(identifier, geneSymbol)
    ensureGeneJson(geneDir, identifier, geneSymbol)
    const annDir = path.join(geneDir, 'annotations', source)
    ensureDir(annDir)

    // 添加 _meta 头
    const output = {
      _meta: {
        source: source.toUpperCase(),
        category: fileName.replace('.json', ''),
        fetched_at: new Date().toISOString(),
        version: '1.0'
      },
      ...data
    }
    writeJsonFile(path.join(annDir, fileName), output)
  } catch (err: any) {
    console.warn(`[GeneFile] Failed to write annotation ${source}/${fileName}: ${err.message}`)
  }
}

/**
 * 写入 RAP-DB 注释数据（拆分多个文件）
 */
export function writeRapdbAnnotations(identifier: string, geneSymbol: string, rapdbData: Record<string, any>): void {
  // locus_info.json
  const locusInfo: Record<string, any> = {}
  if (rapdbData.locus_title) locusInfo.locus_title = rapdbData.locus_title
  if (rapdbData.seqid) locusInfo.seqid = rapdbData.seqid
  if (rapdbData.start_pos) locusInfo.start_pos = rapdbData.start_pos
  if (rapdbData.end_pos) locusInfo.end_pos = rapdbData.end_pos
  if (rapdbData.strand) locusInfo.strand = rapdbData.strand
  if (rapdbData.transcripts) locusInfo.transcripts = rapdbData.transcripts
  if (Object.keys(locusInfo).length > 0) {
    writeAnnotationFile(identifier, geneSymbol, 'rapdb', 'locus_info.json', locusInfo)
  }

  // oryzabase.json
  if (rapdbData.oryzabase && Object.keys(rapdbData.oryzabase).length > 0) {
    writeAnnotationFile(identifier, geneSymbol, 'rapdb', 'oryzabase.json', rapdbData.oryzabase)
  }

  // transcript_variants.json
  if (rapdbData.transcript_variants && rapdbData.transcript_variants.length > 0) {
    // 序列不写入注释文件（已在 sequences/ 目录），只写元数据
    const variantsMeta = rapdbData.transcript_variants.map((v: any) => ({
      variant_id: v.variant_id,
      mrna_length: v.mrna_length,
      cds_length: v.cds_length,
      protein_length: v.protein_length
    }))
    writeAnnotationFile(identifier, geneSymbol, 'rapdb', 'transcript_variants.json', { variants: variantsMeta })
  }

  // expression/
  if (rapdbData.expression_categories || rapdbData.expression_data) {
    const exprData: Record<string, any> = {}
    if (rapdbData.expression_categories) exprData.categories = rapdbData.expression_categories
    if (rapdbData.expression_data) exprData.data = rapdbData.expression_data
    if (rapdbData.expression_rxp_name) exprData.rxp_name = rapdbData.expression_rxp_name
    writeAnnotationFile(identifier, geneSymbol, 'rapdb', 'expression.json', exprData)
  }
}

/**
 * 写入 MSU 注释数据
 */
export function writeMsuAnnotations(identifier: string, geneSymbol: string, msuData: Record<string, any>): void {
  // gene_info.json
  const geneInfo: Record<string, any> = {}
  if (msuData.gene_product_name) geneInfo.gene_product_name = msuData.gene_product_name
  if (msuData.locus_name) geneInfo.locus_name = msuData.locus_name
  if (msuData.go_terms) geneInfo.go_terms = msuData.go_terms
  if (msuData.coexpression_modules) geneInfo.coexpression_modules = msuData.coexpression_modules
  if (Object.keys(geneInfo).length > 0) {
    writeAnnotationFile(identifier, geneSymbol, 'msu', 'gene_info.json', geneInfo)
  }

  // splice_variants.json
  if (msuData.splice_variants && msuData.splice_variants.length > 0) {
    writeAnnotationFile(identifier, geneSymbol, 'msu', 'splice_variants.json', { variants: msuData.splice_variants })
  }

  // rnaseq_tpm.json
  if (msuData.rnaseq_tpm && msuData.rnaseq_tpm.length > 0) {
    writeAnnotationFile(identifier, geneSymbol, 'msu', 'rnaseq_tpm.json', { samples: msuData.rnaseq_tpm })
  }
}

/**
 * 写入 RiceData 注释数据
 */
export function writeRicedataAnnotations(identifier: string, geneSymbol: string, data: Record<string, any>): void {
  if (!data || Object.keys(data).length === 0) return
  writeAnnotationFile(identifier, geneSymbol, 'ricedata', 'gene_info.json', data)
}

/**
 * 写入 NCBI 注释数据
 */
export function writeNcbiAnnotations(identifier: string, geneSymbol: string, summary: Record<string, any>, crossRefs?: any[]): void {
  if (summary && Object.keys(summary).length > 0) {
    writeAnnotationFile(identifier, geneSymbol, 'ncbi', 'summary.json', summary)
  }
  if (crossRefs && crossRefs.length > 0) {
    writeAnnotationFile(identifier, geneSymbol, 'ncbi', 'cross_refs.json', { cross_references: crossRefs })
  }
}

/**
 * 全量同步基因的所有注释数据到文件（包括 CSV 导入的初始数据）
 * 在基因创建/导入后调用，确保所有 annotation_data 均落盘
 */
export function syncAllAnnotationsToFiles(
  identifier: string,
  geneSymbol: string,
  annotations: Array<{ source_database: string; source_accession: string; annotation_data: string; external_links?: string }>
): void {
  for (const ann of annotations) {
    try {
      const data = JSON.parse(ann.annotation_data || '{}')
      if (Object.keys(data).length === 0) continue

      const source = ann.source_database === 'RAP-DB' ? 'rapdb' : ann.source_database === 'MSU' ? 'msu' : 'ricedata'

      // 写入完整注释数据（排除序列字段和内部时间戳）
      const exportData: Record<string, any> = { source_accession: ann.source_accession }
      for (const [key, value] of Object.entries(data)) {
        // 跳过序列字段（已在 sequences/ 目录）和内部字段
        if (key === 'msu_sequences' || key === 'rapdb_sequence' || key === 'rapdb_transcript_variants') continue
        if (key.startsWith('rapdb_expression_')) continue // 单独写入 expression/ 目录
        if (key === 'rapdb_expression_categories' || key === 'rapdb_expression_images') continue
        exportData[key] = value
      }

      if (Object.keys(exportData).length > 1) {
        writeAnnotationFile(identifier, geneSymbol, source as any, 'annotation_data.json', exportData)
      }

      // 外部链接
      if (ann.external_links) {
        try {
          const links = JSON.parse(ann.external_links)
          if (Object.keys(links).length > 0) {
            writeAnnotationFile(identifier, geneSymbol, source as any, 'external_links.json', links)
          }
        } catch {}
      }

      // RAP-DB 图表型表达数据单独写入
      if (source === 'rapdb') {
        for (const [key, value] of Object.entries(data)) {
          if (key.startsWith('rapdb_expression_') && typeof value === 'string') {
            const rxpId = key.replace('rapdb_expression_', '')
            try {
              const exprData = JSON.parse(value)
              writeAnnotationFile(identifier, geneSymbol, 'rapdb', `expression/${rxpId}.json`, exprData)
            } catch {}
          }
        }
      }
    } catch {}
  }
}

// ============ 图片下载 (Phase 2 补充) ============

/**
 * 下载图片到基因目录的 annotations/rapdb/images/ 子目录
 * 返回本地相对路径映射
 */
export async function downloadExpressionImages(
  identifier: string,
  geneSymbol: string,
  categories: any[]
): Promise<void> {
  try {
    const geneDir = findGeneDir(identifier) || getGeneDir(identifier, geneSymbol)
    const imgDir = path.join(geneDir, 'annotations', 'rapdb', 'images')
    ensureDir(imgDir)

    let downloaded = 0
    for (const cat of categories) {
      const views = cat.views || cat.images || []
      for (const view of views) {
        if (!view.url) continue
        try {
          const fileName = view.url.split('/').pop() || `img_${downloaded}.png`
          const filePath = path.join(imgDir, fileName)
          // 已存在则跳过（幂等）
          if (existsSync(filePath)) { downloaded++; continue }
          await downloadFile(view.url, filePath)
          downloaded++
        } catch {}
      }
    }
    if (downloaded > 0) {
      console.log(`[GeneFile] Downloaded ${downloaded} expression images to ${imgDir}`)
    }
  } catch (err: any) {
    console.warn(`[GeneFile] Image download failed: ${err.message}`)
  }
}

/** 下载单个文件 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, destPath).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        writeFileSync(destPath, Buffer.concat(chunks))
        resolve()
      })
    }).on('error', reject)
  })
}
