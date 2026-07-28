/**
 * @module services/file-import-service
 * @description
 * 文件导入 Service — 统一多格式序列文件解析逻辑，消除 IPC 层 5 处重复的分支代码。
 *
 * 架构设计意图：
 * - 将 .gb/.gbk/.genbank/.fasta/.fa/.fna/.dna/.embl/.emb 的多格式分支解析逻辑
 *   从 ipc.ts 的 VECTOR_IMPORT / FILE_OPEN / EDITOR_GET_DATA / GENE_EDITOR_GET_DATA /
 *   LAB_VECTOR_IMPORT_FILE 中提取为统一接口
 * - 调用方只需 `parseFileContent(filePath)` 即可获得标准化的解析结果
 * - IPC handler 不再包含格式判断和解析调用，仅负责文件对话框和数据库写入
 *
 * 核心接口：
 * - `parseFileContent(filePath)` — 解析文件，返回 GenBankRecord 或 FastaRecord
 * - `readFeaturesFromFile(filePath)` — 仅提取 features（编辑器数据加载用）
 *
 * 数据流向：
 * IPC handler → parseFileContent(filePath) → file-parser.ts → GenBankRecord | FastaRecord
 *
 * 依赖关系：
 * - file-parser: parseGenBank, parseFasta, parseDnaFormat, parseEMBL
 * - fs/path: 文件读取
 */

import { readFileSync } from 'fs'
import path from 'path'
import type { GenBankRecord, FastaRecord, GenBankFeature } from '../../shared/types'
import { parseGenBank, parseFasta, parseDnaFormat, parseEMBL } from '../file-parser'

/** 文件解析结果的统一类型 */
export type ParsedFileContent =
  | { format: 'genbank'; data: GenBankRecord }
  | { format: 'fasta'; data: FastaRecord[] }
  | null

/** 从文件扩展名推断格式（不区分大小写） */
function getFormat(ext: string): 'dna' | 'genbank' | 'embl' | 'fasta' | null {
  const e = ext.toLowerCase()
  if (e === '.dna') return 'dna'
  if (['.gb', '.gbk', '.genbank'].includes(e)) return 'genbank'
  if (['.embl', '.emb'].includes(e)) return 'embl'
  if (['.fasta', '.fa', '.fna'].includes(e)) return 'fasta'
  return null
}

/**
 * 解析序列文件内容，返回标准化的解析结果。
 * 支持格式：.gb/.gbk/.genbank, .fasta/.fa/.fna, .dna (binary), .embl/.emb
 *
 * @param filePath 文件路径
 * @returns 解析结果（含格式标签 + 数据），不支持的格式或解析失败返回 null
 */
export function parseFileContent(filePath: string): ParsedFileContent {
  const ext = path.extname(filePath).toLowerCase()
  const format = getFormat(ext)
  if (!format) return null

  if (format === 'dna') {
    const buffer = readFileSync(filePath)
    return { format: 'genbank', data: parseDnaFormat(buffer) }
  }

  const content = readFileSync(filePath, 'utf-8')
  if (format === 'genbank') {
    return { format: 'genbank', data: parseGenBank(content) }
  } else if (format === 'embl') {
    return { format: 'genbank', data: parseEMBL(content) }
  } else if (format === 'fasta') {
    return { format: 'fasta', data: parseFasta(content) }
  }

  return null
}

/**
 * 从文件中提取 features 列表（用于编辑器数据加载场景）。
 * 仅支持含 features 信息的格式：.gb/.gbk/.genbank, .dna, .embl/.emb
 *
 * @param filePath 文件路径
 * @returns features 列表，无 features 或解析失败返回空数组
 */
export function readFeaturesFromFile(filePath: string): GenBankFeature[] {
  const ext = path.extname(filePath).toLowerCase()
  const format = getFormat(ext)
  if (!format || format === 'fasta') return []

  try {
    if (format === 'dna') {
      const buffer = readFileSync(filePath)
      return parseDnaFormat(buffer).features || []
    }
    const content = readFileSync(filePath, 'utf-8')
    if (format === 'genbank') {
      return parseGenBank(content).features || []
    } else if (format === 'embl') {
      return parseEMBL(content).features || []
    }
  } catch { /* parse errors → empty */ }

  return []
}
