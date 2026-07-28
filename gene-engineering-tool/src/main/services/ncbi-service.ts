/**
 * @module services/ncbi-service
 * @description
 * NCBI E-utilities 集成服务 — 从 NCBI 数据库导入基因信息、序列和转录本。
 *
 * 核心功能：
 * - 通过 Gene ID (LOC号) 获取基因元数据（esummary）
 * - 下载基因组序列（含前后各4000bp侧翼序列，GenBank 格式）（efetch）
 * - 获取转录本列表（mRNA + Protein）和序列
 * - 解析 NCBI GenBank 格式并写入本地数据库
 * - 支持重复导入时更新已有记录而非创建重复
 *
 * API 限速：无 API Key = 3 req/s, 有 Key = 10 req/s
 *
 * 依赖：Node.js 原生 https 模块，无外部依赖
 */

import https from 'https'
import http from 'http'
import type {
  GeneSequence, GeneTranscript, GeneExon, GeneCrossRef,
  GenBankFeature, NCBImportProgress
} from '../../shared/types'
import * as geneRepo from '../db/gene-repo'
import * as speciesRepo from '../db/species-repo'
import * as geneFileService from './gene-file-service'
import { parseGenBank } from '../file-parser'

// ============ 限速控制 ============

const RATE_LIMIT_WITHOUT_KEY = 334   // ~3 req/s (1000/3)
const RATE_LIMIT_WITH_KEY = 100      // ~10 req/s (1000/10)

let lastRequestTime = 0

function getDelayMs(apiKey?: string): number {
  return apiKey ? RATE_LIMIT_WITH_KEY : RATE_LIMIT_WITHOUT_KEY
}

async function rateLimit(apiKey?: string): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  const delay = getDelayMs(apiKey)
  if (elapsed < delay) {
    await new Promise(resolve => setTimeout(resolve, delay - elapsed))
  }
  lastRequestTime = Date.now()
}

// ============ HTTP 请求工具 ============

function httpsGet(url: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) { reject(new Error('Too many redirects')); return }
    const client = url.startsWith('https') ? https : http
    const req = client.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, maxRedirects - 1).then(resolve).catch(reject)
        return
      }
      if (res.statusCode && res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url.slice(0, 120)}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timeout: ${url.slice(0, 120)}`)) })
  })
}

function buildApiParam(apiKey?: string): string {
  return apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : ''
}

// ============ NCBI esummary — 基因元数据 ============

export interface NCBIGeneSummary {
  uid: string
  name: string                   // 基因符号
  description: string
  organism: string               // 物种学名
  chromosome: string
  strand: string                 // 'plus' | 'minus'
  genomic_range_start: number
  genomic_range_end: number
  biotype: string                // e.g. 'protein-coding'
  summary: string                // 功能描述
  nomenclature_symbol: string
  gene_id: string
  chr_accession: string          // 染色体 accession (e.g. NC_000001.11)
}

export async function fetchGeneSummary(geneId: string, apiKey?: string): Promise<NCBIGeneSummary> {
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=${encodeURIComponent(geneId)}&retmode=json${buildApiParam(apiKey)}`
  console.log(`[NCBI] fetchGeneSummary: ${url}`)
  const text = await httpsGet(url)
  const json = JSON.parse(text)

  if (json.error) throw new Error(`NCBI esummary error: ${json.error}`)

  const result = json.result
  if (!result || !result[geneId]) throw new Error(`No result found for Gene ID: ${geneId}`)

  const data = result[geneId]
  const genomicInfo = data.genomicinfo?.[0] || {}

  // NCBI esummary 返回的 chrstart/chrstop 是 0-based interbase 坐标
  // 对于反向链基因，chrstart 可能大于 chrstop
  const chrstart0 = genomicInfo.chrstart ?? 0  // 0-based
  const chrstop0 = genomicInfo.chrstop ?? 0    // 0-based
  
  // 判断链方向：优先使用 strand 字段，若为空则用 chrstart > chrstop 推断
  // NCBI 对某些基因的 esummary 不返回 strand 字段（如 LOC4327046），
  // 但 chrstart > chrstop 是反向链的可靠信号
  const strandField = genomicInfo.strand
  let isMinusStrand = strandField === 'minus'
  if (!strandField || strandField === '') {
    // strand 字段缺失，用坐标方向推断
    isMinusStrand = chrstart0 > chrstop0
    console.log(`[NCBI] WARNING: strand field is empty, inferred from coordinates: chrstart(${chrstart0}) ${isMinusStrand ? '>' : '<='} chrstop(${chrstop0}) → ${isMinusStrand ? 'minus' : 'plus'}`)
  }

  // 确定实际的起始和结束位置（较小值和较大值）
  const minPos0 = Math.min(chrstart0, chrstop0)  // 0-based 较小值
  const maxPos0 = Math.max(chrstart0, chrstop0)  // 0-based 较大值

  // 转换为 1-based 坐标
  const genomicStart1 = minPos0 + 1  // 1-based start（总是较小值）
  const genomicEnd1 = maxPos0        // 1-based end（总是较大值，0-based stop = 1-based end）

  console.log(`[NCBI] Genomic info: chrstart(0-based)=${chrstart0}, chrstop(0-based)=${chrstop0}, strand=${isMinusStrand ? 'minus' : 'plus'}`)
  console.log(`[NCBI] Converted to 1-based: ${genomicStart1}..${genomicEnd1} (length: ${genomicEnd1 - genomicStart1 + 1} bp)`)

  return {
    uid: data.uid || geneId,
    name: data.name || data.nomenclaturesymbol || '',
    description: data.description || '',
    organism: data.organism?.scientificname || '',
    chromosome: data.chromosome || '',
    strand: isMinusStrand ? 'minus' : 'plus',
    genomic_range_start: genomicStart1,
    genomic_range_end: genomicEnd1,
    biotype: data.genetype || data.genegroup || 'protein-coding',
    summary: data.summary || '',
    nomenclature_symbol: data.nomenclaturesymbol || data.name || '',
    gene_id: geneId,
    chr_accession: genomicInfo.chraccver || ''
  }
}

// ============ NCBI esearch — 搜索转录本 ============

export interface NCBISearchResult {
  count: number
  idList: string[]               // UID 列表
}

/** 使用 esearch 搜索某个基因的 RefSeq 转录本 */
async function searchRefSeqTranscripts(geneId: string, apiKey?: string): Promise<string[]> {
  await rateLimit(apiKey)
  // 搜索该基因在 nuccore 中的 RefSeq mRNA 记录
  const term = `${geneId}[Gene ID] AND "refseq"[filter] AND "mrna"[filter]`
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nuccore&term=${encodeURIComponent(term)}&retmax=10&retmode=json${buildApiParam(apiKey)}`
  console.log(`[NCBI] searchRefSeqTranscripts: ${url}`)
  const text = await httpsGet(url)
  const json = JSON.parse(text)

  if (json.esearchresult?.error) {
    console.warn('[NCBI] esearch error:', json.esearchresult.error)
    return []
  }

  return json.esearchresult?.idlist || []
}

/** 搜索某个基因的 RefSeq 蛋白质记录 */
async function searchRefSeqProteins(geneId: string, apiKey?: string): Promise<string[]> {
  await rateLimit(apiKey)
  const term = `${geneId}[Gene ID] AND "refseq"[filter]`
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=protein&term=${encodeURIComponent(term)}&retmax=10&retmode=json${buildApiParam(apiKey)}`
  console.log(`[NCBI] searchRefSeqProteins: ${url}`)
  const text = await httpsGet(url)
  const json = JSON.parse(text)

  if (json.esearchresult?.error) {
    console.warn('[NCBI] protein esearch error:', json.esearchresult.error)
    return []
  }

  return json.esearchresult?.idlist || []
}

// ============ NCBI esummary — 解析 accession ============

interface NuccoreSummary {
  uid: string
  accession: string             // e.g. NM_001256789
  accessionVersion: string      // e.g. NM_001256789.3
  title: string
  organism: string
  subtype: string               // e.g. 'mRNA', 'genomic'
}

/** 通过 UID 获取 nuccore 记录的 accession 号 */
async function fetchNuccoreSummary(uid: string, apiKey?: string): Promise<NuccoreSummary | null> {
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=nuccore&id=${uid}&retmode=json${buildApiParam(apiKey)}`
  const text = await httpsGet(url)
  const json = JSON.parse(text)
  const data = json.result?.[uid]
  if (!data) return null
  return {
    uid,
    accession: data.caption || '',
    accessionVersion: data.accessionversion || data.caption || '',
    title: data.title || '',
    organism: data.organism || '',
    subtype: data.subtype || ''
  }
}

/** 通过 UID 获取 protein 记录的 accession */
async function fetchProteinSummary(uid: string, apiKey?: string): Promise<{ accession: string; title: string } | null> {
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=protein&id=${uid}&retmode=json${buildApiParam(apiKey)}`
  const text = await httpsGet(url)
  const json = JSON.parse(text)
  const data = json.result?.[uid]
  if (!data) return null
  return {
    accession: data.caption || data.accessionversion || '',
    title: data.title || ''
  }
}

// ============ NCBI efetch — 下载序列 ============

/**
 * 下载基因组序列（GenBank 格式，含前后各 flankBp bp 侧翼）
 *
 * 策略：使用 esummary 返回的 chraccver (如 NC_000001.11) 作为 accession，
 * 用 efetch db=nuccore 配合 seq_start/seq_stop 下载指定区域的 GenBank 格式序列。
 */
export async function fetchGenomicSequence(
  summary: NCBIGeneSummary,
  flankBp: number = 4000,
  apiKey?: string
): Promise<{ content: string; sequence: string; features: GenBankFeature[] }> {
  // 计算含侧翼序列的坐标范围
  const start = Math.max(1, summary.genomic_range_start - flankBp)
  const end = summary.genomic_range_end + flankBp
  const strandParam = summary.strand === 'minus' ? 2 : 1

  // 优先使用染色体 accession (chraccver)
  if (summary.chr_accession) {
    await rateLimit(apiKey)
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${summary.chr_accession}&rettype=gb&retmode=text&seq_start=${start}&seq_stop=${end}&strand=${strandParam}${buildApiParam(apiKey)}`
    console.log(`[NCBI] fetchGenomicSequence: accession=${summary.chr_accession}, range=${start}-${end}, strand=${strandParam}`)
    const content = await httpsGet(url)
    return parseGenBankContent(content)
  }

  // 降级方案：使用 gene UID 通过 elink 获取 genomic accession
  console.warn('[NCBI] No chr_accession available, trying gene efetch fallback')
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${summary.gene_id}&rettype=gb&retmode=text${buildApiParam(apiKey)}`
  const content = await httpsGet(url)
  return parseGenBankContent(content)
}

/** 获取单个转录本的 mRNA 序列 (GenBank 格式) */
export async function fetchMRNASequence(accession: string, apiKey?: string): Promise<{ content: string; sequence: string; features: GenBankFeature[] }> {
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${encodeURIComponent(accession)}&rettype=gb&retmode=text${buildApiParam(apiKey)}`
  console.log(`[NCBI] fetchMRNASequence: ${accession}`)
  const content = await httpsGet(url)
  return parseGenBankContent(content)
}

/** 获取蛋白质序列 (FASTA 格式) */
export async function fetchProteinSequence(accession: string, apiKey?: string): Promise<string> {
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=${encodeURIComponent(accession)}&rettype=fasta&retmode=text${buildApiParam(apiKey)}`
  console.log(`[NCBI] fetchProteinSequence: ${accession}`)
  const content = await httpsGet(url)
  // 解析 FASTA
  return parseFastaSequence(content)
}

// ============ 序列解析工具 ============

/** 解析 GenBank 文本内容 */
function parseGenBankContent(content: string): { content: string; sequence: string; features: GenBankFeature[] } {
  if (!content || content.length < 50 || !content.includes('LOCUS')) {
    console.warn('[NCBI] Invalid GenBank content (length=' + (content?.length || 0) + ')')
    return { content: content || '', sequence: '', features: [] }
  }
  try {
    const record = parseGenBank(content)
    return {
      content,
      sequence: record.sequence || '',
      features: record.features || []
    }
  } catch (e) {
    console.error('[NCBI] GenBank parse error:', e)
    return { content, sequence: '', features: [] }
  }
}

/** 解析 FASTA 文本获取序列 */
function parseFastaSequence(content: string): string {
  if (!content) return ''
  const lines = content.replace(/\r/g, '').split('\n')
  let seq = ''
  let inSeq = false
  for (const line of lines) {
    if (line.startsWith('>')) { inSeq = true; continue }
    if (inSeq) seq += line.trim()
  }
  return seq.toUpperCase()
}

// ============ 从基因组 GenBank 的 mRNA join() 推断真实外显子结构 ============

/**
 * 从基因组 features 中提取 mRNA join() 并映射到 mRNA 局部坐标
 * 对于 complement 链基因，需要反转外显子顺序
 */
function inferExonsFromGenomicMRNA(
  genomicFeatures: GenBankFeature[],
  mrnaAccession: string,
  mrnaLength: number,
  isComplement: boolean
): Omit<GeneExon, 'id'>[] | null {
  // 查找匹配的 mRNA feature（通过 accession 或 transcript_id qualifier）
  const mrnaFeat = genomicFeatures.find(f => {
    if (f.type !== 'mRNA') return false
    const transcriptId = f.qualifiers?.transcript_id || f.qualifiers?.product || ''
    return transcriptId.includes(mrnaAccession) || f.location.includes('join')
  })

  if (!mrnaFeat || !mrnaFeat.location.includes('join')) {
    console.log(`[NCBI] No mRNA join() found in genomic features for ${mrnaAccession}`)
    return null
  }

  console.log(`[NCBI] Found genomic mRNA join(): ${mrnaFeat.location}`)

  // 解析 join() 获取基因组坐标
  const segments = parseJoinLocation(mrnaFeat.location)
  if (segments.length === 0) return null

  // 对于 complement 链，需要反转外显子顺序（基因组上靠后的坐标对应 mRNA 5' 端）
  const orderedSegments = isComplement ? [...segments].reverse() : segments

  // 计算每个外显子的长度，然后映射到 mRNA 局部坐标
  const exons: Omit<GeneExon, 'id'>[] = []
  let mrnaPos = 1  // mRNA 局部坐标从 1 开始

  for (let i = 0; i < orderedSegments.length; i++) {
    const seg = orderedSegments[i]
    const exonLen = seg.end - seg.start + 1
    const exonStart = mrnaPos
    const exonEnd = mrnaPos + exonLen - 1

    exons.push({
      transcript_id: 0,
      exon_number: i + 1,
      start: exonStart,
      end: exonEnd,
      strand: 1,  // mRNA 局部坐标总是正向
      utr_type: null  // 先设为 null，后面根据 CDS 调整
    })

    console.log(`[NCBI] Exon ${i + 1}: genomic ${seg.start}..${seg.end} → mRNA ${exonStart}..${exonEnd} (${exonLen} bp)`)
    mrnaPos += exonLen
  }

  return exons
}

// ============ 从 GenBank features 推断外显子结构 ============

function inferExonsFromFeatures(features: GenBankFeature[], sequenceLength?: number): Omit<GeneExon, 'id'>[] {
  const exons: Omit<GeneExon, 'id'>[] = []
  let exonNum = 1

  // 获取 mRNA 和 CDS features
  const mRNA = features.find(f => f.type === 'mRNA')
  const cds = features.find(f => f.type === 'CDS')

  // 1. 优先寻找明确的 exon features
  for (const feat of features) {
    if (feat.type === 'exon') {
      exons.push({
        transcript_id: 0,
        exon_number: exonNum++,
        start: feat.start + 1,
        end: feat.end,
        strand: feat.strand,
        utr_type: null
      })
    }
  }

  // 2. 如果没有 exon，从 mRNA join() 推断
  if (exons.length === 0 && mRNA && mRNA.location.includes('join')) {
    const segments = parseJoinLocation(mRNA.location)
    for (const seg of segments) {
      exons.push({
        transcript_id: 0,
        exon_number: exonNum++,
        start: seg.start,
        end: seg.end,
        strand: seg.strand,
        utr_type: null
      })
    }
  }

  // 3. 如果还没有，从 CDS join() 推断
  if (exons.length === 0 && cds && cds.location.includes('join')) {
    const segments = parseJoinLocation(cds.location)
    for (const seg of segments) {
      exons.push({
        transcript_id: 0,
        exon_number: exonNum++,
        start: seg.start,
        end: seg.end,
        strand: seg.strand,
        utr_type: null
      })
    }
  }

  // 4. 如果还没有（简单范围 CDS，单外显子基因），从 CDS 简单范围推断 + UTR
  if (exons.length === 0 && cds) {
    const cdsStart = cds.start + 1  // 转为 1-based
    const cdsEnd = cds.end
    const strand = cds.strand

    // 获取 mRNA 范围（如果有 mRNA feature 则用其坐标，否则用序列总长度）
    const mrnaStart = mRNA ? mRNA.start + 1 : 1
    const mrnaEnd = mRNA ? mRNA.end : (sequenceLength || cdsEnd)

    console.log(`[NCBI] inferExons: CDS=${cdsStart}..${cdsEnd}, mRNA=${mrnaStart}..${mrnaEnd}, mRNA feature exists=${!!mRNA}, sequenceLength=${sequenceLength}`)

    // 5'UTR（CDS 之前）
    if (cdsStart > mrnaStart) {
      exons.push({
        transcript_id: 0,
        exon_number: exonNum++,
        start: mrnaStart,
        end: cdsStart - 1,
        strand,
        utr_type: '5prime'
      })
      console.log(`[NCBI] inferExons: Added 5'UTR exon ${mrnaStart}..${cdsStart - 1}`)
    }

    // 编码外显子
    exons.push({
      transcript_id: 0,
      exon_number: exonNum++,
      start: cdsStart,
      end: cdsEnd,
      strand,
      utr_type: null
    })
    console.log(`[NCBI] inferExons: Added coding exon ${cdsStart}..${cdsEnd}`)

    // 3'UTR（CDS 之后）
    if (cdsEnd < mrnaEnd) {
      exons.push({
        transcript_id: 0,
        exon_number: exonNum++,
        start: cdsEnd + 1,
        end: mrnaEnd,
        strand,
        utr_type: '3prime'
      })
      console.log(`[NCBI] inferExons: Added 3'UTR exon ${cdsEnd + 1}..${mrnaEnd}`)
    } else {
      console.log(`[NCBI] inferExons: No 3'UTR (cdsEnd=${cdsEnd} >= mrnaEnd=${mrnaEnd})`)
    }
  }

  return exons
}

/** 从 mRNA GenBank features 中提取 CDS 序列（支持 join() 多段拼接） */
function extractCDSSequence(features: GenBankFeature[], fullSequence: string): string {
  const cds = features.find(f => f.type === 'CDS')
  if (!cds || !fullSequence) return ''

  // 如果是 join() 多段 CDS，拼接各段序列
  if (cds.location.includes('join')) {
    const segments = parseJoinLocation(cds.location)
    let cdsSeq = ''
    for (const seg of segments) {
      // seg.start 和 seg.end 是 1-based，转为 0-based 截取
      const start = Math.max(0, seg.start - 1)
      const end = Math.min(fullSequence.length, seg.end)
      cdsSeq += fullSequence.substring(start, end)
    }
    return cdsSeq
  }

  // 简单范围 CDS
  if (cds.start > 0 && cds.end <= fullSequence.length) {
    return fullSequence.substring(cds.start - 1, cds.end)
  }
  return ''
}

/** 解析 GenBank join() 位置字符串 */
function parseJoinLocation(location: string): { start: number; end: number; strand: 1 | -1 }[] {
  const segments: { start: number; end: number; strand: 1 | -1 }[] = []
  const isComplement = location.includes('complement')
  const clean = location.replace(/complement\(|join\(|\)/g, '').trim()
  const parts = clean.split(',')

  for (const part of parts) {
    const match = part.match(/(\d+)\.\.(\d+)/)
    if (match) {
      segments.push({
        start: parseInt(match[1]),
        end: parseInt(match[2]),
        strand: isComplement ? -1 : 1
      })
    }
  }
  return segments
}

// ============ 主编排函数 ============

export interface NCBIImportResult {
  success: boolean
  geneId?: number
  message: string
  geneName?: string
  transcriptsImported?: number
  updated?: boolean              // true = 更新了已有记录
}

/**
 * 从 NCBI 导入基因的完整编排函数
 *
 * 流程：
 * 1. 获取基因元数据（esummary → 含 chraccver 染色体 accession）
 * 2. 下载基因组序列（GenBank 格式，含前后各 4000bp 侧翼）
 * 3. 搜索 RefSeq 转录本（esearch → accession 列表）
 * 4. 下载每个转录本的 mRNA 序列 + 对应蛋白质序列
 * 5. 写入/更新数据库
 *
 * 重复导入策略：如果已存在相同 ncbi_gene_id 的记录，更新而非创建重复
 */
export async function importGeneFromNCBI(
  geneId: string,
  apiKey?: string,
  onProgress?: (progress: NCBImportProgress) => void
): Promise<NCBIImportResult> {
  const progress = (stage: NCBImportProgress['stage'], message: string, percent: number) => {
    onProgress?.({ stage, message, percent })
  }

  try {
    // 0. 检查是否已存在（按 ncbi_gene_id 查找，fallback 按 gene_name 查找）
    let existingGene = geneRepo.findGeneByNcbiId(geneId)

    // 1. 获取元数据
    progress('fetching-metadata', '正在获取基因元数据...', 10)
    const summary = await fetchGeneSummary(geneId, apiKey)

    if (!summary.name) {
      throw new Error(`无法获取 Gene ID ${geneId} 的信息`)
    }
    console.log(`[NCBI] Gene: ${summary.name}, organism: ${summary.organism}, chr: ${summary.chromosome}, chraccver: ${summary.chr_accession}`)
    console.log(`[NCBI] Range: ${summary.genomic_range_start}-${summary.genomic_range_end}, strand: ${summary.strand}`)

    // 如果 ncbi_gene_id 未找到，按 gene_name 查找旧记录（处理旧数据无 ncbi_gene_id 的情况）
    if (!existingGene) {
      const geneName = summary.description || summary.name
      existingGene = geneRepo.findGeneByNameAndType(geneName, 'genomic')
      if (existingGene) {
        console.log(`[NCBI] Found existing gene by name: id=${existingGene.id}, name=${existingGene.gene_name}`)
      }
    }
    const isUpdate = !!existingGene

    // 清理重复记录（如果有多个同 ncbi_gene_id 的记录，保留 id 最大的，删除其余的）
    const allMatches = geneRepo.findAllGenesByNcbiId(geneId)
    if (allMatches.length > 1) {
      console.log(`[NCBI] Found ${allMatches.length} records with ncbi_gene_id=${geneId}, cleaning duplicates...`)
      // 保留 id 最大的（通常是最新的）
      const kept = allMatches[0]
      for (let i = 1; i < allMatches.length; i++) {
        const dup = allMatches[i]
        console.log(`[NCBI] Deleting duplicate gene id=${dup.id}`)
        geneRepo.deleteGeneTranscriptsByGene(dup.id)
        geneRepo.deleteGeneCrossRefsByGene(dup.id)
        geneRepo.deleteGene(dup.id)
      }
      // 如果之前没找到 existingGene，但现在清理后只剩一个，使用它
      if (!existingGene) {
        existingGene = kept
      }
      console.log(`[NCBI] Kept gene id=${kept.id}`)
    }
    // 重新判断 isUpdate（清理后可能只剩一个）
    const isUpdateAfterDedup = !!existingGene

    // 3. 下载基因组序列（GenBank 格式，含 4000bp 侧翼）
    progress('downloading-sequence', `正在下载基因组序列（含±4000bp侧翼）...`, 25)
    let genomicSequence = ''
    let features: GenBankFeature[] = []
    let genbankContent = ''

    try {
      const result = await fetchGenomicSequence(summary, 4000, apiKey)
      genomicSequence = result.sequence
      features = result.features
      genbankContent = result.content
      console.log(`[NCBI] Genomic sequence: ${genomicSequence.length} bp, ${features.length} features`)
      if (genomicSequence.length > 0) {
        const expectedLen = (summary.genomic_range_end - summary.genomic_range_start) + 8000
        console.log(`[NCBI] Expected ~${expectedLen} bp (gene ${summary.genomic_range_end - summary.genomic_range_start} + 8000 flank), got ${genomicSequence.length} bp`)
      }
    } catch (seqErr: any) {
      console.warn('[NCBI] Genomic sequence download failed:', seqErr.message)
    }

    // 3. 搜索转录本
    progress('parsing', '正在搜索转录本...', 45)
    let mrnaUIDs: string[] = []
    let proteinUIDs: string[] = []

    try {
      mrnaUIDs = await searchRefSeqTranscripts(geneId, apiKey)
      console.log(`[NCBI] Found ${mrnaUIDs.length} RefSeq mRNA transcripts`)
    } catch (err: any) {
      console.warn('[NCBI] mRNA search failed:', err.message)
    }

    try {
      proteinUIDs = await searchRefSeqProteins(geneId, apiKey)
      console.log(`[NCBI] Found ${proteinUIDs.length} RefSeq protein records`)
    } catch (err: any) {
      console.warn('[NCBI] Protein search failed:', err.message)
    }

    // 4. 写入/更新数据库
    progress('saving', '正在保存到数据库...', 60)

    const now = new Date().toISOString()
    let geneSeqId: number

    if (isUpdateAfterDedup && existingGene) {
      // 填空式更新已有记录 — 只补充缺失字段，不覆盖用户编辑的数据
      geneSeqId = existingGene.id
      const updateData: Partial<GeneSequence> = {
        ncbi_imported_at: now,
        ncbi_gene_id: existingGene.ncbi_gene_id || geneId,  // 确保 ncbi_gene_id 被设置
      }

      // 只在空字段时填充（保留用户编辑的内容）
      if (!existingGene.species) updateData.species = summary.organism
      if (!existingGene.chromosome) updateData.chromosome = summary.chromosome
      if (!existingGene.biotype) updateData.biotype = summary.biotype
      // gene_symbol 填空：使用 "NCBI:存取号" 格式
      // 注意：使用 summary.name（gene symbol）而非 nomenclature_symbol（可能返回染色体存取号）
      if (!existingGene.gene_symbol) {
        const geneSym = summary.name
        const tags: string[] = []
        if (geneSym) tags.push(`NCBI:${geneSym}`)
        if (geneId && !tags.some(t => t.endsWith(`:${geneId}`))) tags.push(`NCBI:${geneId}`)
        if (tags.length > 0) updateData.gene_symbol = tags.join(';')
      }
      if (!existingGene.summary) updateData.summary = summary.summary
      if (!existingGene.description) updateData.description = summary.description
      if (!existingGene.genomic_start) updateData.genomic_start = summary.genomic_range_start
      if (!existingGene.genomic_end) updateData.genomic_end = summary.genomic_range_end
      // strand 是技术元数据，始终以 NCBI 权威数据为准（数据库默认值 1 不代表用户选择）
      const ncbiStrand = summary.strand === 'minus' ? -1 : 1
      console.log(`[NCBI] Strand check: existingGene.strand=${existingGene.strand}, ncbiStrand=${ncbiStrand}, summary.strand='${summary.strand}'`)
      if (existingGene.strand !== ncbiStrand) {
        updateData.strand = ncbiStrand
        console.log(`[NCBI] Strand updated: ${existingGene.strand} → ${ncbiStrand}`)
      }

      // 只在序列为空时才更新（保留用户编辑的序列）
      if (!existingGene.sequence && genomicSequence) {
        updateData.sequence = genomicSequence
        updateData.features_json = JSON.stringify(features)
      }

      geneRepo.updateGene(geneSeqId, updateData)
      console.log(`[NCBI] Updated existing gene record id=${geneSeqId}`)

      // 不删除转录本和交叉引用（保留用户添加的）
      // 转录本和交叉引用的添加逻辑在下面，会跳过已存在的记录
    } else {
      // 创建新记录
      // gene_name: 使用基因名称作为主别名
      // gene_symbol: 使用 "NCBI:存取号" 格式存储数据库存取号
      // 注意：使用 summary.name（即 gene symbol，如 LOC4327046）而非 nomenclature_symbol（可能返回染色体存取号如 NC_089045.1）
      const geneSymbol = summary.name
      const geneSymbolTags: string[] = []
      if (geneSymbol) geneSymbolTags.push(`NCBI:${geneSymbol}`)
      if (geneId && !geneSymbolTags.some(t => t.endsWith(`:${geneId}`))) {
        geneSymbolTags.push(`NCBI:${geneId}`)
      }
      geneSeqId = geneRepo.createGene({
        gene_name: summary.description || summary.name,
        type: 'genomic',
        species: summary.organism,
        sequence: genomicSequence,
        accession_number: summary.chr_accession || '',
        description: summary.description,
        features_json: JSON.stringify(features),
        topology: 'linear',
        file_path: '',
        gene_symbol: geneSymbolTags.join(';'),
        chromosome: summary.chromosome,
        strand: summary.strand === 'minus' ? -1 : 1,
        biotype: summary.biotype,
        ncbi_gene_id: geneId,
        genomic_start: summary.genomic_range_start,
        genomic_end: summary.genomic_range_end,
        summary: summary.summary,
        ncbi_imported_at: now
      })
      const createdStrand = summary.strand === 'minus' ? -1 : 1
      console.log(`[NCBI] Created new gene record id=${geneSeqId}, strand=${createdStrand} (summary.strand='${summary.strand}')`)
    }

    // 2.5. 采集相关序列（必须在 geneSeqId 确定后执行，确保 gene_id 正确）
    progress('fetching-related', '正在采集相关序列...', 30)
    try {
      await collectRelatedSequences(geneId, geneSeqId, summary.genomic_range_start, summary.genomic_range_end, apiKey, (msg) => {
        progress('fetching-related', msg, 30)
      })
      console.log(`[NCBI] Related sequences collected for gene ${geneId} (dbId=${geneSeqId})`)
    } catch (relErr: any) {
      console.warn(`[NCBI] Failed to collect related sequences:`, relErr.message)
    }

    // 创建交叉引用
    geneRepo.createGeneCrossRef({
      gene_id: geneSeqId,
      database: 'NCBI',
      accession: geneId,
      url: `https://www.ncbi.nlm.nih.gov/gene/${geneId}`,
      is_primary: true
    })

    if (summary.chr_accession) {
      geneRepo.createGeneCrossRef({
        gene_id: geneSeqId,
        database: 'NCBI-RefSeq',
        accession: summary.chr_accession,
        url: `https://www.ncbi.nlm.nih.gov/nuccore/${summary.chr_accession}`,
        is_primary: false
      })
    }

    // 5. 导入转录本（mRNA）
    let transcriptsImported = 0
    const maxTranscripts = Math.min(mrnaUIDs.length, 5)

    // 构建 protein accession → sequence 映射（稍后使用）
    const proteinMap = new Map<string, string>()
    for (const puid of proteinUIDs.slice(0, 10)) {
      try {
        const pinfo = await fetchProteinSummary(puid, apiKey)
        if (pinfo) {
          const seq = await fetchProteinSequence(pinfo.accession, apiKey)
          proteinMap.set(pinfo.accession, seq)
          console.log(`[NCBI] Protein ${pinfo.accession}: ${seq.length} aa`)
        }
      } catch (err: any) {
        console.warn(`[NCBI] Failed to fetch protein ${puid}:`, err.message)
      }
    }

    for (let i = 0; i < maxTranscripts; i++) {
      const uid = mrnaUIDs[i]
      try {
        // 获取 accession
        const nucInfo = await fetchNuccoreSummary(uid, apiKey)
        if (!nucInfo || !nucInfo.accession) {
          console.warn(`[NCBI] Could not resolve accession for UID ${uid}`)
          continue
        }
        const accession = nucInfo.accessionVersion || nucInfo.accession

        // 检查转录本是否已存在
        const existingTranscript = geneRepo.findGeneTranscriptByAccession(geneSeqId, accession)
        if (existingTranscript) {
          // 如果旧转录本外显子数为 0（来自有 bug 的旧导入），删除并重新创建
          if (existingTranscript.exon_count === 0 && existingTranscript.source === 'NCBI') {
            console.log(`[NCBI] Transcript ${accession} has 0 exons (old buggy import), deleting and re-creating`)
            geneRepo.deleteGeneExonsByTranscript(existingTranscript.id)
            geneRepo.deleteGeneTranscript(existingTranscript.id)
          } else {
            console.log(`[NCBI] Transcript ${accession} already exists (id=${existingTranscript.id}, ${existingTranscript.exon_count} exons), skipping`)
            continue
          }
        }

        console.log(`[NCBI] Importing transcript ${i + 1}/${maxTranscripts}: ${accession} (${nucInfo.title})`)

        progress('saving', `正在下载转录本 ${accession}...`, 60 + Math.floor(30 * (i / maxTranscripts)))

        // 下载 mRNA GenBank
        const mrnaResult = await fetchMRNASequence(accession, apiKey)
        const mrnaSeq = mrnaResult.sequence
        const mrnaFeatures = mrnaResult.features

        // 提取 CDS
        const cdsSeq = extractCDSSequence(mrnaFeatures, mrnaSeq)

        // 推断外显子：优先使用基因组 GenBank 的 mRNA join()，否则 fallback 到 mRNA CDS 推断
        let exons = inferExonsFromGenomicMRNA(
          features,  // 基因组 features
          accession,
          mrnaSeq.length,
          summary.strand === 'minus'
        )

        // 如果基因组推断失败，fallback 到 mRNA CDS 推断
        if (!exons || exons.length === 0) {
          console.log(`[NCBI] Falling back to mRNA CDS-based exon inference`)
          exons = inferExonsFromFeatures(mrnaFeatures, mrnaSeq.length)
        }

        // 根据 CDS 位置调整 UTR 类型
        const cdsFeat = mrnaFeatures.find(f => f.type === 'CDS')
        if (cdsFeat && exons.length > 0) {
          const cdsStart = cdsFeat.start + 1  // 1-based
          const cdsEnd = cdsFeat.end

          for (const exon of exons) {
            if (exon.end < cdsStart) {
              exon.utr_type = '5prime'  // 完全在 CDS 之前
            } else if (exon.start > cdsEnd) {
              exon.utr_type = '3prime'  // 完全在 CDS 之后
            } else {
              exon.utr_type = null  // 包含 CDS 部分
            }
          }
        }

        // 匹配蛋白质序列 — 尝试从 mRNA 的 protein_id qualifier 或按序匹配
        let proteinSeq = ''
        const proteinId = cdsFeat?.qualifiers?.protein_id || ''
        if (proteinId && proteinMap.has(proteinId)) {
          proteinSeq = proteinMap.get(proteinId) || ''
        }
        // 降级：按顺序匹配第一个未使用的 protein
        if (!proteinSeq && proteinMap.size > 0) {
          for (const [pacc, pseq] of proteinMap) {
            if (pseq) { proteinSeq = pseq; break }
          }
        }

        const transcriptId = geneRepo.createGeneTranscript({
          gene_id: geneSeqId,
          transcript_id: accession,
          name: nucInfo.title || `${summary.name} transcript ${i + 1}`,
          is_primary: i === 0,
          mrna_sequence: mrnaSeq,
          cds_sequence: cdsSeq,
          protein_sequence: proteinSeq,
          exon_count: exons.length,
          strand: summary.strand === 'minus' ? -1 : 1,
          source: 'NCBI',
          cds_start: cdsFeat ? cdsFeat.start + 1 : 0,  // 1-based
          cds_end: cdsFeat ? cdsFeat.end : 0
        })

        // 写入外显子
        for (const exon of exons) {
          geneRepo.createGeneExon({ ...exon, transcript_id: transcriptId })
        }

        transcriptsImported++

        // 添加 mRNA 交叉引用（跳过已存在的）
        if (!geneRepo.findGeneCrossRefByAccession(geneSeqId, 'NCBI-RefSeq', accession)) {
          geneRepo.createGeneCrossRef({
            gene_id: geneSeqId,
            database: 'NCBI-RefSeq',
            accession: accession,
            url: `https://www.ncbi.nlm.nih.gov/nuccore/${accession}`,
            is_primary: i === 0
          })
        }

        // 如果有蛋白 ID，也加交叉引用（跳过已存在的）
        if (proteinId && !geneRepo.findGeneCrossRefByAccession(geneSeqId, 'NCBI-Protein', proteinId)) {
          geneRepo.createGeneCrossRef({
            gene_id: geneSeqId,
            database: 'NCBI-Protein',
            accession: proteinId,
            url: `https://www.ncbi.nlm.nih.gov/protein/${proteinId}`,
            is_primary: false
          })
        }

        console.log(`[NCBI] Transcript ${accession}: mRNA=${mrnaSeq.length}bp, CDS=${cdsSeq.length}bp, protein=${proteinSeq.length}aa, ${exons.length} exons`)
      } catch (txErr: any) {
        console.warn(`[NCBI] Failed to import transcript ${uid}:`, txErr.message)
      }
    }

    // 匹配物种插件注释
    try {
      const enabledPlugins = speciesRepo.getEnabledPlugins()
      if (enabledPlugins.length > 0) {
        console.log(`[NCBI] Checking ${enabledPlugins.length} enabled species plugins for annotations...`)
        let totalMatched = 0
        for (const plugin of enabledPlugins) {
          const annotations = speciesRepo.getAnnotationsByNcbiId(geneId, plugin.id)
          if (annotations.length > 0) {
            for (const ann of annotations) {
              if (!ann.gene_id) {
                speciesRepo.linkAnnotationToGene(ann.id, geneSeqId)
                totalMatched++
              }
            }
            console.log(`[NCBI] Matched ${annotations.length} annotations from plugin: ${plugin.species_name}`)
          }
        }
        if (totalMatched > 0) {
          console.log(`[NCBI] Total ${totalMatched} species annotations linked to gene ${geneSeqId}`)
        }
      }
    } catch (pluginErr: any) {
      console.warn('[NCBI] Failed to match species plugin annotations:', pluginErr.message)
    }

    // 全量同步插件注释数据到文件（包括 CSV 导入的初始数据）
    try {
      const linkedAnns = speciesRepo.getAnnotationsByGene(geneSeqId)
      if (linkedAnns.length > 0) {
        geneFileService.syncAllAnnotationsToFiles(geneId, geneSymbol, linkedAnns as any)
      }
    } catch {}

    // 文件持久化：写入基因数据目录
    try {
      const geneSymbol = summary.name || geneId
      geneFileService.initGeneDirectory(geneId, geneSymbol, {
        id: geneSeqId,
        gene_name: summary.description || summary.name,
        species: summary.organism,
        ncbi_gene_id: geneId,
        accession_number: summary.chr_accession || '',
        description: summary.description || ''
      })
      // 写入序列文件
      const txRecords = geneRepo.getGeneTranscripts(geneSeqId)
      const txFiles = txRecords.map((t: any) => ({
        accession: t.transcript_id,
        mrnaGenBank: t.mrna_sequence ? `>${t.transcript_id} mRNA\n${t.mrna_sequence.match(/.{1,60}/g)?.join('\n') || t.mrna_sequence}` : '',
        proteinFasta: t.protein_sequence ? `>${t.transcript_id} protein\n${t.protein_sequence.match(/.{1,60}/g)?.join('\n') || t.protein_sequence}` : ''
      }))
      const relFiles = geneRepo.getGeneRelatedSequences(geneSeqId)
        .filter((r: any) => r.ncbi_content && r.ncbi_content.length > 50 && !r.ncbi_content.startsWith('SKIPPED'))
        .map((r: any) => ({ accession: r.nucleotide_accession || r.protein_accession, seqType: r.seq_type, content: r.ncbi_content }))
      geneFileService.writeGeneSequences(geneId, geneSymbol, {
        genomicGenBank: genbankContent || '',
        transcripts: txFiles,
        relatedSequences: relFiles
      })
      // NCBI 注释信息文件写入 (Phase 2)
      geneFileService.writeNcbiAnnotations(geneId, geneSymbol, {
        name: summary.name,
        description: summary.description,
        organism: summary.organism,
        chromosome: summary.chromosome,
        chr_accession: summary.chr_accession,
        genomic_range_start: summary.genomic_range_start,
        genomic_range_end: summary.genomic_range_end,
        strand: summary.strand,
        gene_symbol: summary.gene_symbol
      })
      // 写入转录本元数据
      const txMeta = txRecords.map((t: any) => ({
        transcript_id: t.transcript_id,
        name: t.name,
        is_primary: t.is_primary,
        exon_count: t.exon_count,
        mrna_length: t.mrna_sequence ? t.mrna_sequence.length : 0,
        cds_length: t.cds_sequence ? t.cds_sequence.length : 0,
        protein_length: t.protein_sequence ? t.protein_sequence.length : 0,
        cds_start: t.cds_start,
        cds_end: t.cds_end,
        source: t.source
      }))
      if (txMeta.length > 0) {
        geneFileService.writeAnnotationFile(geneId, geneSymbol, 'ncbi', 'transcripts.json', { transcripts: txMeta })
      }
      // 写入交叉引用
      const crossRefsData = geneRepo.getGeneCrossRefs(geneSeqId)
      if (crossRefsData.length > 0) {
        geneFileService.writeAnnotationFile(geneId, geneSymbol, 'ncbi', 'cross_refs.json', {
          cross_references: crossRefsData.map((r: any) => ({ database: r.database, accession: r.accession, url: r.url, is_primary: r.is_primary }))
        })
      }
      geneFileService.regenerateGenesIndex()
    } catch (fileErr: any) {
      console.warn(`[NCBI] File persistence failed (non-blocking): ${fileErr.message}`)
    }

    progress('done', isUpdate ? '更新完成' : '导入完成', 100)

    const action = isUpdate ? '更新' : '导入'
    return {
      success: true,
      geneId: geneSeqId,
      message: `成功${action}基因 ${summary.name}（${summary.organism}），基因组 ${genomicSequence.length.toLocaleString()} bp，${transcriptsImported} 个转录本`,
      geneName: summary.name,
      transcriptsImported,
      updated: isUpdate
    }
  } catch (err: any) {
    progress('error', `导入失败: ${err.message}`, 0)
    return {
      success: false,
      message: `导入失败: ${err.message}`
    }
  }
}

// ============ 相关序列采集 ============

/** NCBI ELINK 响应结构 */
interface NCBILinkSet {
  dbfrom: string
  ids: string[]
  linksetdbs: Array<{
    dbto: string
    linkname: string
    links: string[]  // UID 列表
  }>
}

/** 获取基因的相关序列 UID 列表 */
export async function fetchRelatedSequencesUIDs(geneId: string, apiKey?: string): Promise<NCBILinkSet[]> {
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?dbfrom=gene&id=${encodeURIComponent(geneId)}&db=nuccore,protein&retmode=json${buildApiParam(apiKey)}`
  console.log(`[NCBI] fetchRelatedSequencesUIDs: geneId=${geneId}`)
  const text = await httpsGet(url)
  const json = JSON.parse(text)
  
  if (json.error) throw new Error(`NCBI elink error: ${json.error}`)
  if (!json.linksets || json.linksets.length === 0) {
    console.warn(`[NCBI] No linksets found for Gene ID ${geneId}`)
    return []
  }
  
  return json.linksets
}

/** 从 UID 获取核酸序列元数据 */
interface NucCoreSummary {
  uid: string
  accessionversion: string
  title: string
  biomol: string       // 'genomic' | 'mRNA' | 'dna' | 'rna'
  sourcedb: string     // 'refseq' | 'insd'
  slen: number         // 序列长度
}

async function fetchNuccoreSummaries(uids: string[], apiKey?: string): Promise<Map<string, NucCoreSummary>> {
  if (uids.length === 0) return new Map()
  
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=nuccore&id=${uids.join(',')}&retmode=json${buildApiParam(apiKey)}`
  const text = await httpsGet(url)
  const json = JSON.parse(text)
  
  const result = new Map<string, NucCoreSummary>()
  if (json.result) {
    for (const uid of uids) {
      const data = json.result[uid]
      if (data) {
        result.set(uid, {
          uid,
          accessionversion: data.accessionversion || '',
          title: data.title || '',
          biomol: data.biomol || '',
          sourcedb: data.sourcedb || '',
          slen: data.slen || 0
        })
      }
    }
  }
  
  return result
}

/** 从 UID 获取蛋白序列元数据 */
interface ProteinSummary {
  uid: string
  accessionversion: string
  title: string
  slen: number         // 蛋白长度 (aa)
}

async function fetchProteinSummaries(uids: string[], apiKey?: string): Promise<Map<string, ProteinSummary>> {
  if (uids.length === 0) return new Map()
  
  await rateLimit(apiKey)
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=protein&id=${uids.join(',')}&retmode=json${buildApiParam(apiKey)}`
  const text = await httpsGet(url)
  const json = JSON.parse(text)
  
  const result = new Map<string, ProteinSummary>()
  if (json.result) {
    for (const uid of uids) {
      const data = json.result[uid]
      if (data) {
        result.set(uid, {
          uid,
          accessionversion: data.accessionversion || '',
          title: data.title || '',
          slen: data.slen || 0
        })
      }
    }
  }
  
  return result
}

/**
 * 采集并保存相关序列
 * 策略：仅获取 accession 列表，不下栽完整序列（避免大量 API 请求）
 */
async function collectRelatedSequences(
  geneId: string,
  dbGeneId: number,
  geneGenomicStart: number,
  geneGenomicEnd: number,
  apiKey?: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  if (!dbGeneId) return  // 基因尚未创建，跳过
  
  onProgress?.('正在获取相关序列列表...')
  
  // 1. 获取 ELINK linksets
  const linksets = await fetchRelatedSequencesUIDs(geneId, apiKey)
  if (linksets.length === 0) {
    console.log(`[NCBI] No related sequences for Gene ID ${geneId}`)
    return
  }
  
  // 2. 收集所有 UID
  const nuccoreUids: string[] = []
  const proteinUids: string[] = []
  
  for (const linkset of linksets) {
    for (const dbInfo of linkset.linksetdbs) {
      for (const uid of dbInfo.links) {
        if (dbInfo.dbto === 'nuccore') {
          nuccoreUids.push(uid)
        } else if (dbInfo.dbto === 'protein') {
          proteinUids.push(uid)
        }
      }
    }
  }
  
  console.log(`[NCBI] Related sequences: ${nuccoreUids.length} nuccore, ${proteinUids.length} protein`)
  
  // 3. 批量获取核酸序列元数据
  const nuccoreMap = new Map<string, NucCoreSummary>()
  if (nuccoreUids.length > 0) {
    onProgress?.('正在解析核酸序列信息...')
    const batches = chunkArray(nuccoreUids, 200)  // ESUMMARY 限制每次最多 200 个 UID
    for (const batch of batches) {
      const batchMap = await fetchNuccoreSummaries(batch, apiKey)
      for (const [uid, data] of batchMap) {
        nuccoreMap.set(uid, data)
      }
    }
  }
  
  // 4. 批量获取蛋白元数据
  const proteinMap = new Map<string, ProteinSummary>()
  if (proteinUids.length > 0) {
    onProgress?.('正在解析蛋白序列信息...')
    const batches = chunkArray(proteinUids, 200)
    for (const batch of batches) {
      const batchMap = await fetchProteinSummaries(batch, apiKey)
      for (const [uid, data] of batchMap) {
        proteinMap.set(uid, data)
      }
    }
  }
  
  // 5. 去重（按 accession）
  const seenNuccore = new Set<string>()
  
  // 6. 保存核酸相关序列
  let savedCount = 0
  for (const [, data] of nuccoreMap) {
    const acc = data.accessionversion
    if (seenNuccore.has(acc)) continue
    seenNuccore.add(acc)
    
    // 判断序列类型
    let seqType: 'genomic' | 'mRNA' = 'genomic'
    if (data.biomol === 'mRNA' || data.biomol === 'rna') {
      seqType = 'mRNA'
    }
    // 检查标题中是否包含特定标识
    if (data.title.toLowerCase().includes('mRNA') || data.title.toLowerCase().includes('cDNA')) {
      seqType = 'mRNA'
    }
    
    // 检查数据库中是否已存在
    const existing = geneRepo.findGeneRelatedSequenceByAccession(dbGeneId, acc)
    if (existing) {
      console.log(`[NCBI] Related sequence already exists: ${acc}`)
      continue
    }
    
    // 提取基因组范围（如果有坐标信息）
    let genRange: string | null = null
    const rangeMatch = data.title.match(/\((\d+)\.\.(\d+)\)/)
    if (rangeMatch) {
      genRange = `${rangeMatch[1]}..${rangeMatch[2]}`
    }
    
    // 查找对应的蛋白 accession（RefSeq 命名规则）
    let proteinAcc: string | null = null
    const nucPrefix = acc.split('.')[0]
    if (nucPrefix.startsWith('XM_') || nucPrefix.startsWith('NX_')) {
      proteinAcc = nucPrefix.replace('XM_', 'XP_').replace('NX_', 'NP_') + '.1'
      if (!proteinMap.has(proteinAcc)) {
        proteinAcc = null  // 蛋白不存在
      }
    } else if (nucPrefix.startsWith('AE_') || nucPrefix.startsWith('AP_') || nucPrefix.startsWith('AK_')) {
      // GenBank 提交的核酸，蛋白 accession 需要查蛋白映射
      // 暂时不映射，因为命名规则不统一
    }
    
    // 保存
    geneRepo.createGeneRelatedSequence({
      gene_id: dbGeneId,
      seq_type: seqType,
      nucleotide_accession: acc,
      protein_accession: proteinAcc,
      genomic_range: genRange,
      description: data.title,
      ncbi_content: '',
      ncbi_imported_at: new Date().toISOString()
    })
    savedCount++
  }
  
  // 7. 保存独立蛋白序列（未被 mRNA 关联的）
  for (const [, data] of proteinMap) {
    const acc = data.accessionversion
    
    // 保存为 protein 类型
    geneRepo.createGeneRelatedSequence({
      gene_id: dbGeneId,
      seq_type: 'protein',
      nucleotide_accession: '',
      protein_accession: acc,
      genomic_range: null,
      description: data.title,
      ncbi_content: '',
      ncbi_imported_at: new Date().toISOString()
    })
    savedCount++
  }
  
  console.log(`[NCBI] Saved ${savedCount} related sequences for Gene ID ${geneId}`)

  // 8. 自动下载相关序列内容（本地优先缓存）
  const MAX_NUCLEOTIDE_SIZE = 200000 // 跳过超过 200kb 的染色体/支架级序列
  const allRelated = geneRepo.getGeneRelatedSequences(dbGeneId)
  const needDownload = allRelated.filter(r => !r.ncbi_content || r.ncbi_content.trim() === '')

  // 8a. 核酸类序列（GenBank 格式）
  const nucNeedDl = needDownload.filter(r =>
    (r.seq_type === 'mRNA' || r.seq_type === 'genomic' || r.seq_type === 'ncRNA') &&
    r.nucleotide_accession
  )
  if (nucNeedDl.length > 0) {
    console.log(`[NCBI] Auto-downloading GenBank for ${nucNeedDl.length} nucleotide sequences...`)
    let dlCount = 0
    for (const rel of nucNeedDl) {
      try {
        const result = await fetchMRNASequence(rel.nucleotide_accession, apiKey)
        if (result.content && result.content.length > 50) {
          // 跳过超大序列（染色体级）
          if (result.sequence && result.sequence.length > MAX_NUCLEOTIDE_SIZE) {
            console.log(`[NCBI] Skipping oversized sequence ${rel.nucleotide_accession} (${result.sequence.length} bp > ${MAX_NUCLEOTIDE_SIZE})`)
            geneRepo.updateGeneRelatedSequenceContent(rel.id, `SKIPPED: sequence too large (${result.sequence.length} bp)`)
            continue
          }
          geneRepo.updateGeneRelatedSequenceContent(rel.id, result.content)
          dlCount++
        }
      } catch (dlErr: any) {
        console.warn(`[NCBI] Failed to download GenBank for ${rel.nucleotide_accession}: ${dlErr.message}`)
      }
    }
    console.log(`[NCBI] Downloaded GenBank for ${dlCount}/${nucNeedDl.length} nucleotide sequences`)
  }

  // 8b. 蛋白类序列（FASTA 格式）
  const protNeedDl = needDownload.filter(r =>
    r.seq_type === 'protein' && r.protein_accession
  )
  if (protNeedDl.length > 0) {
    console.log(`[NCBI] Auto-downloading FASTA for ${protNeedDl.length} protein sequences...`)
    let dlCount = 0
    for (const rel of protNeedDl) {
      try {
        await rateLimit(apiKey)
        const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=${encodeURIComponent(rel.protein_accession)}&rettype=fasta&retmode=text${buildApiParam(apiKey)}`
        const fastaContent = await httpsGet(url)
        if (fastaContent && fastaContent.length > 10 && fastaContent.startsWith('>')) {
          geneRepo.updateGeneRelatedSequenceContent(rel.id, fastaContent)
          dlCount++
        }
      } catch (dlErr: any) {
        console.warn(`[NCBI] Failed to download protein FASTA for ${rel.protein_accession}: ${dlErr.message}`)
      }
    }
    console.log(`[NCBI] Downloaded FASTA for ${dlCount}/${protNeedDl.length} protein sequences`)
  }
}

/** 数组分块 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
