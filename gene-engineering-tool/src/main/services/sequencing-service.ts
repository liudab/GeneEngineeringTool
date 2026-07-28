/**
 * @module services/sequencing-service
 * @description
 * 测序数据处理 Service — 封装 AB1 文件的解析、碱基识别和参考序列匹配逻辑。
 *
 * 架构设计意图：
 * - 将 ipc.ts 的 SEQUENCING_FILE_READ handler (~100行) 中的业务逻辑提取为独立 Service
 * - IPC handler 仅负责调用本模块并返回结果
 * - 逻辑可被其他场景复用（如批量重新处理测序文件）
 *
 * 核心算法流程：
 * 1. 从 DB 获取测序文件记录
 * 2. 解析 trace_data / peak_positions / quality_values JSON
 * 3. 若 AB1 文件无 trace 数据 → 从磁盘文件重新解析 parseAb1
 * 4. 若 AB1 有 trace 数据 → 运行 callBases 碱基识别（每次读取重新运行，算法改进后自动更新）
 * 5. 自动匹配参考序列：在同类 sample_name / file_name 的 SEQ/FASTA 文件中寻找参考
 *
 * 输入/输出规范：
 * - 输入: fileId (number)
 * - 输出: SequencingFileResult（含 trace_data_parsed, peak_positions_parsed,
 *         quality_values_parsed, sequence, reference_sequence, reference_source 等）
 *
 * 依赖关系：
 * - db/sequencing-repo: 测序文件 CRUD
 * - ab1-parser: parseAb1
 * - base-caller: callBases
 * - fs/existsSync: 文件存在性检查
 */

import { existsSync, readFileSync } from 'fs'
import { getSequencingFile, getSequencingFiles, updateSequencingFile } from '../db/sequencing-repo'
import { parseAb1 } from '../ab1-parser'
import { callBases } from '../base-caller'
import { createLogger } from '../logger'

const log = createLogger('SeqService')

/** 处理后的测序文件结果 */
export interface SequencingFileResult {
  /** 原始文件记录的所有字段 */
  [key: string]: any
  /** 解析后的 trace 数据（AB1 四通道峰图） */
  trace_data_parsed?: any
  /** 解析后的峰位置数组 */
  peak_positions_parsed?: number[]
  /** 解析后的质量值数组 */
  quality_values_parsed?: number[]
  /** 参考序列（自动匹配的 SEQ/FASTA 文件序列） */
  reference_sequence?: string
  /** 参考序列来源文件名 */
  reference_source?: string
}

/**
 * 处理测序文件读取：解析 trace、运行碱基识别、自动匹配参考序列。
 *
 * @param id 测序文件 ID
 * @returns 处理后的结果（含解析后的 trace、峰位置、质量值、参考序列等），文件不存在返回 null
 */
export function processSequencingFile(id: number): SequencingFileResult | null {
  const file = getSequencingFile(id)
  if (!file) return null

  const result: SequencingFileResult = { ...file }

  // 1. 解析 JSON 字段
  if (file.trace_data) {
    try { result.trace_data_parsed = JSON.parse(file.trace_data) } catch { /* ignore */ }
  }
  if (file.peak_positions) {
    try { result.peak_positions_parsed = JSON.parse(file.peak_positions) } catch { /* ignore */ }
  }
  if (file.quality_values) {
    try { result.quality_values_parsed = JSON.parse(file.quality_values) } catch { /* ignore */ }
  }

  // 2. AB1 文件但无 trace 数据：从磁盘文件重新解析
  if (file.file_type === 'ab1' && !result.trace_data_parsed && file.file_path) {
    try {
      if (existsSync(file.file_path)) {
        log.debug(`Re-parsing AB1 file: ${file.file_path}`)
        const buffer = readFileSync(file.file_path)
        const ab1 = parseAb1(buffer)
        result.trace_data_parsed = ab1.traces
        result.peak_positions_parsed = ab1.peakPositions
        result.quality_values_parsed = ab1.qualityValues
        if (ab1.sequence) {
          result.sequence = ab1.sequence
        }
        // 回写到数据库
        const updateData: any = {
          trace_data: JSON.stringify(ab1.traces),
          peak_positions: JSON.stringify(ab1.peakPositions),
          quality_values: JSON.stringify(ab1.qualityValues)
        }
        if (ab1.sequence) {
          updateData.sequence = ab1.sequence
        }
        updateSequencingFile(id, updateData)
        console.log(`[SeqService] Re-parse AB1 success: ${ab1.sequence.length}bp, ${ab1.dataPoints} trace points`)
      } else {
        console.log(`[SeqService] AB1 file not found on disk: ${file.file_path}`)
      }
    } catch (e: any) { console.error('[SeqService] Re-parse AB1 failed:', e.message) }
  }

  // 3. AB1 碱基识别：始终使用算法从 trace 数据推导序列
  //    每次读取重新运行算法（算法改进后自动更新 DB）
  if (file.file_type === 'ab1' && result.trace_data_parsed && result.peak_positions_parsed) {
    try {
      const traces = result.trace_data_parsed
      const peaks = result.peak_positions_parsed as number[]
      const existingQ = result.quality_values_parsed as number[] | undefined
      const called = callBases(traces, peaks, existingQ)
      result.sequence = called.sequence
      console.log(`[SeqService] Base caller derived: ${called.sequence.length}bp`)
      // 仅当仪器 PQV 缺失时使用计算的质量值
      if (!existingQ || existingQ.length === 0) {
        result.quality_values_parsed = called.qualityScores
      }
      // 回写到数据库
      const updateData: any = { sequence: called.sequence }
      if (!existingQ || existingQ.length === 0) {
        updateData.quality_values = JSON.stringify(called.qualityScores)
      }
      updateSequencingFile(id, updateData)
    } catch (e: any) { console.error('[SeqService] Base caller failed:', e.message) }
  }

  // 4. 自动匹配参考序列（SEQ/FASTA 文件）
  if (file.file_type === 'ab1') {
    try {
      const allSeqFiles = getSequencingFiles()
      const ab1BaseName = file.file_name.replace(/\.[^.]+$/, '').toLowerCase()
      const ab1Sample = (file.sample_name || '').toLowerCase().trim()
      let bestMatch: typeof allSeqFiles[0] | null = null
      for (const sf of allSeqFiles) {
        if (sf.file_type === 'ab1' || sf.id === id) continue
        if (!sf.sequence) continue
        const sfBaseName = sf.file_name.replace(/\.[^.]+$/, '').toLowerCase()
        const sfSample = (sf.sample_name || '').toLowerCase().trim()
        if (ab1Sample && sfSample && ab1Sample === sfSample) { bestMatch = sf; break }
        if (ab1BaseName && sfBaseName && ab1BaseName === sfBaseName) { bestMatch = sf; break }
        if (ab1Sample && sfSample && (ab1Sample.includes(sfSample) || sfSample.includes(ab1Sample))) { bestMatch = sf; break }
        if (ab1BaseName && sfBaseName && (ab1BaseName.includes(sfBaseName) || sfBaseName.includes(ab1BaseName))) { bestMatch = sf; break }
      }
      if (bestMatch) {
        result.reference_sequence = bestMatch.sequence
        result.reference_source = bestMatch.file_name
        console.log(`[SeqService] Matched reference: ${bestMatch.file_name} (${bestMatch.sequence.length}bp)`)
      }
    } catch (e: any) { console.error('[SeqService] Auto-match SEQ failed:', e.message) }
  }

  return result
}
