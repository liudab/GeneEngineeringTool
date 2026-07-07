/**
 * 序列比对模块 — 类型定义
 */

/** 比对类型 */
export type AlignmentType = 'nucleotide-nw' | 'nucleotide-sw' | 'protein' | 'nucleotide-protein'

/** 比对参数 */
export interface AlignmentParams {
  /** 匹配得分（核酸默认 +2） */
  match: number
  /** 不匹配罚分（核酸默认 -3） */
  mismatch: number
  /** 空位开放罚分（默认 -5） */
  gapOpen: number
  /** 空位延伸罚分（默认 -2） */
  gapExtend: number
  /** 蛋白打分矩阵 */
  matrix?: 'blosum62' | 'identity'
}

/** 单条比对结果 */
export interface AlignmentResult {
  /** 含 gap 的比对序列 1 */
  alignedSeq1: string
  /** 含 gap 的比对序列 2 */
  alignedSeq2: string
  /** 中间标注行（| 匹配，: 相似，. 保守替换，空格不匹配） */
  midline: string
  /** 比对得分 */
  score: number
  /** 一致性百分比 (0-100) */
  identity: number
  /** 相似性百分比 (0-100，蛋白比对用) */
  similarity: number
  /** 空位总数 */
  gaps: number
  /** 序列1 在原始序列中的覆盖范围 [start, end]（0-based） */
  seq1Range: [number, number]
  /** 序列2 在原始序列中的覆盖范围 [start, end]（0-based） */
  seq2Range: [number, number]
}

/** 完整比对输出 */
export interface AlignmentOutput {
  /** 比对类型 */
  type: AlignmentType
  /** 使用的参数 */
  params: AlignmentParams
  /** 比对结果（SW 局部比对可能有多条） */
  results: AlignmentResult[]
  /** 核酸-蛋白比对时的翻译阅读框 (0-5) */
  translationFrame?: number
  /** 序列名称 */
  seq1Name?: string
  seq2Name?: string
}

/** 默认比对参数 */
export const DEFAULT_NUCLEOTIDE_PARAMS: AlignmentParams = {
  match: 2,
  mismatch: -3,
  gapOpen: -5,
  gapExtend: -2
}

export const DEFAULT_PROTEIN_PARAMS: AlignmentParams = {
  match: 1,
  mismatch: -1,
  gapOpen: -10,
  gapExtend: -1,
  matrix: 'blosum62'
}

/** 六框翻译结果 */
export interface TranslatedFrame {
  /** 阅读框编号 (0-5): 0-2 正链, 3-5 反链 */
  frame: number
  /** 链方向 */
  strand: '+' | '-'
  /** 翻译后的蛋白质序列 */
  protein: string
  /** 密码子在核酸序列中的起始位置数组 */
  codonPositions: number[]
}
