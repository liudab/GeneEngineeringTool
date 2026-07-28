/**
 * @module db/enzyme-repo
 * @description
 * 限制性内切酶 Repository — 提供酶的 CRUD 操作、搜索和种子数据管理。
 *
 * 架构设计意图：
 * - 封装 restriction_enzymes 表的所有数据库操作
 * - 种子数据版本控制（SEED_VERSION）确保启动时自动同步
 * - 提供标准的 CRUD 接口：getAll/getById/search/create/update/delete
 *
 * 数据流向：
 * IPC handler → enzyme-repo → db/base (SQL执行)
 *
 * 依赖关系：
 * - db/base: 底层 SQL 工具
 * - seed-enzymes: 硬编码种子数据
 * - shared/types: RestrictionEnzyme 类型
 */

import type { RestrictionEnzyme } from '../../shared/types'
import { queryAll, queryOne, run, runNoSave, runBatch, lastInsertId, saveDb } from './base'
import { createLogger } from '../logger'
import { SEED_ENZYMES } from '../seed-enzymes'

const log = createLogger('DB:Enzyme')

// ============ CRUD ============

/** 获取所有酶（按名称排序） */
export function getEnzymes(): RestrictionEnzyme[] {
  return queryAll<RestrictionEnzyme>('SELECT * FROM restriction_enzymes ORDER BY name')
}

/** 根据 ID 获取单个酶 */
export function getEnzyme(id: number): RestrictionEnzyme | undefined {
  return queryOne<RestrictionEnzyme>('SELECT * FROM restriction_enzymes WHERE id = ?', [id])
}

/** 按名称/来源/识别序列/中文来源模糊搜索酶 */
export function searchEnzymes(query: string): RestrictionEnzyme[] {
  const q = `%${query}%`
  return queryAll<RestrictionEnzyme>(
    'SELECT * FROM restriction_enzymes WHERE name LIKE ?1 OR source_organism LIKE ?1 OR recognition_sequence LIKE ?1 OR source_organism_cn LIKE ?1 ORDER BY name', [q]
  )
}

/** 创建新酶记录，返回插入 ID */
export function createEnzyme(data: Omit<RestrictionEnzyme, 'id'>): number {
  run(
    `INSERT INTO restriction_enzymes (name, source_organism, recognition_sequence, cut_position, optimal_temp, is_palindromic,
      overhang_type, overhang_length, top_cut_offset, bottom_cut_offset, optimal_buffer,
      heat_inactivation_temp, methylation_sensitive, is_time_saver, is_high_fidelity,
      star_activity_note, ligation_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.name, data.source_organism, data.recognition_sequence, data.cut_position, data.optimal_temp, data.is_palindromic ? 1 : 0,
      data.overhang_type ?? '5prime', data.overhang_length ?? 4, data.top_cut_offset ?? null, data.bottom_cut_offset ?? null,
      data.optimal_buffer ?? null, data.heat_inactivation_temp ?? null, data.methylation_sensitive ?? null,
      data.is_time_saver ? 1 : 0, data.is_high_fidelity ? 1 : 0,
      data.star_activity_note ?? null, data.ligation_note ?? null]
  )
  return lastInsertId()
}

/** 更新酶记录（部分更新） */
export function updateEnzyme(id: number, data: Partial<RestrictionEnzyme>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.source_organism !== undefined) { fields.push('source_organism = ?'); values.push(data.source_organism) }
  if (data.recognition_sequence !== undefined) { fields.push('recognition_sequence = ?'); values.push(data.recognition_sequence) }
  if (data.cut_position !== undefined) { fields.push('cut_position = ?'); values.push(data.cut_position) }
  if (data.optimal_temp !== undefined) { fields.push('optimal_temp = ?'); values.push(data.optimal_temp) }
  if (data.is_palindromic !== undefined) { fields.push('is_palindromic = ?'); values.push(data.is_palindromic ? 1 : 0) }
  if (data.overhang_type !== undefined) { fields.push('overhang_type = ?'); values.push(data.overhang_type) }
  if (data.overhang_length !== undefined) { fields.push('overhang_length = ?'); values.push(data.overhang_length) }
  if (data.top_cut_offset !== undefined) { fields.push('top_cut_offset = ?'); values.push(data.top_cut_offset) }
  if (data.bottom_cut_offset !== undefined) { fields.push('bottom_cut_offset = ?'); values.push(data.bottom_cut_offset) }
  if (data.optimal_buffer !== undefined) { fields.push('optimal_buffer = ?'); values.push(data.optimal_buffer) }
  if (data.heat_inactivation_temp !== undefined) { fields.push('heat_inactivation_temp = ?'); values.push(data.heat_inactivation_temp) }
  if (data.methylation_sensitive !== undefined) { fields.push('methylation_sensitive = ?'); values.push(data.methylation_sensitive) }
  if (data.is_time_saver !== undefined) { fields.push('is_time_saver = ?'); values.push(data.is_time_saver ? 1 : 0) }
  if (data.is_high_fidelity !== undefined) { fields.push('is_high_fidelity = ?'); values.push(data.is_high_fidelity ? 1 : 0) }
  if (data.star_activity_note !== undefined) { fields.push('star_activity_note = ?'); values.push(data.star_activity_note) }
  if (data.ligation_note !== undefined) { fields.push('ligation_note = ?'); values.push(data.ligation_note) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE restriction_enzymes SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 删除酶记录 */
export function deleteEnzyme(id: number): void {
  run('DELETE FROM restriction_enzymes WHERE id = ?', [id])
}

// ============ 种子数据 ============

/** 种子数据版本号 —— 每次修改种子数据时递增 */
const SEED_VERSION = 4

/** 启动时播种酶库：基于版本号判断是否需要重新播种 */
export function seedEnzymes(): void {
  const meta = queryOne<{ value: string }>('SELECT value FROM seed_metadata WHERE key = ?', ['enzyme_seed_version'])
  const currentVersion = meta ? parseInt(meta.value, 10) : 0

  if (currentVersion === SEED_VERSION) {
    const count = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM restriction_enzymes')
    log.info(`Enzyme seeds skipped: version ${SEED_VERSION} up-to-date (${count?.cnt ?? 0} enzymes)`)
    return
  }

  if (currentVersion > 0) {
    log.info(`Enzyme seed version changed: ${currentVersion} → ${SEED_VERSION}. Re-seeding...`)
  }
  runBatch(() => {
    if (currentVersion > 0) {
      runNoSave('DELETE FROM restriction_enzymes')
    }
    insertAllSeedEnzymesInternal()
    runNoSave(`INSERT OR REPLACE INTO seed_metadata (key, value) VALUES (?, ?)`, ['enzyme_seed_version', String(SEED_VERSION)])
  })
  const count = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM restriction_enzymes')
  log.info(`Enzyme seeds loaded: ${count?.cnt ?? 0} enzymes (version ${SEED_VERSION})`)
}

/** 强制用最新种子数据覆盖酶库（用于 IPC"更新酶库"），返回酶总数 */
export function updateEnzymeLibrary(): number {
  runBatch(() => {
    runNoSave('DELETE FROM restriction_enzymes')
    insertAllSeedEnzymesInternal()
    runNoSave(`INSERT OR REPLACE INTO seed_metadata (key, value) VALUES (?, ?)`, ['enzyme_seed_version', String(SEED_VERSION)])
  })
  const count = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM restriction_enzymes')
  return count?.cnt ?? 0
}

/** 内部：批量插入所有种子酶（不执行 saveDb，由调用方负责事务） */
function insertAllSeedEnzymesInternal(): void {
  const sql = `INSERT OR REPLACE INTO restriction_enzymes
    (name, source_organism, recognition_sequence, cut_position, optimal_temp, is_palindromic,
     overhang_type, overhang_length, top_cut_offset, bottom_cut_offset, optimal_buffer,
     heat_inactivation_temp, methylation_sensitive, is_time_saver, is_high_fidelity,
     star_activity_note, ligation_note,
     cut_sequence, subtype, rebase_id, prototype, source_organism_cn, organism_type,
     growth_temp, molecular_weight, clean_recognition_seq, seq_length,
     has_ambiguous_bases, gc_content,
     sites_lambda, sites_pbr322, sites_adeno2, sites_phix174, sites_sv40,
     gene_cloned, gene_sequenced, crystal_data, kinetics_data,
     ss_cleavage, has_isoschizomers, date_entered, date_modified, rebase_url)
    VALUES (${Array(43).fill('?').join(', ')})`
  for (const e of SEED_ENZYMES) {
    runNoSave(sql, [
      e.name, e.source_organism, e.recognition_sequence, e.cut_position, e.optimal_temp, e.is_palindromic ? 1 : 0,
      e.overhang_type ?? '5prime', e.overhang_length ?? 4, e.top_cut_offset ?? null, e.bottom_cut_offset ?? null,
      e.optimal_buffer ?? null, e.heat_inactivation_temp ?? null, e.methylation_sensitive ?? null,
      e.is_time_saver ? 1 : 0, e.is_high_fidelity ? 1 : 0,
      e.star_activity_note ?? null, e.ligation_note ?? null,
      e.cut_sequence ?? null, e.subtype ?? null, e.rebase_id ?? null, e.prototype ?? null,
      e.source_organism_cn ?? null, e.organism_type ?? null,
      e.growth_temp ?? null, e.molecular_weight ?? null,
      e.clean_recognition_seq ?? null, e.seq_length ?? null,
      e.has_ambiguous_bases ? 1 : 0, e.gc_content ?? null,
      e.sites_lambda ?? null, e.sites_pbr322 ?? null, e.sites_adeno2 ?? null,
      e.sites_phix174 ?? null, e.sites_sv40 ?? null,
      e.gene_cloned ? 1 : 0, e.gene_sequenced ? 1 : 0,
      e.crystal_data ? 1 : 0, e.kinetics_data ? 1 : 0,
      e.ss_cleavage ? 1 : 0, e.has_isoschizomers ? 1 : 0,
      e.date_entered ?? null, e.date_modified ?? null, e.rebase_url ?? null
    ])
  }
}
