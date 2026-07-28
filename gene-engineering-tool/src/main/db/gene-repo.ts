/**
 * @module db/gene-repo
 * @description
 * 基因序列 Repository — 提供基因序列的 CRUD 操作、搜索、关系管理、
 * 转录本/外显子/交叉引用管理及应用设置。
 *
 * 架构设计意图：
 * - 封装 gene_sequences / gene_relations / gene_transcripts / gene_exons /
 *   gene_cross_refs / app_settings 表的所有数据库操作
 * - 支持按类型（mrna/cdna/genomic/protein）分类管理和过滤
 * - 关系管理支持双向查询（A→B 和 B→A）
 * - 转录本/外显子支持基因浏览器可视化
 * - 交叉引用支持多数据库关联
 *
 * 依赖关系：
 * - db/base: 底层 SQL 工具
 * - shared/types: GeneSequence, GeneRelation, GeneTranscript, GeneExon, GeneCrossRef 等
 */

import type {
  GeneSequence, GeneRelation, GeneSequenceType,
  GeneTranscript, GeneExon, GeneCrossRef, GeneWithDetails, GeneRelatedSequence
} from '../../shared/types'
import { queryAll, queryOne, run, runNoSave, saveDb, lastInsertId } from './base'

// ============ 基因序列 CRUD ============

/** 获取基因列表（可按类型过滤） */
export function getGenes(type?: GeneSequenceType): GeneSequence[] {
  if (type) {
    return queryAll<GeneSequence>('SELECT * FROM gene_sequences WHERE type = ? ORDER BY gene_name', [type])
  }
  return queryAll<GeneSequence>('SELECT * FROM gene_sequences ORDER BY gene_name')
}

/** 根据 ID 获取单个基因 */
export function getGene(id: number): GeneSequence | undefined {
  return queryOne<GeneSequence>('SELECT * FROM gene_sequences WHERE id = ?', [id])
}

/** 搜索基因（按名称/物种/登录号/描述模糊匹配，可按类型过滤） */
export function searchGenes(query: string, type?: GeneSequenceType): GeneSequence[] {
  const q = `%${query}%`
  if (type) {
    return queryAll<GeneSequence>(
      'SELECT * FROM gene_sequences WHERE (gene_name LIKE ?1 OR species LIKE ?1 OR accession_number LIKE ?1 OR description LIKE ?1 OR gene_symbol LIKE ?1) AND type = ?2 ORDER BY gene_name',
      [q, type]
    )
  }
  return queryAll<GeneSequence>(
    'SELECT * FROM gene_sequences WHERE gene_name LIKE ?1 OR species LIKE ?1 OR accession_number LIKE ?1 OR description LIKE ?1 OR gene_symbol LIKE ?1 ORDER BY gene_name',
    [q]
  )
}

/** 按基因符号搜索（精确+模糊） */
export function searchGenesBySymbol(symbol: string): GeneSequence[] {
  const q = `%${symbol}%`
  return queryAll<GeneSequence>(
    'SELECT * FROM gene_sequences WHERE gene_symbol = ?1 OR gene_symbol LIKE ?2 OR gene_name LIKE ?2 ORDER BY gene_name',
    [symbol, q]
  )
}

/** 按 NCBI Gene ID 查找基因（用于去重/更新） */
export function findGeneByNcbiId(ncbiGeneId: string): GeneSequence | undefined {
  return queryOne<GeneSequence>(
    'SELECT * FROM gene_sequences WHERE ncbi_gene_id = ? LIMIT 1',
    [ncbiGeneId]
  )
}

/** 查找所有同 ncbi_gene_id 的基因（用于清理重复记录） */
export function findAllGenesByNcbiId(ncbiGeneId: string): GeneSequence[] {
  return queryAll<GeneSequence>(
    'SELECT * FROM gene_sequences WHERE ncbi_gene_id = ? ORDER BY id DESC',
    [ncbiGeneId]
  )
}

/** 按基因名称 + 类型查找（用于去重 fallback） */
export function findGeneByNameAndType(geneName: string, type: GeneSequenceType): GeneSequence | undefined {
  return queryOne<GeneSequence>(
    'SELECT * FROM gene_sequences WHERE gene_name = ? AND type = ? LIMIT 1',
    [geneName, type]
  )
}

/** 创建新基因记录（runNoSave + lastInsertId + saveDb 保证 ID 正确） */
export function createGene(data: Omit<GeneSequence, 'id'>): number {
  // 关键：不能直接用 run()，因为 run() 内部先 db.run() 后 saveDb()，
  // saveDb() 的 db.export() 会重置 last_insert_rowid()
  runNoSave(
    `INSERT INTO gene_sequences
      (gene_name, type, species, sequence, accession_number, description,
       features_json, topology, file_path, gene_symbol, chromosome, strand,
       biotype, ncbi_gene_id, genomic_start, genomic_end, summary, ncbi_imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.gene_name, data.type, data.species, data.sequence, data.accession_number, data.description,
      data.features_json || '[]', data.topology || 'linear', data.file_path || '',
      data.gene_symbol || '', data.chromosome || '', data.strand ?? 1,
      data.biotype || '', data.ncbi_gene_id || '', data.genomic_start || 0, data.genomic_end || 0,
      data.summary || '', data.ncbi_imported_at || ''
    ]
  )
  // 在 saveDb() 之前获取 lastInsertId（此时 last_insert_rowid() 未被重置）
  const id = lastInsertId()
  saveDb()
  if (id > 0) return id
  // fallback：通过 ncbi_gene_id 或 gene_name 查找刚插入的记录
  if (data.ncbi_gene_id) {
    const found = findGeneByNcbiId(data.ncbi_gene_id)
    if (found) return found.id
  }
  const found = findGeneByNameAndType(data.gene_name, data.type)
  return found?.id ?? 0
}

/** 更新基因记录（部分更新） */
export function updateGene(id: number, data: Partial<GeneSequence>): void {
  const fields: string[] = []
  const values: unknown[] = []
  const addField = (field: string, value: unknown) => {
    if (value !== undefined) { fields.push(`${field} = ?`); values.push(value) }
  }
  addField('gene_name', data.gene_name)
  addField('type', data.type)
  addField('species', data.species)
  addField('sequence', data.sequence)
  addField('accession_number', data.accession_number)
  addField('description', data.description)
  addField('features_json', data.features_json)
  addField('topology', data.topology)
  addField('file_path', data.file_path)
  addField('gene_symbol', data.gene_symbol)
  addField('chromosome', data.chromosome)
  addField('strand', data.strand)
  addField('biotype', data.biotype)
  addField('ncbi_gene_id', data.ncbi_gene_id)
  addField('genomic_start', data.genomic_start)
  addField('genomic_end', data.genomic_end)
  addField('summary', data.summary)
  addField('ncbi_imported_at', data.ncbi_imported_at)
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE gene_sequences SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 删除基因记录（级联删除关联关系 + 文件目录） */
export function deleteGene(id: number): void {
  // 0. 删除文件目录（在数据库记录删除前获取基因信息）
  try {
    const gene = getGene(id)
    if (gene) {
      const geneFileService = require('../services/gene-file-service')
      const identifier = geneFileService.getGeneIdentifier(gene)
      geneFileService.removeGeneDirectory(identifier, gene.gene_name || identifier)
      geneFileService.regenerateGenesIndex()
    }
  } catch (fileErr: any) {
    console.warn(`[GeneRepo] File cleanup failed: ${fileErr.message}`)
  }
  // 显式级联删除所有子表记录（sql.js WASM 的 ON DELETE CASCADE 不可靠）
  // 1. 删除外显子（通过转录本关联）
  runNoSave('DELETE FROM gene_exons WHERE transcript_id IN (SELECT id FROM gene_transcripts WHERE gene_id = ?)', [id])
  // 2. 删除转录本
  runNoSave('DELETE FROM gene_transcripts WHERE gene_id = ?', [id])
  // 3. 删除交叉引用
  runNoSave('DELETE FROM gene_cross_refs WHERE gene_id = ?', [id])
  // 4. 删除相关序列
  runNoSave('DELETE FROM gene_related_sequences WHERE gene_id = ?', [id])
  // 5. 删除基因关系
  runNoSave('DELETE FROM gene_relations WHERE gene_id = ? OR related_gene_id = ?', [id, id])
  // 6. 将物种插件注释的 gene_id 置为 NULL（保留注释数据，重新导入基因时可自动重新匹配）
  runNoSave('UPDATE species_gene_annotations SET gene_id = NULL WHERE gene_id = ?', [id])
  // 7. 删除基因主记录
  runNoSave('DELETE FROM gene_sequences WHERE id = ?', [id])
  saveDb()
}

// ============ 基因关系管理 ============

/** 获取基因的所有关联关系（双向查询：A→B 和 B→A） */
export function getGeneRelations(geneId: number): GeneRelation[] {
  return queryAll(`
    SELECT gr.*, gs.gene_name as related_name, gs.type as related_type
    FROM gene_relations gr
    JOIN gene_sequences gs ON gr.related_gene_id = gs.id
    WHERE gr.gene_id = ?
    UNION
    SELECT gr.*, gs.gene_name as related_name, gs.type as related_type
    FROM gene_relations gr
    JOIN gene_sequences gs ON gr.gene_id = gs.id
    WHERE gr.related_gene_id = ?
  `, [geneId, geneId]) as any[]
}

/** 添加基因关联关系 */
export function addGeneRelation(geneId: number, relatedGeneId: number, relationType: string): number {
  run(
    'INSERT INTO gene_relations (gene_id, related_gene_id, relation_type) VALUES (?, ?, ?)',
    [geneId, relatedGeneId, relationType]
  )
  return lastInsertId()
}

/** 删除基因关联关系 */
export function removeGeneRelation(id: number): void {
  run('DELETE FROM gene_relations WHERE id = ?', [id])
}

// ============ 基因详情聚合查询 ============

/** 获取基因完整详情（含转录本 + 交叉引用） */
export function getGeneWithDetails(id: number): GeneWithDetails | undefined {
  const gene = getGene(id)
  if (!gene) return undefined
  const transcripts = getGeneTranscripts(id)
  const cross_refs = getGeneCrossRefs(id)
  return { ...gene, transcripts, cross_refs }
}

// ============ 转录本 CRUD ============

/** 获取基因的所有转录本 */
export function getGeneTranscripts(geneId: number): GeneTranscript[] {
  return queryAll<GeneTranscript>(
    'SELECT * FROM gene_transcripts WHERE gene_id = ? ORDER BY is_primary DESC, id',
    [geneId]
  ).map(row => ({ ...row, is_primary: !!row.is_primary }))
}

/** 获取单个转录本 */
export function getGeneTranscript(id: number): GeneTranscript | undefined {
  const row = queryOne<GeneTranscript>('SELECT * FROM gene_transcripts WHERE id = ?', [id])
  return row ? { ...row, is_primary: !!row.is_primary } : undefined
}

/** 按基因ID和转录本accession查找已存在的转录本 */
export function findGeneTranscriptByAccession(geneId: number, transcriptId: string): GeneTranscript | undefined {
  const row = queryOne<GeneTranscript>(
    'SELECT * FROM gene_transcripts WHERE gene_id = ? AND transcript_id = ? LIMIT 1',
    [geneId, transcriptId]
  )
  return row ? { ...row, is_primary: !!row.is_primary } : undefined
}

/** 创建转录本（runNoSave + lastInsertId + saveDb 保证 ID 正确） */
export function createGeneTranscript(data: Omit<GeneTranscript, 'id'>): number {
  runNoSave(
    `INSERT INTO gene_transcripts
      (gene_id, transcript_id, name, is_primary, mrna_sequence, cds_sequence,
       protein_sequence, exon_count, strand, source, cds_start, cds_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.gene_id, data.transcript_id, data.name, data.is_primary ? 1 : 0,
      data.mrna_sequence || '', data.cds_sequence || '',
      data.protein_sequence || '', data.exon_count || 0, data.strand ?? 1,
      data.source || 'manual', data.cds_start || 0, data.cds_end || 0
    ]
  )
  const id = lastInsertId()
  saveDb()
  return id
}

/** 更新转录本 */
export function updateGeneTranscript(id: number, data: Partial<GeneTranscript>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.transcript_id !== undefined) { fields.push('transcript_id = ?'); values.push(data.transcript_id) }
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.is_primary !== undefined) { fields.push('is_primary = ?'); values.push(data.is_primary ? 1 : 0) }
  if (data.mrna_sequence !== undefined) { fields.push('mrna_sequence = ?'); values.push(data.mrna_sequence) }
  if (data.cds_sequence !== undefined) { fields.push('cds_sequence = ?'); values.push(data.cds_sequence) }
  if (data.protein_sequence !== undefined) { fields.push('protein_sequence = ?'); values.push(data.protein_sequence) }
  if (data.exon_count !== undefined) { fields.push('exon_count = ?'); values.push(data.exon_count) }
  if (data.strand !== undefined) { fields.push('strand = ?'); values.push(data.strand) }
  if (data.source !== undefined) { fields.push('source = ?'); values.push(data.source) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE gene_transcripts SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 删除转录本（级联删除外显子） */
export function deleteGeneTranscript(id: number): void {
  // 显式级联删除外显子（sql.js WASM CASCADE 不可靠）
  runNoSave('DELETE FROM gene_exons WHERE transcript_id = ?', [id])
  runNoSave('DELETE FROM gene_transcripts WHERE id = ?', [id])
  saveDb()
}

/** 删除基因的所有转录本（含外显子级联） */
export function deleteGeneTranscriptsByGene(geneId: number): void {
  runNoSave('DELETE FROM gene_exons WHERE transcript_id IN (SELECT id FROM gene_transcripts WHERE gene_id = ?)', [geneId])
  runNoSave('DELETE FROM gene_transcripts WHERE gene_id = ?', [geneId])
  saveDb()
}

// ============ 外显子 CRUD ============

/** 获取转录本的所有外显子 */
export function getGeneExons(transcriptId: number): GeneExon[] {
  return queryAll<GeneExon>(
    'SELECT * FROM gene_exons WHERE transcript_id = ? ORDER BY exon_number',
    [transcriptId]
  )
}

/** 创建外显子 */
export function createGeneExon(data: Omit<GeneExon, 'id'>): number {
  run(
    `INSERT INTO gene_exons (transcript_id, exon_number, start, end, strand, utr_type)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [data.transcript_id, data.exon_number, data.start, data.end, data.strand ?? 1, data.utr_type || null]
  )
  return lastInsertId()
}

/** 批量创建外显子 */
export function createGeneExons(exons: Omit<GeneExon, 'id'>[]): void {
  for (const exon of exons) {
    createGeneExon(exon)
  }
}

/** 删除转录本的所有外显子 */
export function deleteGeneExonsByTranscript(transcriptId: number): void {
  run('DELETE FROM gene_exons WHERE transcript_id = ?', [transcriptId])
}

// ============ 交叉引用 CRUD ============

/** 获取基因的所有交叉引用 */
export function getGeneCrossRefs(geneId: number): GeneCrossRef[] {
  return queryAll<GeneCrossRef>(
    'SELECT * FROM gene_cross_refs WHERE gene_id = ? ORDER BY is_primary DESC, database',
    [geneId]
  ).map(row => ({ ...row, is_primary: !!row.is_primary }))
}

/** 按基因ID + 数据库名 + accession查找已存在的交叉引用 */
export function findGeneCrossRefByAccession(geneId: number, database: string, accession: string): GeneCrossRef | undefined {
  const row = queryOne<GeneCrossRef>(
    'SELECT * FROM gene_cross_refs WHERE gene_id = ? AND database = ? AND accession = ? LIMIT 1',
    [geneId, database, accession]
  )
  return row ? { ...row, is_primary: !!row.is_primary } : undefined
}

/** 创建交叉引用 */
export function createGeneCrossRef(data: Omit<GeneCrossRef, 'id'>): number {
  run(
    `INSERT INTO gene_cross_refs (gene_id, database, accession, url, is_primary)
     VALUES (?, ?, ?, ?, ?)`,
    [data.gene_id, data.database, data.accession, data.url || '', data.is_primary ? 1 : 0]
  )
  return lastInsertId()
}

/** 更新交叉引用 */
export function updateGeneCrossRef(id: number, data: Partial<GeneCrossRef>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.database !== undefined) { fields.push('database = ?'); values.push(data.database) }
  if (data.accession !== undefined) { fields.push('accession = ?'); values.push(data.accession) }
  if (data.url !== undefined) { fields.push('url = ?'); values.push(data.url) }
  if (data.is_primary !== undefined) { fields.push('is_primary = ?'); values.push(data.is_primary ? 1 : 0) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE gene_cross_refs SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 删除交叉引用 */
export function deleteGeneCrossRef(id: number): void {
  run('DELETE FROM gene_cross_refs WHERE id = ?', [id])
}

/** 删除基因的所有交叉引用 */
export function deleteGeneCrossRefsByGene(geneId: number): void {
  run('DELETE FROM gene_cross_refs WHERE gene_id = ?', [geneId])
}

// ============ 应用设置 CRUD ============

/** 获取设置值 */
export function getSetting(key: string): string {
  const row = queryOne<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key])
  return row?.value || ''
}

/** 设置值（INSERT OR REPLACE） */
export function setSetting(key: string, value: string): void {
  run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value])
}

/** 获取所有设置 */
export function getAllSettings(): Record<string, string> {
  const rows = queryAll<{ key: string; value: string }>('SELECT key, value FROM app_settings')
  const result: Record<string, string> = {}
  for (const row of rows) {
    result[row.key] = row.value
  }
  return result
}

// ============ 相关序列 CRUD ============

/** 获取基因的所有相关序列 */
export function getGeneRelatedSequences(geneId: number): GeneRelatedSequence[] {
  return queryAll<GeneRelatedSequence>(
    'SELECT * FROM gene_related_sequences WHERE gene_id = ? ORDER BY seq_type, nucleotide_accession',
    [geneId]
  )
}

/** 按核酸存取号查找已存在的相关序列 */
export function findGeneRelatedSequenceByAccession(geneId: number, accession: string): GeneRelatedSequence | undefined {
  // 同时查找 nucleotide_accession 和 protein_accession
  const row = queryOne<GeneRelatedSequence>(
    'SELECT * FROM gene_related_sequences WHERE gene_id = ? AND (nucleotide_accession = ? OR protein_accession = ?) LIMIT 1',
    [geneId, accession, accession]
  )
  return row
}

/** 创建相关序列 */
export function createGeneRelatedSequence(data: Omit<GeneRelatedSequence, 'id'>): number {
  runNoSave(
    `INSERT INTO gene_related_sequences (gene_id, seq_type, nucleotide_accession, protein_accession, genomic_range, description, ncbi_content, ncbi_imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.gene_id,
      data.seq_type,
      data.nucleotide_accession,
      data.protein_accession || null,
      data.genomic_range || null,
      data.description || '',
      data.ncbi_content || '',
      data.ncbi_imported_at || new Date().toISOString()
    ]
  )
  const id = lastInsertId()
  saveDb()
  return id
}

/** 获取单条相关序列 */
export function getGeneRelatedSequence(id: number): GeneRelatedSequence | undefined {
  return queryOne<GeneRelatedSequence>(
    'SELECT * FROM gene_related_sequences WHERE id = ?',
    [id]
  )
}

/** 更新相关序列的 NCBI 内容缓存 */
export function updateGeneRelatedSequenceContent(id: number, ncbiContent: string): void {
  run('UPDATE gene_related_sequences SET ncbi_content = ? WHERE id = ?', [ncbiContent, id])
}
