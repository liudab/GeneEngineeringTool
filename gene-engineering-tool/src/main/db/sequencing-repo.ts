/**
 * @module db/sequencing-repo
 * @description
 * 测序文件 Repository — 提供测序文件的 CRUD 操作和搜索。
 *
 * 架构设计意图：
 * - 封装 sequencing_files 表的所有数据库操作
 * - 通过 LEFT JOIN primers 关联引物名称
 * - 支持按文件名/样本名/备注搜索
 *
 * 数据模型：
 * - 包含 trace_data（峰图原始数据）、peak_positions（峰位置）、quality_values（质量值）
 * - 支持 AB1/SEQ/FASTA 三种文件类型
 * - 支持正向/反向测序方向
 *
 * 依赖关系：
 * - db/base: 底层 SQL 工具
 * - shared/types: SequencingFile 类型
 */

import type { SequencingFile } from '../../shared/types'
import { queryAll, queryOne, run, lastInsertId } from './base'

// ============ CRUD ============

/** 获取所有测序文件（关联引物名称，按创建时间降序） */
export function getSequencingFiles(): SequencingFile[] {
  return queryAll<SequencingFile>(`
    SELECT sf.*, p.name as primer_name
    FROM sequencing_files sf
    LEFT JOIN primers p ON sf.primer_id = p.id
    ORDER BY sf.created_at DESC
  `)
}

/** 根据 ID 获取单个测序文件 */
export function getSequencingFile(id: number): SequencingFile | undefined {
  return queryOne<SequencingFile>(`
    SELECT sf.*, p.name as primer_name
    FROM sequencing_files sf
    LEFT JOIN primers p ON sf.primer_id = p.id
    WHERE sf.id = ?
  `, [id])
}

/** 搜索测序文件（按文件名/样本名/备注模糊匹配） */
export function searchSequencingFiles(query: string): SequencingFile[] {
  const q = `%${query}%`
  return queryAll<SequencingFile>(`
    SELECT sf.*, p.name as primer_name
    FROM sequencing_files sf
    LEFT JOIN primers p ON sf.primer_id = p.id
    WHERE sf.file_name LIKE ?1 OR sf.sample_name LIKE ?1 OR sf.notes LIKE ?1
    ORDER BY sf.created_at DESC
  `, [q])
}

/** 创建测序文件记录 */
export function createSequencingFile(data: Omit<SequencingFile, 'id' | 'created_at' | 'updated_at' | 'primer_name'>): number {
  run(
    `INSERT INTO sequencing_files (file_name, file_path, file_type, sample_name, direction, primer_id,
      sequence, trace_data, peak_positions, quality_values, run_info, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.file_name, data.file_path, data.file_type, data.sample_name, data.direction,
     data.primer_id, data.sequence, data.trace_data, data.peak_positions, data.quality_values,
     data.run_info, data.notes]
  )
  return lastInsertId()
}

/** 更新测序文件记录（部分更新，自动更新 updated_at） */
export function updateSequencingFile(id: number, data: Partial<SequencingFile>): void {
  const fields: string[] = []
  const values: unknown[] = []
  if (data.file_name !== undefined) { fields.push('file_name = ?'); values.push(data.file_name) }
  if (data.file_path !== undefined) { fields.push('file_path = ?'); values.push(data.file_path) }
  if (data.file_type !== undefined) { fields.push('file_type = ?'); values.push(data.file_type) }
  if (data.sample_name !== undefined) { fields.push('sample_name = ?'); values.push(data.sample_name) }
  if (data.direction !== undefined) { fields.push('direction = ?'); values.push(data.direction) }
  if (data.primer_id !== undefined) { fields.push('primer_id = ?'); values.push(data.primer_id) }
  if (data.sequence !== undefined) { fields.push('sequence = ?'); values.push(data.sequence) }
  if (data.trace_data !== undefined) { fields.push('trace_data = ?'); values.push(data.trace_data) }
  if (data.peak_positions !== undefined) { fields.push('peak_positions = ?'); values.push(data.peak_positions) }
  if (data.quality_values !== undefined) { fields.push('quality_values = ?'); values.push(data.quality_values) }
  if (data.run_info !== undefined) { fields.push('run_info = ?'); values.push(data.run_info) }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes) }
  if (fields.length === 0) return
  fields.push("updated_at = datetime('now')")
  values.push(id)
  run(`UPDATE sequencing_files SET ${fields.join(', ')} WHERE id = ?`, values)
}

/** 删除测序文件记录 */
export function deleteSequencingFile(id: number): void {
  run('DELETE FROM sequencing_files WHERE id = ?', [id])
}
