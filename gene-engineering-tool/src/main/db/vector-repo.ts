/**
 * @module db/vector-repo
 * @description
 * 载体 Repository — 提供载体和实验室载体的 CRUD 操作、酶切位点管理。
 *
 * 架构设计意图：
 * - 封装 vectors、vector_enzyme_sites、lab_vectors 三张表的所有数据库操作
 * - 实验室载体通过 JOIN 关联载体和基因信息
 *
 * 依赖关系：
 * - db/base: 底层 SQL 工具
 * - shared/types: Vector, VectorEnzymeSite, LabVector 等类型
 */

import type { Vector, VectorEnzymeSite, LabVector, GenBankFeature } from '../../shared/types'
import { queryAll, queryOne, run, lastInsertId } from './base'

// ============ 载体 CRUD ============

/** 获取所有载体（按名称排序） */
export function getVectors(): Vector[] {
  return queryAll<Vector>('SELECT * FROM vectors ORDER BY name')
}

/** 根据 ID 获取单个载体 */
export function getVector(id: number): Vector | undefined {
  return queryOne<Vector>('SELECT * FROM vectors WHERE id = ?', [id])
}

/** 创建新载体记录 */
export function createVector(data: Omit<Vector, 'id'>): number {
  run(
    `INSERT INTO vectors (name, type, size_bp, description, sequence, backbone_id,
      purpose, host_type, promoter_type, promoters, reporter_gene,
      is_recombinant, antibiotic_resistance,
      copy_number, file_path, topology, source_file)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.name, data.type, data.size_bp, data.description, data.sequence, data.backbone_id,
     data.purpose || '', data.host_type || '[]', data.promoter_type || 'none',
     data.promoters || '', data.reporter_gene || '',
     data.is_recombinant ? 1 : 0, data.antibiotic_resistance || '',
     data.copy_number || '', data.file_path || '', data.topology || 'circular', data.source_file || '']
  )
  return lastInsertId()
}

/** 更新载体记录（部分更新） */
export function updateVector(id: number, data: Partial<Vector>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.type !== undefined) { fields.push('type = ?'); values.push(data.type) }
  if (data.size_bp !== undefined) { fields.push('size_bp = ?'); values.push(data.size_bp) }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description) }
  if (data.sequence !== undefined) { fields.push('sequence = ?'); values.push(data.sequence) }
  if (data.backbone_id !== undefined) { fields.push('backbone_id = ?'); values.push(data.backbone_id) }
  if (data.purpose !== undefined) { fields.push('purpose = ?'); values.push(data.purpose) }
  if (data.host_type !== undefined) { fields.push('host_type = ?'); values.push(data.host_type) }
  if (data.promoter_type !== undefined) { fields.push('promoter_type = ?'); values.push(data.promoter_type) }
  if (data.promoters !== undefined) { fields.push('promoters = ?'); values.push(data.promoters) }
  if (data.reporter_gene !== undefined) { fields.push('reporter_gene = ?'); values.push(data.reporter_gene) }
  if (data.is_recombinant !== undefined) { fields.push('is_recombinant = ?'); values.push(data.is_recombinant ? 1 : 0) }
  if (data.antibiotic_resistance !== undefined) { fields.push('antibiotic_resistance = ?'); values.push(data.antibiotic_resistance) }
  if (data.copy_number !== undefined) { fields.push('copy_number = ?'); values.push(data.copy_number) }
  if (data.file_path !== undefined) { fields.push('file_path = ?'); values.push(data.file_path) }
  if (data.topology !== undefined) { fields.push('topology = ?'); values.push(data.topology) }
  if (data.source_file !== undefined) { fields.push('source_file = ?'); values.push(data.source_file) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE vectors SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 保存载体的 features（序列化为 JSON） */
export function saveVectorFeatures(vectorId: number, features: GenBankFeature[]): void {
  run('UPDATE vectors SET features_json = ? WHERE id = ?', [JSON.stringify(features), vectorId])
}

/** 删除载体记录 */
export function deleteVector(id: number): void {
  run('DELETE FROM vectors WHERE id = ?', [id])
}

// ============ 载体酶切位点 ============

/** 获取载体的所有酶切位点（JOIN 酶信息，按位置排序） */
export function getVectorEnzymeSites(vectorId: number): VectorEnzymeSite[] {
  return queryAll(`
    SELECT ves.*, re.name as enzyme_name, re.recognition_sequence, re.source_organism, re.cut_position, re.optimal_temp, re.is_palindromic
    FROM vector_enzyme_sites ves
    JOIN restriction_enzymes re ON ves.enzyme_id = re.id
    WHERE ves.vector_id = ?
    ORDER BY ves.position
  `, [vectorId]) as any[]
}

/** 添加载体酶切位点 */
export function addVectorEnzymeSite(vectorId: number, enzymeId: number, position: number, isUnique: boolean): number {
  run(
    'INSERT INTO vector_enzyme_sites (vector_id, enzyme_id, position, is_unique) VALUES (?, ?, ?, ?)',
    [vectorId, enzymeId, position, isUnique ? 1 : 0]
  )
  return lastInsertId()
}

/** 删除载体酶切位点 */
export function removeVectorEnzymeSite(id: number): void {
  run('DELETE FROM vector_enzyme_sites WHERE id = ?', [id])
}

// ============ 实验室载体 CRUD ============

/** 获取所有实验室载体（含关联载体/基因名称） */
export function getLabVectors(): LabVector[] {
  return queryAll(`
    SELECT lv.*, v.name as vector_name, v.type as vector_type,
           gs.gene_name as insert_gene_name,
           elv.name as empty_vector_name
    FROM lab_vectors lv
    LEFT JOIN vectors v ON lv.vector_id = v.id
    LEFT JOIN gene_sequences gs ON lv.insert_gene_id = gs.id
    LEFT JOIN lab_vectors elv ON lv.empty_vector_id = elv.id
    ORDER BY lv.name
  `) as any[]
}

/** 根据 ID 获取单个实验室载体 */
export function getLabVector(id: number): LabVector | undefined {
  return queryOne(`
    SELECT lv.*, v.name as vector_name, v.type as vector_type,
           gs.gene_name as insert_gene_name,
           elv.name as empty_vector_name
    FROM lab_vectors lv
    LEFT JOIN vectors v ON lv.vector_id = v.id
    LEFT JOIN gene_sequences gs ON lv.insert_gene_id = gs.id
    LEFT JOIN lab_vectors elv ON lv.empty_vector_id = elv.id
    WHERE lv.id = ?
  `, [id]) as any
}

/** 创建实验室载体 */
export function createLabVector(data: Omit<LabVector, 'id' | 'created_at'>): number {
  run(
    'INSERT INTO lab_vectors (vector_id, name, insert_gene_id, empty_vector_id, notes) VALUES (?, ?, ?, ?, ?)',
    [data.vector_id, data.name, data.insert_gene_id, data.empty_vector_id, data.notes]
  )
  return lastInsertId()
}

/** 更新实验室载体 */
export function updateLabVector(id: number, data: Partial<LabVector>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.vector_id !== undefined) { fields.push('vector_id = ?'); values.push(data.vector_id) }
  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.insert_gene_id !== undefined) { fields.push('insert_gene_id = ?'); values.push(data.insert_gene_id) }
  if (data.empty_vector_id !== undefined) { fields.push('empty_vector_id = ?'); values.push(data.empty_vector_id) }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }
  if (fields.length === 0) return
  values.push(id)
  run(`UPDATE lab_vectors SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 删除实验室载体 */
export function deleteLabVector(id: number): void {
  run('DELETE FROM lab_vectors WHERE id = ?', [id])
}
