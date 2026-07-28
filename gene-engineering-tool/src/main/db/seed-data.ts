/**
 * @module db/seed-data
 * @description
 * 种子数据编排模块 — 统一管理所有种子数据的播种顺序和版本控制。
 *
 * 架构设计意图：
 * - 集中管理种子数据的编排逻辑（酶 → 引物 → 元件 → 标签标注）
 * - 各 repo 模块的种子函数可独立调用，也可通过 runAllSeeds() 统一执行
 * - 版本控制机制确保种子数据不会重复播种
 *
 * 数据流向：
 * index.ts (启动) → runAllSeeds() → enzyme-repo.seedEnzymes()
 *                                → primer-repo.seedUniversalPrimers()
 *                                → seedVectorComponents()
 *                                → component-repo.runTagsAutoAnnotation()
 *
 * 依赖关系：
 * - db/base: 底层 SQL 工具
 * - db/enzyme-repo: 酶种子数据
 * - db/primer-repo: 引物种子数据
 * - db/component-repo: 元件种子数据 + 标签标注
 * - seed-components: 硬编码元件种子数据
 * - tagAutoAnnotator: 自动标签标注
 */

import { queryOne, queryAll, runNoSave, runBatch, lastInsertId, saveDb, getDb } from './base'
import { createLogger } from '../logger'
import { SEED_COMPONENTS, SEED_COMPONENTS_VERSION } from '../seed-components'
import { autoAnnotateTags } from '../tagAutoAnnotator'
import type { VectorComponent, ComponentVariant } from '../../shared/types'

const log = createLogger('DB:Seed')

// ============ 元件种子数据 ============

/** 播种元件库：从硬编码种子数据插入，使用版本号控制 */
export function seedVectorComponents(): void {
  const meta = queryOne<{ value: string }>("SELECT value FROM seed_metadata WHERE key = 'components_seed_version'")
  const currentVersion = meta ? parseInt(meta.value, 10) : 0

  if (currentVersion === SEED_COMPONENTS_VERSION) {
    const count = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM vector_components')
    log.info(`Component seeds skipped: version ${SEED_COMPONENTS_VERSION} up-to-date (${count?.cnt ?? 0} components)`)
    return
  }

  const existingRes = getDb().exec('SELECT standard_name, sequence FROM vector_components')
  const existingKeys = new Set<string>()
  if (existingRes.length > 0) {
    for (const row of existingRes[0].values) {
      existingKeys.add(`${String(row[0] || '').toLowerCase()}|${String(row[1] || '')}`)
    }
  }

  let inserted = 0
  runBatch(() => {
    for (const seed of SEED_COMPONENTS) {
      const key = `${seed.standard_name.toLowerCase()}|${seed.sequence}`
      if (existingKeys.has(key)) continue

      runNoSave(
        `INSERT INTO vector_components (
          sequence, standard_name, aliases, type, species, notes, amino_acid_sequence, similar_variants,
          feature_id, direction, species_short, species_latin, species_cn, taxonomic_category,
          ref_protein_sequence, molecular_weight, dna_variant_count, aa_variant_count,
          product_description, gene, bound_moiety, source_databases, total_occurrences,
          annotation_method, variants, tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          seed.sequence, seed.standard_name, seed.aliases || '[]', seed.type || 'other',
          seed.species || '', seed.notes || '', seed.amino_acid_sequence || '',
          seed.similar_variants || '[]',
          seed.feature_id || '', seed.direction || 'none',
          seed.species_short || '', seed.species_latin || '',
          seed.species_cn || '', seed.taxonomic_category || '',
          seed.ref_protein_sequence || '', seed.molecular_weight || 0,
          seed.dna_variant_count || 0, seed.aa_variant_count || 0,
          seed.product_description || '', seed.gene || '',
          seed.bound_moiety || '', seed.source_databases || '',
          seed.total_occurrences || 0, seed.annotation_method || '',
          seed.variants || '[]',
          seed.tags || JSON.stringify(autoAnnotateTags(seed.standard_name || '', seed.notes || '', seed.aliases || '[]'))
        ]
      )

      const compId = lastInsertId()
      if (compId > 0 && seed.variants && seed.variants !== '[]') {
        try {
          const variantList = JSON.parse(seed.variants) as Array<{
            variant_id?: string; seq_type?: string; sequence?: string;
            length?: number; is_reference?: number; sources?: string
          }>
          for (const v of variantList) {
            runNoSave(
              `INSERT OR IGNORE INTO component_variants (component_id, variant_id, seq_type, sequence, length, is_reference, sources)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [compId, v.variant_id || 'ref', v.seq_type || 'DNA', v.sequence || '', v.length || 0, v.is_reference || 0, v.sources || '']
            )
          }
        } catch (_e) { /* variants JSON 解析失败则跳过 */ }
      }

      existingKeys.add(key)
      inserted++
    }
    runNoSave(`INSERT OR REPLACE INTO seed_metadata (key, value) VALUES (?, ?)`, ['components_seed_version', String(SEED_COMPONENTS_VERSION)])
  })
  saveDb()
  log.info(`Seeded ${inserted} components (version ${SEED_COMPONENTS_VERSION})`)
}

/** 一次性清理旧种子元件数据 */
export function purgeOldSeedComponents(): number {
  const seedCount = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM vector_components
     WHERE annotation_method IN ('exact','pattern','description')
        OR (source_databases IS NOT NULL AND source_databases != '' AND source_databases != '[]')`
  )

  if ((seedCount?.cnt ?? 0) > 0) {
    runBatch(() => {
      runNoSave(`DELETE FROM component_variants WHERE component_id IN (
        SELECT id FROM vector_components
        WHERE annotation_method IN ('exact','pattern','description')
           OR (source_databases IS NOT NULL AND source_databases != '' AND source_databases != '[]')
      )`)
      runNoSave(`DELETE FROM vector_components
        WHERE annotation_method IN ('exact','pattern','description')
           OR (source_databases IS NOT NULL AND source_databases != '' AND source_databases != '[]')`)
    })
  }

  runNoSave(`DELETE FROM seed_metadata WHERE key = 'components_seed_version'`)
  runNoSave(`DELETE FROM seed_metadata WHERE key = 'components_seed_purged'`)
  saveDb()

  const after = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM vector_components')
  log.info(`[Purge] Old seed components removed: ${seedCount?.cnt ?? 0} records deleted (${after?.cnt ?? 0} remaining)`)
  return seedCount?.cnt ?? 0
}
