/**
 * @module db/primer-repo
 * @description
 * 引物 Repository — 提供引物的 CRUD 操作、搜索、序列比对、XLSX 导入和种子数据管理。
 *
 * 架构设计意图：
 * - 封装 primers 表的所有数据库操作
 * - 引物比对（alignPrimerToGenes）：正向+反向互补精确/模糊匹配
 * - 载体引物扫描（scanVectorForUniversalPrimers）：通用引物在载体中的定位
 * - XLSX 批量导入支持
 *
 * 核心算法：
 * - alignPrimerToGenes: 正向精确 → 反向互补精确 → 正向1错配 → 反向互补1错配
 * - scanVectorForUniversalPrimers: 正向+反向互补精确扫描
 *
 * 依赖关系：
 * - db/base: 底层 SQL 工具 + reverseComplement + calcTm + calcGcContent
 * - shared/types: Primer, PrimerCategory, PrimerAlignmentHit, PrimerSiteInfo 类型
 */

import type { Primer, PrimerCategory, PrimerAlignmentHit, PrimerSiteInfo, GeneSequence } from '../../shared/types'
import { queryAll, queryOne, run, runNoSave, runBatch, lastInsertId, reverseComplement, calcTm, calcGcContent } from './base'
import { createLogger } from '../logger'

const log = createLogger('DB:Primer')

// ============ CRUD ============

/** 获取引物列表（可按类别过滤） */
export function getPrimers(category?: PrimerCategory): Primer[] {
  if (category) {
    return queryAll<Primer>('SELECT * FROM primers WHERE category = ? ORDER BY name', [category])
  }
  return queryAll<Primer>('SELECT * FROM primers ORDER BY name')
}

/** 根据 ID 获取单个引物 */
export function getPrimer(id: number): Primer | undefined {
  return queryOne<Primer>('SELECT * FROM primers WHERE id = ?', [id])
}

/** 搜索引物（按名称/序列/描述模糊匹配，可按类别过滤） */
export function searchPrimers(query: string, category?: PrimerCategory): Primer[] {
  const q = `%${query}%`
  if (category) {
    return queryAll<Primer>(
      'SELECT * FROM primers WHERE (name LIKE ?1 OR sequence LIKE ?1 OR description LIKE ?1) AND category = ?2 ORDER BY name',
      [q, category]
    )
  }
  return queryAll<Primer>(
    'SELECT * FROM primers WHERE name LIKE ?1 OR sequence LIKE ?1 OR description LIKE ?1 ORDER BY name',
    [q]
  )
}

/** 创建新引物记录 */
export function createPrimer(data: Omit<Primer, 'id' | 'created_at'>): number {
  run(
    'INSERT INTO primers (name, sequence, category, tm, gc_content, description, target_gene_id, alignment_result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [data.name, data.sequence, data.category, data.tm ?? null, data.gc_content ?? null, data.description ?? '', data.target_gene_id ?? null, data.alignment_result ?? '']
  )
  return lastInsertId()
}

/** 更新引物记录（部分更新） */
export function updatePrimer(id: number, data: Partial<Primer>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.sequence !== undefined) { fields.push('sequence = ?'); values.push(data.sequence) }
  if (data.category !== undefined) { fields.push('category = ?'); values.push(data.category) }
  if (data.tm !== undefined) { fields.push('tm = ?'); values.push(data.tm) }
  if (data.gc_content !== undefined) { fields.push('gc_content = ?'); values.push(data.gc_content) }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
  if (data.target_gene_id !== undefined) { fields.push('target_gene_id = ?'); values.push(data.target_gene_id) }
  if (data.alignment_result !== undefined) { fields.push('alignment_result = ?'); values.push(data.alignment_result) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE primers SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 删除引物记录 */
export function deletePrimer(id: number): void {
  run('DELETE FROM primers WHERE id = ?', [id])
}

// ============ 引物序列比对 ============

/** 将引物与基因库比对：正向精确 → RC精确 → 正向1错配 → RC1错配 */
export function alignPrimerToGenes(primerId: number): PrimerAlignmentHit[] {
  const primer = getPrimer(primerId)
  if (!primer || !primer.sequence) return []
  const seq = primer.sequence.toUpperCase()
  const rcSeq = reverseComplement(seq)
  const genes = queryAll<GeneSequence>('SELECT * FROM gene_sequences WHERE sequence IS NOT NULL AND sequence != ""')
  const hits: PrimerAlignmentHit[] = []

  for (const gene of genes) {
    const geneSeq = gene.sequence.toUpperCase()
    if (geneSeq.length < seq.length) continue
    const fwdIdx = geneSeq.indexOf(seq)
    if (fwdIdx !== -1) {
      hits.push({ gene_id: gene.id, gene_name: gene.gene_name, match_start: fwdIdx + 1, match_end: fwdIdx + seq.length, strand: 1, identity: 100 })
      continue
    }
    const rcIdx = geneSeq.indexOf(rcSeq)
    if (rcIdx !== -1) {
      hits.push({ gene_id: gene.id, gene_name: gene.gene_name, match_start: rcIdx + 1, match_end: rcIdx + rcSeq.length, strand: -1, identity: 100 })
      continue
    }
    // 模糊匹配（允许1错配）—— 正向 + 反向互补
    let found = false
    for (let i = 0; i <= geneSeq.length - seq.length; i++) {
      const sub = geneSeq.substring(i, i + seq.length)
      let mismatches = 0
      for (let j = 0; j < seq.length; j++) { if (seq[j] !== sub[j]) mismatches++; if (mismatches > 1) break }
      if (mismatches <= 1) {
        hits.push({ gene_id: gene.id, gene_name: gene.gene_name, match_start: i + 1, match_end: i + seq.length, strand: 1, identity: Math.round(((seq.length - mismatches) / seq.length) * 100) })
        found = true; break
      }
    }
    if (!found) {
      for (let i = 0; i <= geneSeq.length - rcSeq.length; i++) {
        const sub = geneSeq.substring(i, i + rcSeq.length)
        let mismatches = 0
        for (let j = 0; j < rcSeq.length; j++) { if (rcSeq[j] !== sub[j]) mismatches++; if (mismatches > 1) break }
        if (mismatches <= 1) {
          hits.push({ gene_id: gene.id, gene_name: gene.gene_name, match_start: i + 1, match_end: i + rcSeq.length, strand: -1, identity: Math.round(((rcSeq.length - mismatches) / rcSeq.length) * 100) })
          break
        }
      }
    }
  }
  if (hits.length > 0) { updatePrimer(primerId, { target_gene_id: hits[0].gene_id, alignment_result: JSON.stringify(hits) }) }
  return hits
}

// ============ 载体序列引物扫描 ============

/** 扫描载体序列，返回所有匹配的通用引物位点 */
export function scanVectorForUniversalPrimers(vectorSeq: string): PrimerSiteInfo[] {
  if (!vectorSeq) return []
  const seq = vectorSeq.toUpperCase().replace(/[^ATGC]/g, '')
  const primers = queryAll<Primer>("SELECT * FROM primers WHERE category = 'universal'")
  const results: PrimerSiteInfo[] = []

  for (const primer of primers) {
    const pSeq = primer.sequence.toUpperCase().replace(/[^ATGC]/g, '')
    if (pSeq.length < 10) continue

    let pos = seq.indexOf(pSeq)
    if (pos >= 0) {
      results.push({
        primer_id: primer.id, primer_name: primer.name, sequence: pSeq,
        position: pos + 1, recog_start: pos + 1, recog_end: pos + pSeq.length, strand: 1
      })
    }

    const rc = reverseComplement(pSeq)
    pos = seq.indexOf(rc)
    if (pos >= 0) {
      results.push({
        primer_id: primer.id, primer_name: primer.name, sequence: pSeq,
        position: pos + 1, recog_start: pos + 1, recog_end: pos + pSeq.length, strand: -1
      })
    }
  }

  return results
}

// ============ XLSX 导入 ============

/** 从 XLSX Buffer 批量导入通用引物（工作表名：引物序列，A列=名称，B列=序列） */
export function importPrimersFromXlsx(buffer: Buffer): number {
  log.info(`Importing primers from XLSX: ${buffer.length} bytes`)
  const XLSX = require('xlsx')
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const ws = wb.Sheets['引物序列']
  if (!ws) return 0
  const data: [string, string][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
  let imported = 0
  runBatch(() => {
    for (const row of data) {
      const name = String(row[0] || '').trim()
      const seq = String(row[1] || '').trim().toUpperCase()
      if (!name || !seq || seq.length < 4) continue
      const existing = queryOne<{ id: number }>("SELECT id FROM primers WHERE name = ? AND category = 'universal'", [name])
      if (existing) continue
      runNoSave(`INSERT INTO primers (name, sequence, category, tm, gc_content, description) VALUES (?, ?, 'universal', ?, ?, '通用引物')`, [name, seq, calcTm(seq), calcGcContent(seq)])
      imported++
    }
  })
  log.info(`Imported ${imported} primers from XLSX`)
  return imported
}

// ============ 种子数据 ============

/** 通用引物种子数据（测序公司常用引物对） */
const UNIVERSAL_PRIMERS: [string, string][] = [
  ['M13F', 'TGTAAAACGACGGCCAGT'], ['M13R', 'CAGGAAACAGCTATGAC'],
  ['M13F-47', 'CGCCAGGGTTTTCCCAGTCACGAC'], ['M13R-48', 'GAGCGGATAACAATTTCACACAGG'],
  ['T7', 'TAATACGACTCACTATAGGG'], ['T7-term', 'GCTAGTTATTGCTCAGCGG'],
  ['SP6', 'ATTTAGGTGACACTATAG'], ['T3', 'ATTAACCCTCACTAAAGG'],
  ['pUC-F', 'GTTTTCCCAGTCACGAC'], ['pUC-R', 'CAGGAAACAGCTATGAC'],
  ['CMV-F', 'CGCAAATGGGCGGTAGGCGTG'], ['BGH-R', 'TAGAAGGCACAGTCGAGG'],
  ['SV40-F', 'GACTCCTTCTGTGGACGTC'], ['SV40-R', 'AGCAATCCATCTTCTTGTGTG'],
  ['RV-M', 'CAGGAAACAGCTATGAC'],
  ['pGEX-F', 'GGGCTGGCAAGCCACGTTTGGTG'], ['pGEX-R', 'CCGGGAATGCCCGAATATCTGGT'],
  ['pET-F', 'TGCTAGTTATTGCTCAGCGG'],
  ['EGFP-F', 'CAAGCTGACCCTGAAGTTC'], ['EGFP-R', 'TACAGCTCGTCCATGCC'],
  ['Flag-F', 'GATTACAAGGATGACGACGATAAG'], ['HA-F', 'TACCCATACGATGTTCCAGATTACGCT'],
  ['Myc-F', 'GAACAAAAACTCATCTCAGAAGAGGATCTG'], ['His-F', 'CACCATCACCATCACCAT'],
  ['27F', 'AGAGTTTGATCCTGGCTCAG'], ['1492R', 'TACGGCTACCTTGTTACGACTT'],
  ['ITS1', 'TCCGTAGGTGAACCTGCGG'], ['ITS4', 'TCCTCCGCTTATTGATATGC'],
  ['U6-F', 'GAGGGCCTATTTCCCATGATTC'], ['EF1a-F', 'CTGAACTTCAAACCTCTG'],
  ['GAPDH-F', 'GAAGGTGAAGGTCGGAGTC'], ['GAPDH-R', 'GAAGATGGTGATGGGATTTC'],
  ['beta-actin-F', 'CATGTACGTTGCTATCCAGGC'], ['beta-actin-R', 'CTCCTTAATGTCACGCACGAT'],
  ['WPRE-R', 'CATAGCGTAAAAGGAGCAACA'], ['EF1a-R', 'GAGCCAGTACACGACATCAC'],
  ['35S-F', 'GACGCACAATCCCACTATCC'], ['NOS-R', 'GATCGCAAGACCGGCAACAG']
]

/** 播种通用引物库（幂等：已存在则跳过） */
export function seedUniversalPrimers(): void {
  const count = queryOne<{ cnt: number }>("SELECT COUNT(*) as cnt FROM primers WHERE category = 'universal'")
  if (count && count.cnt > 0) {
    log.info(`Universal primer seeds skipped: ${count.cnt} primers already exist`)
    return
  }
  runBatch(() => {
    for (const [name, seq] of UNIVERSAL_PRIMERS) {
      runNoSave(`INSERT OR IGNORE INTO primers (name, sequence, category, tm, gc_content, description, source, added_by) VALUES (?, ?, 'universal', ?, ?, '通用引物', '测序公司提供', '擎科生物')`, [name, seq, calcTm(seq), calcGcContent(seq)])
    }
  })
  log.info(`Seeded ${UNIVERSAL_PRIMERS.length} universal primers`)
}
