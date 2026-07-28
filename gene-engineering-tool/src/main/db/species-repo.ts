/**
 * @module db/species-repo
 * @description
 * 物种基因数据库插�?Repository �?提供物种插件和基因注释的 CRUD 操作�?
 *
 * 核心职责�?
 * 1. 物种插件管理（创建、删除、启�?禁用�?
 * 2. 基因注释数据管理（批量导入、查询、匹配）
 * 3. NCBI Gene ID 与本地基因记录的关联
 *
 * @example
 * import { getSpeciesPlugins, createSpeciesPlugin } from './db/species-repo'
 */

import { queryAll, queryOne, run, runNoSave, saveDb, lastInsertId } from './base'
import type { SpeciesPlugin, SpeciesGeneAnnotation } from '../../shared/types'

// ============ 物种插件 CRUD ============

/** 获取所有物种插�?*/
export function getSpeciesPlugins(): SpeciesPlugin[] {
  const rows = queryAll<SpeciesPlugin & { enabled: number }>(
    'SELECT * FROM species_plugins ORDER BY species_name'
  )
  return rows.map(row => ({
    ...row,
    enabled: !!row.enabled
  }))
}

/** 获取单个物种插件 */
export function getSpeciesPlugin(id: number): SpeciesPlugin | undefined {
  const row = queryOne<SpeciesPlugin & { enabled: number }>(
    'SELECT * FROM species_plugins WHERE id = ?',
    [id]
  )
  return row ? { ...row, enabled: !!row.enabled } : undefined
}

/** 获取所有启用的物种插件 */
export function getEnabledPlugins(): SpeciesPlugin[] {
  const rows = queryAll<SpeciesPlugin & { enabled: number }>(
    'SELECT * FROM species_plugins WHERE enabled = 1 ORDER BY species_name'
  )
  return rows.map(row => ({
    ...row,
    enabled: !!row.enabled
  }))
}

/** 创建物种插件 */
export function createSpeciesPlugin(data: Omit<SpeciesPlugin, 'id'>): number {
  runNoSave(
    `INSERT INTO species_plugins
      (species_name, species_latin, package_name, version, data_file,
       fields_config, url_templates, enabled, installed_at, updated_at, mode, online_sources_config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.species_name,
      data.species_latin || '',
      data.package_name || '',
      data.version || '',
      data.data_file || '',
      data.fields_config || '[]',
      data.url_templates || '{}',
      data.enabled ? 1 : 0,
      data.installed_at || new Date().toISOString(),
      data.updated_at || new Date().toISOString(),
      data.mode || 'offline',
      data.online_sources_config || '{}'
    ]
  )
  const id = lastInsertId()
  saveDb()
  return id
}

/** 删除物种插件（级联删除关联的基因注释�?*/
export function deleteSpeciesPlugin(id: number): void {
  runNoSave('DELETE FROM species_gene_annotations WHERE plugin_id = ?', [id])
  run('DELETE FROM species_plugins WHERE id = ?', [id])
}

/** 切换物种插件启用状�?*/
export function toggleSpeciesPlugin(id: number, enabled: boolean): void {
  run(
    'UPDATE species_plugins SET enabled = ?, updated_at = ? WHERE id = ?',
    [enabled ? 1 : 0, new Date().toISOString(), id]
  )
}

/** 更新物种插件信息 */
export function updateSpeciesPlugin(id: number, data: Partial<SpeciesPlugin>): void {
  const fields: string[] = []
  const values: unknown[] = []

  if (data.species_name !== undefined) {
    fields.push('species_name = ?')
    values.push(data.species_name)
  }
  if (data.species_latin !== undefined) {
    fields.push('species_latin = ?')
    values.push(data.species_latin)
  }
  if (data.version !== undefined) {
    fields.push('version = ?')
    values.push(data.version)
  }
  if (data.data_file !== undefined) {
    fields.push('data_file = ?')
    values.push(data.data_file)
  }
  if (data.fields_config !== undefined) {
    fields.push('fields_config = ?')
    values.push(data.fields_config)
  }
  if (data.url_templates !== undefined) {
    fields.push('url_templates = ?')
    values.push(data.url_templates)
  }
  if (data.enabled !== undefined) {
    fields.push('enabled = ?')
    values.push(data.enabled ? 1 : 0)
  }
  if (data.mode !== undefined) {
    fields.push('mode = ?')
    values.push(data.mode)
  }
  if (data.online_sources_config !== undefined) {
    fields.push('online_sources_config = ?')
    values.push(data.online_sources_config)
  }

  fields.push('updated_at = ?')
  values.push(new Date().toISOString())

  values.push(id)

  run(`UPDATE species_plugins SET ${fields.join(', ')} WHERE id = ?`, values)
}

// ============ 物种基因注释 CRUD ============

/** 获取指定基因的物种注释（按插件分组） */
export function getAnnotationsByGene(geneId: number): SpeciesGeneAnnotation[] {
  return queryAll<SpeciesGeneAnnotation>(
    `SELECT sga.* FROM species_gene_annotations sga
     INNER JOIN species_plugins sp ON sga.plugin_id = sp.id
     WHERE sga.gene_id = ? AND sp.enabled = 1
     ORDER BY sga.source_database, sga.source_accession`,
    [geneId]
  )
}

/** �?NCBI Gene ID 查找物种注释 */
export function getAnnotationsByNcbiId(ncbiGeneId: string, pluginId?: number): SpeciesGeneAnnotation[] {
  // 多格式兼容匹配：纯数字、LOC前缀、带下划线等
  const numericId = ncbiGeneId.replace(/^[^\d]*/, '') // 提取纯数字部分
  const candidates = [ncbiGeneId, numericId, `LOC${numericId}`, `LOC_${numericId}`]
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))]
  
  for (const candidate of uniqueCandidates) {
    const results = pluginId
      ? queryAll<SpeciesGeneAnnotation>('SELECT * FROM species_gene_annotations WHERE ncbi_gene_id = ? AND plugin_id = ?', [candidate, pluginId])
      : queryAll<SpeciesGeneAnnotation>('SELECT * FROM species_gene_annotations WHERE ncbi_gene_id = ?', [candidate])
    if (results.length > 0) return results
  }
  return []
}

/** 批量导入基因注释数据 */
export function batchImportAnnotations(pluginId: number, rows: Array<{
  source_database: string
  source_accession: string
  ncbi_gene_id: string
  gene_symbol: string
  gene_name: string
  annotation_data: string
  external_links: string
}>): number {
  let count = 0

  for (const row of rows) {
    try {
      runNoSave(
        `INSERT INTO species_gene_annotations
          (plugin_id, source_database, source_accession, ncbi_gene_id,
           gene_symbol, gene_name, annotation_data, external_links, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pluginId,
          row.source_database,
          row.source_accession,
          row.ncbi_gene_id || '',
          row.gene_symbol || '',
          row.gene_name || '',
          row.annotation_data || '{}',
          row.external_links || '{}',
          new Date().toISOString()
        ]
      )
      count++
    } catch (err) {
      console.warn(`[SpeciesRepo] Failed to import annotation: ${err}`)
    }
  }

  saveDb()
  return count
}

/** 批量匹配基因注释到本地基因记�?*/
export function matchAnnotationsToGenes(pluginId: number): number {
  // 查找所有未匹配的注�?
  const annotations = queryAll<SpeciesGeneAnnotation>(
    'SELECT * FROM species_gene_annotations WHERE plugin_id = ? AND gene_id IS NULL AND ncbi_gene_id != ""',
    [pluginId]
  )

  let matched = 0

  for (const ann of annotations) {
    // 通过 ncbi_gene_id 查找本地基因记录
    const gene = queryOne<{ id: number }>(
      'SELECT id FROM gene_sequences WHERE ncbi_gene_id = ?',
      [ann.ncbi_gene_id]
    )

    if (gene) {
      run(
        'UPDATE species_gene_annotations SET gene_id = ? WHERE id = ?',
        [gene.id, ann.id]
      )
      matched++
    }
  }

  return matched
}

/** 关联单个基因注释到本地基因记�?*/
export function linkAnnotationToGene(annotationId: number, geneId: number): void {
  run(
    'UPDATE species_gene_annotations SET gene_id = ? WHERE id = ?',
    [geneId, annotationId]
  )
}

/** 获取插件的注释统计信�?*/
export function getPluginAnnotationStats(pluginId: number): {
  total: number
  matched: number
  unmatched: number
} {
  const total = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM species_gene_annotations WHERE plugin_id = ?',
    [pluginId]
  )?.count || 0

  const matched = queryOne<{ count: number }>(
    'SELECT COUNT(*) as count FROM species_gene_annotations WHERE plugin_id = ? AND gene_id IS NOT NULL',
    [pluginId]
  )?.count || 0

  return {
    total,
    matched,
    unmatched: total - matched
  }
}

/** 删除插件的所有注释数�?*/
export function deletePluginAnnotations(pluginId: number): void {
  run('DELETE FROM species_gene_annotations WHERE plugin_id = ?', [pluginId])
}

/** 更新单条注释的 annotation_data 和 gene_symbol */
export function updateAnnotationData(annotationId: number, annotationData: string, geneSymbol?: string): void {
  if (geneSymbol !== undefined) {
    run(
      'UPDATE species_gene_annotations SET annotation_data = ?, gene_symbol = ? WHERE id = ?',
      [annotationData, geneSymbol, annotationId]
    )
  } else {
    run(
      'UPDATE species_gene_annotations SET annotation_data = ? WHERE id = ?',
      [annotationData, annotationId]
    )
  }
}

/** 通过 ID 获取单条注释记录 */
export function getAnnotationById(annotationId: number): SpeciesGeneAnnotation | undefined {
  return queryOne<SpeciesGeneAnnotation>(
    'SELECT * FROM species_gene_annotations WHERE id = ?',
    [annotationId]
  )
}

/** 按存取号或 Ricedata ID 搜索注释记录 */
export function searchAnnotationsByAccession(keyword: string): SpeciesGeneAnnotation[] {
  const kw = keyword.trim()
  if (!kw) return []

  // 第一步：按 source_accession 精确匹配找到初始注释
  let initial = queryAll<SpeciesGeneAnnotation>(
    'SELECT * FROM species_gene_annotations WHERE source_accession = ?', [kw]
  )
  // fallback: 按 annotation_data 中的 ricedata_id 匹配
  if (initial.length === 0) {
    initial = queryAll<SpeciesGeneAnnotation>(
      `SELECT * FROM species_gene_annotations WHERE annotation_data LIKE ?`, [`%"ricedata_id":"${kw}"%`]
    )
  }
  // fallback: 模糊匹配 source_accession
  if (initial.length === 0) {
    return queryAll<SpeciesGeneAnnotation>(
      'SELECT * FROM species_gene_annotations WHERE source_accession LIKE ?', [`%${kw}%`]
    )
  }

  // 第二步：跨数据源关联发现 — 通过 ncbi_gene_id 查找同一基因的所有注释
  const resultMap = new Map<number, SpeciesGeneAnnotation>()
  for (const ann of initial) resultMap.set(ann.id, ann)

  // 收集所有 ncbi_gene_id 和 ricedata_id
  const ncbiIds = new Set<string>()
  const ricedataIds = new Set<string>()
  for (const ann of initial) {
    if (ann.ncbi_gene_id && ann.ncbi_gene_id !== '该基因无NCBI可信ID') {
      ncbiIds.add(ann.ncbi_gene_id)
    }
    try {
      const data = JSON.parse(ann.annotation_data || '{}')
      if (data.ricedata_id) ricedataIds.add(String(data.ricedata_id))
    } catch {}
  }

  // 通过 ncbi_gene_id 查找关联注释
  for (const nid of ncbiIds) {
    const related = getAnnotationsByNcbiId(nid)
    for (const ann of related) resultMap.set(ann.id, ann)
  }

  // 通过 ricedata_id 查找关联注释
  for (const rid of ricedataIds) {
    const related = queryAll<SpeciesGeneAnnotation>(
      `SELECT * FROM species_gene_annotations WHERE annotation_data LIKE ?`, [`%"ricedata_id":"${rid}"%`]
    )
    for (const ann of related) resultMap.set(ann.id, ann)
  }

  return [...resultMap.values()]
}
