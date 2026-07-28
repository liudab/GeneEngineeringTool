/**
 * @module db/component-repo
 * @description
 * 载体元件 Repository — 提供元件的 CRUD、变体管理、去重、合并、批量导入/导出。
 *
 * 架构设计意图：
 * - 封装 vector_components 和 component_variants 两张表的所有数据库操作
 * - 与 component-matching.ts 职责正交：本模块管持久化，matching 管算法
 * - 支持序列变体从表（component_variants）的关联管理
 * - 支持去重（deduplicate）、按相似度合并（mergeBySimilarity）
 * - 支持从 GenBank features 批量导入（含去重+相似变体关联）
 * - 支持 JSON 格式的导入/导出
 *
 * 核心算法：
 * - deduplicateComponents: 按 standard_name(忽略大小写) + sequence 归一化后去重
 * - mergeComponentsBySimilarity: 按名称分组 + DNA 滑动窗口相似度 ≥90% 合并
 * - batchImportComponentsFromFeatures: 名称精确匹配 → 别名匹配 → 序列相似匹配 → INSERT
 *
 * 依赖关系：
 * - db/base: 底层 SQL 工具 + translateDNA + PROTEIN_TYPES + autoTranslate + reverseComplement
 * - shared/types: VectorComponent, ComponentVariant 等类型
 * - file-parser: parseGenBank, parseFasta
 * - tagAutoAnnotator: autoAnnotateTags
 */

import type { VectorComponent, VectorComponentType, ComponentVariant, ComponentSeqType, SimilarVariant, GenBankFeature, ImportPreviewItem, ImportDecision } from '../../shared/types'
import { queryAll, queryOne, run, runNoSave, runBatch, lastInsertId, saveDb, getDb, reverseComplement, translateDNA, PROTEIN_TYPES, autoTranslate } from './base'
import { autoAnnotateTags } from '../tagAutoAnnotator'
import { parseGenBank, parseFasta } from '../file-parser'
import { sixFrameTranslation } from '../componentMatch'
import { readFileSync } from 'fs'
import { createLogger } from '../logger'

const log = createLogger('DB:Component')

// ============ 元件 CRUD ============

/** 获取所有元件（按标准名称排序） */
export function getComponents(): VectorComponent[] {
  return queryAll<VectorComponent>('SELECT * FROM vector_components ORDER BY standard_name')
}

/** 根据 ID 获取单个元件 */
export function getComponent(id: number): VectorComponent | undefined {
  return queryOne<VectorComponent>('SELECT * FROM vector_components WHERE id = ?', [id])
}

/** 搜索元件（按名称/别名/物种/备注等多字段模糊匹配） */
export function searchComponents(query: string): VectorComponent[] {
  const q = `%${query}%`
  return queryAll<VectorComponent>(
    `SELECT * FROM vector_components
     WHERE standard_name LIKE ?1 OR aliases LIKE ?1 OR species LIKE ?1 OR notes LIKE ?1
        OR feature_id LIKE ?1 OR species_latin LIKE ?1 OR species_cn LIKE ?1
        OR product_description LIKE ?1 OR gene LIKE ?1
     ORDER BY standard_name`, [q]
  )
}

/** 创建元件记录（自动翻译蛋白类型序列 + 写入变体从表） */
export function createComponent(data: Partial<VectorComponent> & { sequence: string; standard_name: string }): number {
  const aaSeq = data.amino_acid_sequence || autoTranslate({ type: data.type, sequence: data.sequence })
  const sv = data.similar_variants || '[]'
  const varsJson = data.variants || '[]'
  run(
    `INSERT INTO vector_components (
      sequence, standard_name, aliases, type, species, notes, amino_acid_sequence, similar_variants,
      feature_id, direction, species_short, species_latin, species_cn, taxonomic_category,
      ref_protein_sequence, molecular_weight, dna_variant_count, aa_variant_count,
      product_description, gene, bound_moiety, source_databases, total_occurrences,
      annotation_method, variants
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.sequence, data.standard_name, data.aliases || '[]', data.type || 'other', data.species || '', data.notes || '', aaSeq, sv,
      data.feature_id || '', data.direction || 'none', data.species_short || '', data.species_latin || '',
      data.species_cn || '', data.taxonomic_category || '', data.ref_protein_sequence || '',
      data.molecular_weight || 0, data.dna_variant_count || 0, data.aa_variant_count || 0,
      data.product_description || '', data.gene || '', data.bound_moiety || '',
      data.source_databases || '', data.total_occurrences || 0, data.annotation_method || '', varsJson
    ]
  )
  const id = lastInsertId()
  try {
    const variants = JSON.parse(varsJson) as ComponentVariant[]
    if (Array.isArray(variants) && variants.length > 0) {
      runBatch(() => {
        for (const v of variants) {
          runNoSave(
            'INSERT INTO component_variants (component_id, variant_id, seq_type, sequence, length, is_reference, sources) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, v.variant_id, v.seq_type, v.sequence, v.length, v.is_reference ? 1 : 0, v.sources || '']
          )
        }
      })
    }
  } catch (_e) { /* ignore */ }
  return id
}

/** 更新元件记录（部分更新，含自动翻译和变体从表同步） */
export function updateComponent(id: number, data: Partial<VectorComponent>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.sequence !== undefined) { fields.push('sequence = ?'); values.push(data.sequence) }
  if (data.standard_name !== undefined) { fields.push('standard_name = ?'); values.push(data.standard_name) }
  if (data.aliases !== undefined) { fields.push('aliases = ?'); values.push(data.aliases) }
  if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type) }
  if (data.species !== undefined) { fields.push('species = ?'); values.push(data.species) }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }
  if (data.similar_variants !== undefined) { fields.push('similar_variants = ?'); values.push(data.similar_variants) }
  const metaFields: [keyof VectorComponent, string][] = [
    ['feature_id', 'feature_id'], ['direction', 'direction'], ['species_short', 'species_short'],
    ['species_latin', 'species_latin'], ['species_cn', 'species_cn'], ['taxonomic_category', 'taxonomic_category'],
    ['ref_protein_sequence', 'ref_protein_sequence'], ['molecular_weight', 'molecular_weight'],
    ['dna_variant_count', 'dna_variant_count'], ['aa_variant_count', 'aa_variant_count'],
    ['product_description', 'product_description'], ['gene', 'gene'], ['bound_moiety', 'bound_moiety'],
    ['source_databases', 'source_databases'], ['total_occurrences', 'total_occurrences'],
    ['annotation_method', 'annotation_method'], ['variants', 'variants']
  ]
  for (const [key, col] of metaFields) {
    if (data[key] !== undefined) { fields.push(`${col} = ?`); values.push(data[key]) }
  }
  if (data.amino_acid_sequence !== undefined) {
    fields.push('amino_acid_sequence = ?')
    values.push(data.amino_acid_sequence)
  } else if (data.sequence !== undefined || data.type !== undefined) {
    const existing = getComponent(id)
    const mergedType = data.type || existing?.type
    const mergedSeq = data.sequence || existing?.sequence
    const aa = autoTranslate({ type: mergedType, sequence: mergedSeq })
    fields.push('amino_acid_sequence = ?')
    values.push(aa)
  }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE vector_components SET ${fields.join(', ')} WHERE id = ?`, values)
  if (data.variants !== undefined) {
    try {
      const variants = JSON.parse(data.variants) as ComponentVariant[]
      if (Array.isArray(variants) && variants.length > 0) {
        runBatch(() => {
          runNoSave('DELETE FROM component_variants WHERE component_id = ?', [id])
          for (const v of variants) {
            runNoSave(
              'INSERT INTO component_variants (component_id, variant_id, seq_type, sequence, length, is_reference, sources) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [id, v.variant_id, v.seq_type, v.sequence, v.length, v.is_reference ? 1 : 0, v.sources || '']
            )
          }
        })
      } else {
        run('DELETE FROM component_variants WHERE component_id = ?', [id])
      }
    } catch (_e) { /* ignore */ }
  }
}

/** 删除元件记录 */
export function deleteComponent(id: number): void {
  run('DELETE FROM vector_components WHERE id = ?', [id])
}

/** 批量删除元件 */
export function deleteComponents(ids: number[]): { deleted: number; failed: number } {
  if (!ids || ids.length === 0) return { deleted: 0, failed: 0 }
  let deleted = 0
  let failed = 0
  runBatch(() => {
    for (const id of ids) {
      try {
        runNoSave('DELETE FROM vector_components WHERE id = ?', [id])
        deleted++
      } catch (_e) {
        failed++
      }
    }
  })
  return { deleted, failed }
}

// ============ 变体管理 ============

/** 获取某个元件的所有序列变体 */
export function getComponentVariants(componentId: number): ComponentVariant[] {
  return queryAll<ComponentVariant>(
    'SELECT * FROM component_variants WHERE component_id = ? ORDER BY seq_type, variant_id',
    [componentId]
  )
}

/** 按序列查找元件变体（用于去重） */
export function findComponentVariant(seqType: ComponentSeqType, sequence: string): ComponentVariant | undefined {
  return queryOne<ComponentVariant>(
    'SELECT * FROM component_variants WHERE seq_type = ? AND sequence = ?',
    [seqType, sequence.toUpperCase().replace(/[^ATGC]/g, '')]
  )
}

/** 设置元件的变体列表（覆盖写入） */
export function setComponentVariants(componentId: number, variants: ComponentVariant[]): void {
  runBatch(() => {
    runNoSave('DELETE FROM component_variants WHERE component_id = ?', [componentId])
    for (const v of variants) {
      runNoSave(
        'INSERT INTO component_variants (component_id, variant_id, seq_type, sequence, length, is_reference, sources) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [componentId, v.variant_id, v.seq_type, v.sequence, v.length, v.is_reference ? 1 : 0, v.sources || '']
      )
    }
  })
}

// ============ 去重与合并 ============

/** 元件去重：按标准名称+序列归一化后去重，保留创建最早记录，合并相似变体 */
export function deduplicateComponents(): { deleted: number; merged: number } {
  const rows = queryAll<VectorComponent>('SELECT * FROM vector_components ORDER BY id')
  const groups = new Map<string, VectorComponent[]>()
  for (const c of rows) {
    const key = `${(c.standard_name || '').toLowerCase().trim()}|${(c.sequence || '').toUpperCase().replace(/[^ATGC]/g, '')}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }

  let deleted = 0
  let merged = 0

  runBatch(() => {
    for (const [, group] of groups) {
      if (group.length <= 1) continue
      const keeper = group.sort((a, b) => a.id - b.id)[0]
      const dupes = group.filter(c => c.id !== keeper.id)

      let keeperVariants: SimilarVariant[] = []
      try { keeperVariants = JSON.parse(keeper.similar_variants || '[]') } catch { keeperVariants = [] }
      for (const d of dupes) {
        try {
          const dVars: SimilarVariant[] = JSON.parse(d.similar_variants || '[]')
          for (const v of dVars) {
            if (!keeperVariants.some(kv => kv.name === v.name && kv.source_vector === v.source_vector)) {
              keeperVariants.push(v)
            }
          }
        } catch { /* ignore */ }
      }
      if (keeperVariants.length > 0) {
        runNoSave('UPDATE vector_components SET similar_variants = ? WHERE id = ?', [JSON.stringify(keeperVariants), keeper.id])
        merged += keeperVariants.length
      }

      for (const d of dupes) {
        runNoSave('DELETE FROM vector_components WHERE id = ?', [d.id])
        deleted++
      }
    }
  })

  return { deleted, merged }
}

/** 计算两条 DNA 序列的相似度（滑动窗口，返回最大匹配比例） */
function computeDnaSimilarity(seq1: string, seq2: string): number {
  if (!seq1 || !seq2) return 0
  const s1 = seq1.toUpperCase().replace(/[^ATGC]/g, '')
  const s2 = seq2.toUpperCase().replace(/[^ATGC]/g, '')
  if (s1.length === 0 || s2.length === 0) return 0
  const [shorter, longer] = s1.length <= s2.length ? [s1, s2] : [s2, s1]
  const sLen = shorter.length
  const lLen = longer.length
  let best = 0
  for (let i = 0; i <= lLen - sLen; i++) {
    let matches = 0
    for (let j = 0; j < sLen; j++) {
      if (shorter[j] === longer[i + j]) matches++
    }
    const ratio = matches / sLen
    if (ratio > best) best = ratio
  }
  return best
}

/** 对选中的元件按标准名称 + DNA 序列相似度合并相似变体 */
export function mergeComponentsBySimilarity(ids: number[]): { kept: number; deleted: number; merged: number } {
  if (!ids || ids.length === 0) return { kept: 0, deleted: 0, merged: 0 }
  const rows = queryAll<VectorComponent>('SELECT * FROM vector_components WHERE id IN (' + ids.map(() => '?').join(',') + ')', [...ids])

  const groups = new Map<string, VectorComponent[]>()
  for (const c of rows) {
    const key = (c.standard_name || '').toLowerCase().trim()
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }

  let kept = 0
  let deleted = 0
  let merged = 0

  runBatch(() => {
    for (const [, group] of groups) {
      if (group.length <= 1) { kept++; continue }
      const sorted = group.sort((a, b) => a.id - b.id)
      const keeper = sorted[0]
      const dupes = sorted.slice(1)

      let keeperVariants: SimilarVariant[] = []
      try { keeperVariants = JSON.parse(keeper.similar_variants || '[]') } catch { keeperVariants = [] }

      for (const d of dupes) {
        const seq1 = (keeper.sequence || '').toUpperCase().replace(/[^ATGC]/g, '')
        const seq2 = (d.sequence || '').toUpperCase().replace(/[^ATGC]/g, '')
        const sim = computeDnaSimilarity(seq1, seq2)
        if (sim < 0.9) { kept++; continue }

        let dVars: SimilarVariant[] = []
        try { dVars = JSON.parse(d.similar_variants || '[]') } catch { dVars = [] }
        for (const v of dVars) {
          if (!keeperVariants.some(kv => kv.name === v.name && kv.source_vector === v.source_vector)) {
            keeperVariants.push(v)
            merged++
          }
        }

        runNoSave('DELETE FROM vector_components WHERE id = ?', [d.id])
        deleted++
      }

      if (keeperVariants.length > 0) {
        runNoSave('UPDATE vector_components SET similar_variants = ? WHERE id = ?', [JSON.stringify(keeperVariants), keeper.id])
      }
      kept++
    }
  })

  return { kept, deleted, merged }
}

// ============ 辅助查询 ============

/** 获取所有已存在的非空物种名称（去重） */
export function getComponentSpeciesList(): string[] {
  const rows = queryAll<{ species: string }>(
    "SELECT DISTINCT species FROM vector_components WHERE species != '' ORDER BY species"
  )
  return rows.map(r => r.species)
}

/** 回填物种：从载体 source feature + 基因库匹配序列补充空物种元件 */
export function backfillComponentSpecies(): number {
  const emptySpeciesRows = getDb().exec(
    "SELECT id, sequence FROM vector_components WHERE species = '' OR species IS NULL"
  )
  if (emptySpeciesRows.length === 0 || emptySpeciesRows[0].values.length === 0) return 0
  const emptyComponents = emptySpeciesRows[0].values.map((row: any[]) => ({
    id: Number(row[0]),
    seq: String(row[1] || '').toUpperCase(),
    rc: reverseComplement(String(row[1] || '')).toUpperCase()
  }))

  let updated = 0
  const updatedIds = new Set<number>()
  const speciesUpdates: Array<{ id: number; species: string }> = []

  // 第一轮：从载体的 source feature 匹配
  const vectors = queryAll<{ id: number; sequence: string; features_json: string }>(
    "SELECT id, sequence, features_json FROM vectors WHERE features_json != '' AND features_json != '[]'"
  )
  for (const vec of vectors) {
    const vecSeq = (vec.sequence || '').toUpperCase().replace(/[^ATGC]/g, '')
    if (!vecSeq) continue
    let features: GenBankFeature[] = []
    try { features = JSON.parse(vec.features_json || '[]') } catch { continue }
    const organism = features
      .filter(f => f.type === 'source')
      .map(f => f.qualifiers?.organism || '')
      .find(s => s)
    if (!organism) continue
    for (const comp of emptyComponents) {
      if (!comp.seq || comp.seq.length < 10 || updatedIds.has(comp.id)) continue
      if (vecSeq.includes(comp.seq) || vecSeq.includes(comp.rc)) {
        speciesUpdates.push({ id: comp.id, species: organism })
        updatedIds.add(comp.id)
        updated++
      }
    }
  }

  // 第二轮：从基因库 gene_sequences 匹配
  const genes = queryAll<{ id: number; species: string; sequence: string }>(
    "SELECT id, species, sequence FROM gene_sequences WHERE species != '' AND species IS NOT NULL AND sequence != ''"
  )
  for (const gene of genes) {
    const geneSeq = (gene.sequence || '').toUpperCase().replace(/[^ATGC]/g, '')
    if (geneSeq.length < 10) continue
    const geneRc = reverseComplement(geneSeq).toUpperCase()
    for (const comp of emptyComponents) {
      if (!comp.seq || comp.seq.length < 10 || updatedIds.has(comp.id)) continue
      if (geneSeq.includes(comp.seq) || geneSeq.includes(comp.rc) ||
          comp.seq.includes(geneSeq) || comp.rc.includes(geneSeq) ||
          geneRc.includes(comp.seq) || geneRc.includes(comp.rc)) {
        speciesUpdates.push({ id: comp.id, species: gene.species })
        updatedIds.add(comp.id)
        updated++
      }
    }
  }

  if (speciesUpdates.length > 0) {
    runBatch(() => {
      for (const u of speciesUpdates) {
        runNoSave('UPDATE vector_components SET species = ? WHERE id = ?', [u.species, u.id])
      }
    })
  }
  return updated
}

/** 规范化同步：将规范化结果同步到元件数据库 */
export function syncNormalizationToDb(
  matches: Array<{
    component_id: number; standard_name: string; component_type: VectorComponentType;
    match_start: number; match_end: number; strand: 1 | -1; current_name: string
  }>,
  vectorSeq: string,
  features: GenBankFeature[],
  sourceOrganism?: string
): { updated: number; created: number } {
  if (!matches || matches.length === 0) return { updated: 0, created: 0 }
  const seq = (vectorSeq || '').toUpperCase().replace(/[^ATGC]/g, '')
  if (!seq) return { updated: 0, created: 0 }

  let updated = 0
  const pendingUpdates: Array<{ id: number; fields: string[]; values: unknown[] }> = []

  for (const m of matches) {
    const existing = getComponent(m.component_id)
    if (existing) {
      const fields: string[] = []
      const values: unknown[] = []
      if (existing.standard_name !== m.standard_name) {
        fields.push('standard_name = ?')
        values.push(m.standard_name)
      }
      if (!existing.species && sourceOrganism) {
        fields.push('species = ?')
        values.push(sourceOrganism)
      }
      if (fields.length > 0) {
        values.push(m.component_id)
        pendingUpdates.push({ id: m.component_id, fields, values })
        updated++
      }
    }
  }

  if (pendingUpdates.length > 0) {
    runBatch(() => {
      for (const u of pendingUpdates) {
        runNoSave(`UPDATE vector_components SET ${u.fields.join(', ')} WHERE id = ?`, u.values)
      }
    })
  }

  return { updated, created: 0 }
}

// ============ 批量导入 ============

/** 从载体 features 批量导入元件到数据库（含去重 + 相似变体关联） */
export function batchImportComponentsFromFeatures(
  features: GenBankFeature[],
  vectorSeq: string,
  sourceVectorName?: string
): { imported: number; skipped: number; linked: number; speciesFilled: number } {
  if (!features || features.length === 0) return { imported: 0, skipped: 0, linked: 0, speciesFilled: 0 }
  const seq = (vectorSeq || '').toUpperCase().replace(/[^ATGC]/g, '')
  const srcName = sourceVectorName || '未命名载体'

  const defaultSpecies = features
    .filter(f => f.type === 'source')
    .map(f => f.qualifiers?.organism || '')
    .find(s => s) || ''

  const existingRes = getDb().exec(
    'SELECT id, sequence, standard_name, aliases, similar_variants, species FROM vector_components'
  )
  const existingRows = existingRes.length > 0 ? existingRes[0].values : []
  const existingNames = new Set<string>()
  const existingAliases = new Set<string>()
  const nameToId = new Map<string, number>()
  const aliasToId = new Map<string, number>()
  const existingSeqs: Array<{ id: number; seq: string; rc: string; name: string; variants: SimilarVariant[]; species: string }> = []

  for (const row of existingRows) {
    const id = Number(row[0])
    const sName = String(row[2] || '').toLowerCase()
    existingNames.add(sName)
    nameToId.set(sName, id)
    try {
      const arr: string[] = JSON.parse(String(row[3] || '[]'))
      arr.forEach(a => { existingAliases.add(a.toLowerCase()); aliasToId.set(a.toLowerCase(), id) })
    } catch { /* ignore */ }
    let variants: SimilarVariant[] = []
    try { variants = JSON.parse(String(row[4] || '[]')) } catch { /* ignore */ }
    existingSeqs.push({
      id,
      seq: String(row[1] || '').toUpperCase(),
      rc: reverseComplement(String(row[1] || '')).toUpperCase(),
      name: String(row[2] || ''),
      variants,
      species: String(row[5] || '')
    })
  }

  let imported = 0
  let skipped = 0
  let linked = 0
  let speciesFilled = 0
  const speciesUpdatedIds = new Set<number>()
  const pendingSpeciesUpdates: Array<{ id: number; species: string }> = []
  const pendingVariantUpdates: Array<{ id: number; variants: string }> = []
  const pendingInserts: Array<Partial<VectorComponent> & { sequence: string; standard_name: string }> = []

  function tryFillSpecies(compId: number, featureOrganism: string) {
    const sp = featureOrganism || defaultSpecies
    if (!sp || speciesUpdatedIds.has(compId)) return
    const existing = existingSeqs.find(e => e.id === compId)
    if (existing && !existing.species) {
      pendingSpeciesUpdates.push({ id: compId, species: sp })
      existing.species = sp
      speciesUpdatedIds.add(compId)
      speciesFilled++
    }
  }
  const typeMap: Record<string, VectorComponentType> = {
    gene: 'CDS', CDS: 'CDS', mRNA: 'CDS',
    promoter: 'promoter', rep_origin: 'origin',
    terminator: 'terminator', enhancer: 'enhancer',
    misc_feature: 'other', primer_bind: 'other'
  }

  function findSeqMatch(newSeq: string, existingList: typeof existingSeqs): { idx: number; identity: number } | null {
    const qLen = newSeq.length
    let bestIdx = -1
    let bestIdentity = 0

    // --- DNA-DNA 比对（正向 + 反向互补） ---
    for (let ei = 0; ei < existingList.length; ei++) {
      const { seq: dbSeq, rc: dbRc } = existingList[ei]
      for (const target of [dbSeq, dbRc]) {
        const tLen = target.length
        if (tLen === 0 || qLen === 0) continue
        const maxLen = Math.max(qLen, tLen)
        if (Math.abs(qLen - tLen) / maxLen > 0.2) continue
        const [shorter, longer] = qLen <= tLen ? [newSeq, target] : [target, newSeq]
        const sLen = shorter.length
        const lLen = longer.length
        for (let i = 0; i <= lLen - sLen; i++) {
          let matches = 0
          for (let j = 0; j < sLen; j++) {
            if (shorter[j] === longer[i + j]) matches++
          }
          const ratio = matches / sLen
          if (ratio >= 0.9 && ratio > bestIdentity) {
            bestIdentity = ratio
            bestIdx = ei
          }
        }
      }
    }
    if (bestIdx >= 0) return { idx: bestIdx, identity: bestIdentity }

    // --- 蛋白级比对（六框翻译）：处理密码子简并性导致的 DNA 差异 ---
    const queryFrames = sixFrameTranslation(newSeq)
    for (let ei = 0; ei < existingList.length; ei++) {
      const { seq: dbSeq, rc: dbRc } = existingList[ei]
      if (!dbSeq || dbSeq.length < 30) continue
      const dbFrames = sixFrameTranslation(dbSeq)
      let bestAaIdentity = 0
      for (const qFrame of queryFrames) {
        if (!qFrame || qFrame.length < 10) continue
        for (const tFrame of dbFrames) {
          if (!tFrame || tFrame.length < 10) continue
          const [shorter, longer] = qFrame.length <= tFrame.length
            ? [qFrame, tFrame] : [tFrame, qFrame]
          const sLen = shorter.length
          const lLen = longer.length
          if (Math.abs(lLen - sLen) / Math.max(sLen, 1) > 0.3) continue
          for (let i = 0; i <= lLen - sLen; i++) {
            let matches = 0
            for (let j = 0; j < sLen; j++) {
              if (shorter[j] === longer[i + j]) matches++
            }
            const ratio = matches / sLen
            if (ratio > bestAaIdentity) bestAaIdentity = ratio
          }
        }
      }
      if (bestAaIdentity >= 0.8 && bestAaIdentity > bestIdentity) {
        bestIdentity = bestAaIdentity
        bestIdx = ei
      }
    }
    if (bestIdx >= 0) return { idx: bestIdx, identity: bestIdentity }
    return null
  }

  for (const f of features) {
    const fStart = f.start
    const fEnd = f.end
    if (fStart < 0 || fEnd > seq.length || fStart >= fEnd) continue
    const fSeq = seq.substring(fStart, fEnd)
    if (fSeq.length < 10) continue
    const name = f.qualifiers?.label || f.qualifiers?.gene || f.qualifiers?.product || f.type || 'unknown'
    const nameLower = name.toLowerCase()

    if (existingNames.has(nameLower)) {
      const compId = nameToId.get(nameLower)
      if (compId !== undefined) tryFillSpecies(compId, f.qualifiers?.organism || '')
      // 名称匹配时仍尝试序列级变体关联（防止因 DNA 差异跳过同源元件）
      const seqMatch = findSeqMatch(fSeq, existingSeqs)
      if (seqMatch) {
        const matched = existingSeqs[seqMatch.idx]
        const maxLen = Math.max(fSeq.length, matched.seq.length)
        const lengthDiffPct = maxLen > 0 ? (Math.abs(fSeq.length - matched.seq.length) / maxLen) * 100 : 0
        const variant: SimilarVariant = {
          name, identity: Math.round(seqMatch.identity * 1000) / 10,
          length_new: fSeq.length, length_existing: matched.seq.length,
          length_diff_pct: Math.round(lengthDiffPct * 10) / 10,
          source_vector: srcName,
          detected_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
        }
        const alreadyLinked = matched.variants.some(
          v => v.name === variant.name && v.source_vector === variant.source_vector
        )
        if (!alreadyLinked) {
          matched.variants.push(variant)
          pendingVariantUpdates.push({ id: matched.id, variants: JSON.stringify(matched.variants) })
          linked++
        }
      }
      skipped++; continue
    }

    if (existingAliases.has(nameLower)) {
      const compId = aliasToId.get(nameLower)
      if (compId !== undefined) tryFillSpecies(compId, f.qualifiers?.organism || '')
      skipped++; continue
    }

    const seqMatch = findSeqMatch(fSeq, existingSeqs)
    if (seqMatch) {
      const matched = existingSeqs[seqMatch.idx]
      tryFillSpecies(matched.id, f.qualifiers?.organism || '')
      const maxLen = Math.max(fSeq.length, matched.seq.length)
      const lengthDiffPct = maxLen > 0 ? (Math.abs(fSeq.length - matched.seq.length) / maxLen) * 100 : 0

      const variant: SimilarVariant = {
        name,
        identity: Math.round(seqMatch.identity * 1000) / 10,
        length_new: fSeq.length,
        length_existing: matched.seq.length,
        length_diff_pct: Math.round(lengthDiffPct * 10) / 10,
        source_vector: srcName,
        detected_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
      }

      const alreadyLinked = matched.variants.some(
        v => v.name === variant.name && v.source_vector === variant.source_vector
      )
      if (!alreadyLinked) {
        matched.variants.push(variant)
        pendingVariantUpdates.push({ id: matched.id, variants: JSON.stringify(matched.variants) })
        linked++
      }
      skipped++
      continue
    }

    const compType = typeMap[f.type] || 'other'
    const aaSeq = PROTEIN_TYPES.has(compType) ? translateDNA(fSeq) : ''
    pendingInserts.push({
      sequence: fSeq,
      standard_name: name,
      aliases: JSON.stringify([]),
      type: compType,
      species: f.qualifiers?.organism || defaultSpecies,
      notes: `从载体 feature 导入: ${f.type}`,
      amino_acid_sequence: aaSeq
    })
    existingNames.add(nameLower)
    existingSeqs.push({
      id: 0,
      seq: fSeq,
      rc: reverseComplement(fSeq),
      name,
      variants: [],
      species: f.qualifiers?.organism || defaultSpecies
    })
    imported++
  }

  runBatch(() => {
    for (const u of pendingSpeciesUpdates) {
      runNoSave('UPDATE vector_components SET species = ? WHERE id = ?', [u.species, u.id])
    }
    for (const u of pendingVariantUpdates) {
      runNoSave('UPDATE vector_components SET similar_variants = ? WHERE id = ?', [u.variants, u.id])
    }
    let insertBaseIdx = existingSeqs.length - pendingInserts.length
    for (let i = 0; i < pendingInserts.length; i++) {
      const item = pendingInserts[i]
      const sv = '[]'
      const varsJson = '[]'
      runNoSave(
        `INSERT INTO vector_components (
          sequence, standard_name, aliases, type, species, notes, amino_acid_sequence, similar_variants,
          feature_id, direction, species_short, species_latin, species_cn, taxonomic_category,
          ref_protein_sequence, molecular_weight, dna_variant_count, aa_variant_count,
          product_description, gene, bound_moiety, source_databases, total_occurrences,
          annotation_method, variants
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.sequence, item.standard_name, item.aliases || '[]', item.type || 'other', item.species || '', item.notes || '', item.amino_acid_sequence || '', sv,
          item.feature_id || '', item.direction || 'none', item.species_short || '', item.species_latin || '',
          item.species_cn || '', item.taxonomic_category || '', item.ref_protein_sequence || '',
          item.molecular_weight || 0, item.dna_variant_count || 0, item.aa_variant_count || 0,
          item.product_description || '', item.gene || '', item.bound_moiety || '',
          item.source_databases || '', item.total_occurrences || 0, item.annotation_method || '', varsJson
        ]
      )
      const newId = lastInsertId()
      const seqIdx = insertBaseIdx + i
      if (seqIdx >= 0 && seqIdx < existingSeqs.length) {
        existingSeqs[seqIdx].id = newId
      }
    }
  })

  return { imported, skipped, linked, speciesFilled }
}

/** 从 GenBank/FASTA 文件批量导入元件 */
export function importComponentsFromFiles(
  filePaths: string[],
  sourceVectorName?: string
): { imported: number; skipped: number; linked: number; speciesFilled: number; failed: number } {
  let imported = 0
  let skipped = 0
  let linked = 0
  let speciesFilled = 0
  let failed = 0

  for (const filePath of filePaths) {
    try {
      const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'))
      if (['.gb', '.gbk', '.genbank'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const record = parseGenBank(content)
        const result = batchImportComponentsFromFeatures(record.features || [], record.sequence || '', sourceVectorName || record.name)
        imported += result.imported
        skipped += result.skipped
        linked += result.linked
        speciesFilled += result.speciesFilled
      } else if (['.fasta', '.fa', '.fna'].includes(ext)) {
        const content = readFileSync(filePath, 'utf-8')
        const records = parseFasta(content)
        for (const rec of records) {
          const seq = (rec.sequence || '').toUpperCase().replace(/[^ATGC]/g, '')
          if (seq.length < 10) { skipped++; continue }
          const type = 'other'
          const aaSeq = PROTEIN_TYPES.has(type) ? translateDNA(seq) : ''
          const name = rec.id || 'unknown'
          createComponent({
            sequence: seq,
            standard_name: name,
            aliases: JSON.stringify([]),
            type,
            species: '',
            notes: rec.description ? `从 FASTA 导入: ${rec.description}` : '从 FASTA 导入',
            amino_acid_sequence: aaSeq
          })
          imported++
        }
      } else {
        failed++
      }
    } catch (_e) {
      failed++
    }
  }

  return { imported, skipped, linked, speciesFilled, failed }
}

// ============ JSON 导出/导入 ============

/** 导出所有元件为 JSON 对象 */
export function exportComponentsToJson(): { version: number; exported_at: string; count: number; components: VectorComponent[] } {
  const all = queryAll<VectorComponent>('SELECT * FROM vector_components ORDER BY id')
  return {
    version: 2,
    exported_at: new Date().toISOString(),
    count: all.length,
    components: all
  }
}

/** 从 JSON 对象导入元件（跳过已存在的同名称+同序列记录） */
export function importComponentsFromJson(data: {
  version: number
  components: VectorComponent[]
}): { imported: number; skipped: number; failed: number } {
  if (!data || !Array.isArray(data.components)) {
    return { imported: 0, skipped: 0, failed: 0 }
  }

  const existingRes = getDb().exec('SELECT standard_name, sequence FROM vector_components')
  const existingKeys = new Set<string>()
  if (existingRes.length > 0) {
    for (const row of existingRes[0].values) {
      existingKeys.add(`${String(row[0] || '').toLowerCase()}|${String(row[1] || '')}`)
    }
  }

  let imported = 0
  let skipped = 0
  let failed = 0

  for (const comp of data.components) {
    try {
      if (!comp.standard_name || !comp.sequence) { failed++; continue }
      const key = `${comp.standard_name.toLowerCase()}|${comp.sequence}`
      if (existingKeys.has(key)) { skipped++; continue }

      run(
        `INSERT INTO vector_components (
          sequence, standard_name, aliases, type, species, notes, amino_acid_sequence, similar_variants,
          feature_id, direction, species_short, species_latin, species_cn, taxonomic_category,
          ref_protein_sequence, molecular_weight, dna_variant_count, aa_variant_count,
          product_description, gene, bound_moiety, source_databases, total_occurrences,
          annotation_method, variants, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          comp.sequence, comp.standard_name, comp.aliases || '[]', comp.type || 'other',
          comp.species || '', comp.notes || '', comp.amino_acid_sequence || '',
          comp.similar_variants || '[]',
          comp.feature_id || '', comp.direction || 'none',
          comp.species_short || '', comp.species_latin || '',
          comp.species_cn || '', comp.taxonomic_category || '',
          comp.ref_protein_sequence || '', comp.molecular_weight || 0,
          comp.dna_variant_count || 0, comp.aa_variant_count || 0,
          comp.product_description || '', comp.gene || '',
          comp.bound_moiety || '', comp.source_databases || '',
          comp.total_occurrences || 0, comp.annotation_method || '',
          comp.variants || '[]',
          comp.tags || '[]'
        ]
      )
      const id = lastInsertId()

      if (!comp.tags || comp.tags === '[]') {
        const autoTags = autoAnnotateTags(comp.standard_name || '', comp.notes || '', comp.aliases || '[]')
        if (autoTags.length > 0) {
          runNoSave("UPDATE vector_components SET tags = ? WHERE id = ?", [JSON.stringify(autoTags), id])
        }
      }

      try {
        const variants = JSON.parse(comp.variants || '[]') as ComponentVariant[]
        if (Array.isArray(variants) && variants.length > 0) {
          runBatch(() => {
            for (const v of variants) {
              runNoSave(
                'INSERT INTO component_variants (component_id, variant_id, seq_type, sequence, length, is_reference, sources) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, v.variant_id, v.seq_type, v.sequence, v.length, v.is_reference ? 1 : 0, v.sources || '']
              )
            }
          })
        }
      } catch { /* 变体解析失败不影响主记录 */ }

      existingKeys.add(key)
      imported++
    } catch {
      failed++
    }
  }

  saveDb()
  log.info(`[ImportJSON] imported=${imported}, skipped=${skipped}, failed=${failed}`)
  return { imported, skipped, failed }
}

// ============ 自动标签标注 ============

/** 对所有元件执行自动标签标注，返回更新的元件数 */
export function autoAnnotateAllComponents(): number {
  const components = queryAll<{ id: number; standard_name: string; notes: string; aliases: string }>(
    "SELECT id, standard_name, notes, aliases FROM vector_components"
  )
  let updated = 0
  runBatch(() => {
    for (const comp of components) {
      const tags = autoAnnotateTags(comp.standard_name || '', comp.notes || '', comp.aliases || '[]')
      if (tags.length > 0) {
        runNoSave("UPDATE vector_components SET tags = ? WHERE id = ?", [JSON.stringify(tags), comp.id])
        updated++
      }
    }
  })
  return updated
}

/** 启动时执行一次性标签标注（通过 seed_metadata 版本控制） */
export function runTagsAutoAnnotation(): void {
  const meta = queryOne<{ value: string }>("SELECT value FROM seed_metadata WHERE key = 'tags_version'")
  const currentVersion = meta ? parseInt(meta.value, 10) : 0
  if (currentVersion >= 1) return

  const count = autoAnnotateAllComponents()
  runBatch(() => {
    runNoSave("INSERT OR REPLACE INTO seed_metadata (key, value) VALUES ('tags_version', '1')")
  })
  log.info(`[DB] Auto-annotated ${count} components with tags`)
}

// ============ 批量导入预扫描 + 执行 ============

/** 计算两条 DNA 序列的最大 identity（正向+RC，滑动窗口） */
function computeDnaIdentityFull(seq1: string, seq2: string): { identity: number; mode: 'nt-nt'; isRC: boolean } {
  const s1 = seq1.toUpperCase().replace(/[^ATGC]/g, '')
  const s2 = seq2.toUpperCase().replace(/[^ATGC]/g, '')
  if (!s1 || !s2) return { identity: 0, mode: 'nt-nt', isRC: false }
  const [shorter, longer] = s1.length <= s2.length ? [s1, s2] : [s2, s1]
  const sLen = shorter.length, lLen = longer.length
  if (lLen < sLen) return { identity: 0, mode: 'nt-nt', isRC: false }
  let best = 0, bestRC = false
  // 正向
  for (let i = 0; i <= lLen - sLen; i++) {
    let mm = 0
    for (let j = 0; j < sLen; j++) {
      if (shorter[j] !== longer[i + j]) { mm++; if (mm > sLen * 0.5) break }
    }
    if (mm <= sLen * 0.5) {
      const id = Math.round(((sLen - mm) / sLen) * 100)
      if (id > best) { best = id; bestRC = false }
    }
  }
  // RC
  const rcShorter = reverseComplement(shorter)
  for (let i = 0; i <= lLen - sLen; i++) {
    let mm = 0
    for (let j = 0; j < sLen; j++) {
      if (rcShorter[j] !== longer[i + j]) { mm++; if (mm > sLen * 0.5) break }
    }
    if (mm <= sLen * 0.5) {
      const id = Math.round(((sLen - mm) / sLen) * 100)
      if (id > best) { best = id; bestRC = true }
    }
  }
  return { identity: best, mode: 'nt-nt', isRC: bestRC }
}

/** 计算两条序列的 AA identity（六框翻译后比对） */
function computeAaIdentity(dna1: string, dna2: string): { identity: number; mode: 'nt-aa' } {
  if (!dna1 || !dna2 || dna1.length < 30 || dna2.length < 30) return { identity: 0, mode: 'nt-aa' }
  const frames1 = sixFrameTranslation(dna1)
  const frames2 = sixFrameTranslation(dna2)
  let best = 0
  for (const f1 of frames1) {
    if (!f1 || f1.length < 10) continue
    for (const f2 of frames2) {
      if (!f2 || f2.length < 10) continue
      const [shorter, longer] = f1.length <= f2.length ? [f1, f2] : [f2, f1]
      const sLen = shorter.length, lLen = longer.length
      if (Math.abs(lLen - sLen) / Math.max(sLen, 1) > 0.3) continue
      for (let i = 0; i <= lLen - sLen; i++) {
        let mm = 0
        for (let j = 0; j < sLen; j++) {
          if (shorter[j] !== longer[i + j]) { mm++; if (mm > sLen * 0.5) break }
        }
        if (mm <= sLen * 0.5) {
          const id = Math.round(((sLen - mm) / sLen) * 100)
          if (id > best) best = id
        }
      }
    }
  }
  return { identity: best, mode: 'nt-aa' }
}

/** 批量导入预扫描：返回每个 feature 的导入状态和匹配信息（不写入数据库） */
export function previewBatchImport(
  features: GenBankFeature[],
  vectorSeq: string,
  sourceVectorName?: string
): ImportPreviewItem[] {
  if (!features || features.length === 0) return []
  const seq = (vectorSeq || '').toUpperCase().replace(/[^ATGC]/g, '')
  if (!seq) return []

  // 加载已有元件
  const existingRes = getDb().exec(
    'SELECT id, sequence, standard_name, aliases, type, amino_acid_sequence FROM vector_components'
  )
  const existingRows = existingRes.length > 0 ? existingRes[0].values : []
  const existingNames = new Set<string>()
  const existingAliases = new Set<string>()
  const nameToId = new Map<string, number>()
  const aliasToId = new Map<string, number>()
  const existingData: Array<{ id: number; seq: string; name: string; type: string; aa: string }> = []

  for (const row of existingRows) {
    const id = Number(row[0])
    const sName = String(row[2] || '').toLowerCase()
    existingNames.add(sName)
    nameToId.set(sName, id)
    try {
      const arr: string[] = JSON.parse(String(row[3] || '[]'))
      arr.forEach(a => { existingAliases.add(a.toLowerCase()); aliasToId.set(a.toLowerCase(), id) })
    } catch { /* ignore */ }
    existingData.push({
      id,
      seq: String(row[1] || '').toUpperCase(),
      name: String(row[2] || ''),
      type: String(row[4] || 'other'),
      aa: String(row[5] || '')
    })
  }

  const typeMap: Record<string, VectorComponentType> = {
    gene: 'CDS', CDS: 'CDS', mRNA: 'CDS',
    promoter: 'promoter', rep_origin: 'origin',
    terminator: 'terminator', enhancer: 'enhancer',
    misc_feature: 'other', primer_bind: 'other'
  }

  const results: ImportPreviewItem[] = []

  for (let fi = 0; fi < features.length; fi++) {
    const f = features[fi]
    const fStart = f.start
    const fEnd = f.end
    if (fStart < 0 || fEnd > seq.length || fStart >= fEnd) continue
    const fSeq = seq.substring(fStart, fEnd)
    if (fSeq.length < 10) continue
    const name = f.qualifiers?.label || f.qualifiers?.gene || f.qualifiers?.product || f.type || 'unknown'
    const nameLower = name.toLowerCase()
    const compType = typeMap[f.type] || 'other'
    const aaSeq = PROTEIN_TYPES.has(compType) ? translateDNA(fSeq) : ''

    const baseItem: Omit<ImportPreviewItem, 'status'> = {
      featureIndex: fi,
      name,
      type: f.type,
      dnaLength: fSeq.length,
      aaLength: aaSeq.length,
      strand: f.strand || 1
    }

    // 检查名称匹配
    if (existingNames.has(nameLower)) {
      const compId = nameToId.get(nameLower)!
      const matchComp = existingData.find(e => e.id === compId)
      // 计算序列相似度
      let dnaId = 0, aaId = 0
      if (matchComp) {
        const dnaRes = computeDnaIdentityFull(fSeq, matchComp.seq)
        dnaId = dnaRes.identity
        const aaRes = computeAaIdentity(fSeq, matchComp.seq)
        aaId = aaRes.identity
      }
      results.push({
        ...baseItem,
        status: dnaId >= 95 || aaId >= 95 ? 'duplicate' : 'variant',
        matchComponentId: compId,
        matchComponentName: matchComp?.name,
        matchComponentType: matchComp?.type,
        dnaIdentity: dnaId,
        aaIdentity: aaId,
        alignmentMode: aaId > dnaId ? 'nt-aa' : 'nt-nt',
        skipReason: `与已有 ${matchComp?.name} DNA identity=${dnaId}%，AA identity=${aaId}%。名称相同，视为同一元件。`
      })
      continue
    }

    // 检查别名匹配
    if (existingAliases.has(nameLower)) {
      const compId = aliasToId.get(nameLower)!
      const matchComp = existingData.find(e => e.id === compId)
      let dnaId = 0, aaId = 0
      if (matchComp) {
        const dnaRes = computeDnaIdentityFull(fSeq, matchComp.seq)
        dnaId = dnaRes.identity
        const aaRes = computeAaIdentity(fSeq, matchComp.seq)
        aaId = aaRes.identity
      }
      results.push({
        ...baseItem,
        status: dnaId >= 95 || aaId >= 95 ? 'duplicate' : 'variant',
        matchComponentId: compId,
        matchComponentName: matchComp?.name,
        matchComponentType: matchComp?.type,
        dnaIdentity: dnaId,
        aaIdentity: aaId,
        alignmentMode: aaId > dnaId ? 'nt-aa' : 'nt-nt',
        skipReason: `名称“${name}”匹配已有元件别名。DNA identity=${dnaId}%，AA identity=${aaId}%。`
      })
      continue
    }

    // 序列匹配（找所有候选）
    const candidates: Array<{ componentId: number; componentName: string; componentType: string; dnaIdentity: number; aaIdentity: number; alignmentMode: string }> = []
    for (const eData of existingData) {
      if (!eData.seq || eData.seq.length < 30) continue
      const dnaRes = computeDnaIdentityFull(fSeq, eData.seq)
      const aaRes = computeAaIdentity(fSeq, eData.seq)
      // 放宽阈值收集候选：DNA≥70% 或 AA≥60%
      if (dnaRes.identity >= 70 || aaRes.identity >= 60) {
        candidates.push({
          componentId: eData.id,
          componentName: eData.name,
          componentType: eData.type,
          dnaIdentity: dnaRes.identity,
          aaIdentity: aaRes.identity,
          alignmentMode: aaRes.identity > dnaRes.identity ? 'nt-aa' : 'nt-nt'
        })
      }
    }

    // 按最佳 identity 排序
    candidates.sort((a, b) => Math.max(b.dnaIdentity, b.aaIdentity) - Math.max(a.dnaIdentity, a.aaIdentity))

    if (candidates.length === 0) {
      results.push({ ...baseItem, status: 'new' })
    } else if (candidates.length === 1) {
      const c = candidates[0]
      const bestId = Math.max(c.dnaIdentity, c.aaIdentity)
      results.push({
        ...baseItem,
        status: bestId >= 95 ? 'duplicate' : 'variant',
        matchComponentId: c.componentId,
        matchComponentName: c.componentName,
        matchComponentType: c.componentType,
        dnaIdentity: c.dnaIdentity,
        aaIdentity: c.aaIdentity,
        alignmentMode: c.alignmentMode as 'nt-nt' | 'nt-aa',
        skipReason: bestId >= 95 ? `与已有 ${c.componentName} 高度相似 (DNA=${c.dnaIdentity}%, AA=${c.aaIdentity}%)` : undefined
      })
    } else {
      // 多个候选
      const best = candidates[0]
      const bestId = Math.max(best.dnaIdentity, best.aaIdentity)
      results.push({
        ...baseItem,
        status: bestId >= 95 ? 'ambiguous' : (bestId >= 60 ? 'ambiguous' : 'new'),
        matchComponentId: best.componentId,
        matchComponentName: best.componentName,
        matchComponentType: best.componentType,
        dnaIdentity: best.dnaIdentity,
        aaIdentity: best.aaIdentity,
        alignmentMode: best.alignmentMode as 'nt-nt' | 'nt-aa',
        candidates: candidates.slice(0, 5)
      })
    }
  }

  return results
}

/** 执行批量导入：根据用户决策写入数据库 */
export function executeBatchImport(
  features: GenBankFeature[],
  vectorSeq: string,
  sourceVectorName: string | undefined,
  decisions: ImportDecision[]
): { imported: number; skipped: number; linked: number; failed: number } {
  if (!features || features.length === 0 || !decisions || decisions.length === 0) {
    return { imported: 0, skipped: 0, linked: 0, failed: 0 }
  }
  const seq = (vectorSeq || '').toUpperCase().replace(/[^ATGC]/g, '')
  const srcName = sourceVectorName || '未命名载体'

  const defaultSpecies = features
    .filter(f => f.type === 'source')
    .map(f => f.qualifiers?.organism || '')
    .find(s => s) || ''

  const typeMap: Record<string, VectorComponentType> = {
    gene: 'CDS', CDS: 'CDS', mRNA: 'CDS',
    promoter: 'promoter', rep_origin: 'origin',
    terminator: 'terminator', enhancer: 'enhancer',
    misc_feature: 'other', primer_bind: 'other'
  }

  let imported = 0, skipped = 0, linked = 0, failed = 0

  for (const dec of decisions) {
    const f = features[dec.featureIndex]
    if (!f) { skipped++; continue }
    const fSeq = seq.substring(f.start, f.end)
    if (fSeq.length < 10) { skipped++; continue }
    const name = dec.overrideName || f.qualifiers?.label || f.qualifiers?.gene || f.qualifiers?.product || f.type || 'unknown'
    const compType = typeMap[f.type] || 'other'
    const species = f.qualifiers?.organism || defaultSpecies

    if (dec.action === 'skip') {
      skipped++
      continue
    }

    if (dec.action === 'import-as-variant' || dec.action === 'import-as-variant-of') {
      const targetId = dec.variantOfComponentId
      if (!targetId) { failed++; continue }
      // 将新元件作为相似变体关联到已有元件
      const existing = getComponent(targetId)
      if (!existing) { failed++; continue }
      let variants: SimilarVariant[] = []
      try { variants = JSON.parse(existing.similar_variants || '[]') } catch { variants = [] }
      const dnaRes = computeDnaIdentityFull(fSeq, existing.sequence || '')
      const maxLen = Math.max(fSeq.length, (existing.sequence || '').length)
      const lengthDiffPct = maxLen > 0 ? (Math.abs(fSeq.length - (existing.sequence || '').length) / maxLen) * 100 : 0
      const variant: SimilarVariant = {
        name, identity: dnaRes.identity,
        length_new: fSeq.length, length_existing: (existing.sequence || '').length,
        length_diff_pct: Math.round(lengthDiffPct * 10) / 10,
        source_vector: srcName,
        detected_at: new Date().toISOString().replace('T', ' ').substring(0, 19)
      }
      const alreadyLinked = variants.some(v => v.name === variant.name && v.source_vector === variant.source_vector)
      if (!alreadyLinked) {
        variants.push(variant)
        run(`UPDATE vector_components SET similar_variants = ? WHERE id = ?`, [JSON.stringify(variants), targetId])
        linked++
      } else {
        skipped++
      }
      continue
    }

    // action === 'import-new'
    try {
      const aaSeq = PROTEIN_TYPES.has(compType) ? translateDNA(fSeq) : ''
      createComponent({
        sequence: fSeq,
        standard_name: name,
        aliases: JSON.stringify([]),
        type: compType,
        species,
        notes: `从载体 feature 导入: ${f.type}`,
        amino_acid_sequence: aaSeq
      })
      imported++
    } catch {
      failed++
    }
  }

  saveDb()
  log.info(`[BatchImportExecute] imported=${imported}, skipped=${skipped}, linked=${linked}, failed=${failed}`)
  return { imported, skipped, linked, failed }
}
