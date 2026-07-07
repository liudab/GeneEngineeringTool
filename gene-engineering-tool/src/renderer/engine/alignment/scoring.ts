/**
 * 比对打分矩阵模块
 * 包含 BLOSUM62 氨基酸替换矩阵和核酸打分函数
 */

import type { AlignmentParams } from './types'

/** 20种标准氨基酸字母（按 BLOSUM62 标准排列） */
const AA_ORDER = 'ARNDCQEGHILKMFPSTWYV'
const AA_INDEX: Record<string, number> = {}
for (let i = 0; i < AA_ORDER.length; i++) {
  AA_INDEX[AA_ORDER[i]] = i
}

/**
 * BLOSUM62 替换矩阵 (20×20)
 * 来源: NCBI 标准 BLOSUM62 矩阵
 * 行列顺序: A R N D C Q E G H I L K M F P S T W Y V
 */
const BLOSUM62_RAW: number[][] = [
  /* A*/[  4, -1, -2, -2,  0, -1, -1,  0, -2, -1, -1, -1, -1, -2, -1,  1,  0, -3, -2,  0],
  /* R*/[ -1,  5,  0, -2, -3,  1,  0, -2,  0, -3, -2,  2, -1, -3, -2, -1, -1, -3, -2, -3],
  /* N*/[ -2,  0,  6,  1, -3,  0,  0,  0,  1, -3, -3,  0, -2, -3, -2,  1,  0, -4, -2, -3],
  /* D*/[ -2, -2,  1,  6, -3,  0,  2, -1, -1, -3, -4, -1, -3, -3, -1,  0, -1, -4, -3, -3],
  /* C*/[  0, -3, -3, -3,  9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1],
  /* Q*/[ -1,  1,  0,  0, -3,  5,  2, -2,  0, -3, -2,  1,  0, -3, -1,  0, -1, -2, -1, -2],
  /* E*/[ -1,  0,  0,  2, -4,  2,  5, -2,  0, -3, -3,  1, -2, -3, -1,  0, -1, -3, -2, -2],
  /* G*/[  0, -2,  0, -1, -3, -2, -2,  6, -2, -4, -4, -2, -3, -3, -2,  0, -2, -2, -3, -3],
  /* H*/[ -2,  0,  1, -1, -3,  0,  0, -2,  8, -3, -3, -1, -2, -1, -2, -1, -2, -2,  2, -3],
  /* I*/[ -1, -3, -3, -3, -1, -3, -3, -4, -3,  4,  2, -3,  1,  0, -3, -2, -1, -3, -1,  3],
  /* L*/[ -1, -2, -3, -4, -1, -2, -3, -4, -3,  2,  4, -2,  2,  0, -3, -2, -1, -2, -1,  1],
  /* K*/[ -1,  2,  0, -1, -3,  1,  1, -2, -1, -3, -2,  5, -1, -3, -1,  0, -1, -3, -2, -2],
  /* M*/[ -1, -1, -2, -3, -1,  0, -2, -3, -2,  1,  2, -1,  5,  0, -2, -1, -1, -1, -1,  1],
  /* F*/[ -2, -3, -3, -3, -2, -3, -3, -3, -1,  0,  0, -3,  0,  6, -4, -2, -2,  1,  3, -1],
  /* P*/[ -1, -2, -2, -1, -3, -1, -1, -2, -2, -3, -3, -1, -2, -4,  7, -1, -1, -4, -3, -2],
  /* S*/[  1, -1,  1,  0, -1,  0,  0,  0, -1, -2, -2,  0, -1, -2, -1,  4,  1, -3, -2, -2],
  /* T*/[  0, -1,  0, -1, -1, -1, -1, -2, -2, -1, -1, -1, -1, -2, -1,  1,  5, -2, -2,  0],
  /* W*/[ -3, -3, -4, -4, -2, -2, -3, -2, -2, -3, -2, -3, -1,  1, -4, -3, -2, 11,  2, -3],
  /* Y*/[ -2, -2, -2, -3, -2, -1, -2, -3,  2, -1, -1, -2, -1,  3, -3, -2, -2,  2,  7, -1],
  /* V*/[  0, -3, -3, -3, -1, -2, -2, -3, -3,  3,  1, -2,  1, -1, -2, -2,  0, -3, -1,  4]
]

/** BLOSUM62 查表 */
export function blosum62Score(a: string, b: string): number {
  const ua = a.toUpperCase()
  const ub = b.toUpperCase()
  const ia = AA_INDEX[ua]
  const ib = AA_INDEX[ub]
  if (ia === undefined || ib === undefined) return -4 // 未知氨基酸罚分
  return BLOSUM62_RAW[ia][ib]
}

/**
 * BLOSUM62 相似性判定
 * 用于 midline 标注：得分 > 0 为相似 (:)，得分 >= 4 为保守 (.)
 */
export function blosum62Similarity(a: string, b: string): 'match' | 'similar' | 'mismatch' {
  if (a.toUpperCase() === b.toUpperCase()) return 'match'
  const score = blosum62Score(a, b)
  if (score > 0) return 'similar'
  return 'mismatch'
}

/**
 * 核酸打分
 */
export function nucleotideScore(a: string, b: string, params: AlignmentParams): number {
  return a.toUpperCase() === b.toUpperCase() ? params.match : params.mismatch
}

/**
 * 统一打分入口
 */
export function getScore(a: string, b: string, params: AlignmentParams, isProtein: boolean): number {
  if (a === '-' || b === '-') return 0 // gap 不在此处处理
  if (isProtein) {
    if (params.matrix === 'blosum62') return blosum62Score(a, b)
    // identity 矩阵
    return a.toUpperCase() === b.toUpperCase() ? params.match : params.mismatch
  }
  return nucleotideScore(a, b, params)
}

/**
 * 判断两个氨基酸是否化学性质相似（用于 midline 标注）
 */
const SIMILAR_GROUPS = [
  'ST',      // 羟基
  'NEQKR',   // 极性/带电
  'DE',      // 酸性
  'HR',      // 碱性
  'GAST',    // 小分子
  'ILMV',    // 疏水
  'FYW',     // 芳香族
  'C',       // 含硫
  'P'        // 脯氨酸
]

export function isSimilarAA(a: string, b: string): boolean {
  if (a.toUpperCase() === b.toUpperCase()) return true
  const ua = a.toUpperCase()
  const ub = b.toUpperCase()
  return SIMILAR_GROUPS.some(g => g.includes(ua) && g.includes(ub))
}
