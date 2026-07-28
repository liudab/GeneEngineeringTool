/**
 * Needleman-Wunsch 全局比对算法
 * 使用仿射空位罚分模型（三矩阵: M/X/Y）
 */

import type { AlignmentParams, AlignmentResult } from './types'
import { getScore, isSimilarAA } from './scoring'
import { createLogger } from '../../utils/logger'

const log = createLogger('NeedlemanWunsch')

const NEG_INF = -Infinity

/**
 * Needleman-Wunsch 全局比对
 * @param seq1 序列1
 * @param seq2 序列2
 * @param params 比对参数
 * @param isProtein 是否为蛋白质序列
 */
export function needlemanWunsch(
  seq1: string,
  seq2: string,
  params: AlignmentParams,
  isProtein: boolean = false
): AlignmentResult {
  log.info(`Starting NW alignment: seq1(${seq1.length}) vs seq2(${seq2.length}), isProtein=${isProtein}`)
  const n = seq1.length
  const m = seq2.length
  const { gapOpen, gapExtend } = params

  // 三矩阵：M（匹配态）、X（seq1 gap 态，即 seq1 有碱基对应 seq2 gap）、Y（seq2 gap 态）
  // 使用 (n+1) × (m+1) 矩阵
  const M: number[][] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(NEG_INF) as any) as any
  const X: number[][] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(NEG_INF) as any) as any
  const Y: number[][] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(NEG_INF) as any) as any

  // 初始化
  M[0][0] = 0
  for (let i = 1; i <= n; i++) {
    X[i][0] = gapOpen + gapExtend * i
  }
  for (let j = 1; j <= m; j++) {
    Y[0][j] = gapOpen + gapExtend * j
  }

  // 填充矩阵
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const matchScore = getScore(seq1[i - 1], seq2[j - 1], params, isProtein)

      // M[i][j]: 从三个前驱状态转入 + 匹配/错配分
      M[i][j] = Math.max(
        M[i - 1][j - 1] + matchScore,
        X[i - 1][j - 1] + matchScore,
        Y[i - 1][j - 1] + matchScore
      )

      // X[i][j]: seq1[i-1] 对齐 gap（在 seq2 中插入 gap）
      X[i][j] = Math.max(
        M[i - 1][j] + gapOpen + gapExtend,
        X[i - 1][j] + gapExtend
      )

      // Y[i][j]: gap 对齐 seq2[j-1]（在 seq1 中插入 gap）
      Y[i][j] = Math.max(
        M[i][j - 1] + gapOpen + gapExtend,
        Y[i][j - 1] + gapExtend
      )
    }
  }

  // 回溯：从 (n, m) 开始，选择三个矩阵中的最优
  const aligned1: string[] = []
  const aligned2: string[] = []
  let i = n
  let j = m

  // 确定终态
  let state: 'M' | 'X' | 'Y' = 'M'
  let bestScore = M[n][m]
  if (X[n][m] > bestScore) { bestScore = X[n][m]; state = 'X' }
  if (Y[n][m] > bestScore) { bestScore = Y[n][m]; state = 'Y' }

  while (i > 0 || j > 0) {
    if (state === 'M' && i > 0 && j > 0) {
      aligned1.push(seq1[i - 1])
      aligned2.push(seq2[j - 1])
      const matchScore = getScore(seq1[i - 1], seq2[j - 1], params, isProtein)
      // 回溯来源
      if (i > 1 && j > 1) {
        if (M[i - 1][j - 1] + matchScore === M[i][j]) { state = 'M' }
        else if (X[i - 1][j - 1] + matchScore === M[i][j]) { state = 'X' }
        else { state = 'Y' }
      } else {
        state = 'M' // 边界
      }
      i--; j--
    } else if (state === 'X' && i > 0) {
      aligned1.push(seq1[i - 1])
      aligned2.push('-')
      // 回溯来源
      if (M[i - 1][j] + gapOpen + gapExtend === X[i][j]) { state = 'M' }
      else { state = 'X' }
      i--
    } else if (state === 'Y' && j > 0) {
      aligned1.push('-')
      aligned2.push(seq2[j - 1])
      // 回溯来源
      if (M[i][j - 1] + gapOpen + gapExtend === Y[i][j]) { state = 'M' }
      else { state = 'Y' }
      j--
    } else {
      // 边界情况
      if (i > 0) { aligned1.push(seq1[i - 1]); aligned2.push('-'); i-- }
      else if (j > 0) { aligned1.push('-'); aligned2.push(seq2[j - 1]); j-- }
      else break
    }
  }

  aligned1.reverse()
  aligned2.reverse()

  const a1 = aligned1.join('')
  const a2 = aligned2.join('')

  // 计算 midline 和统计
  const midChars: string[] = []
  let matches = 0, similarCount = 0, gapCount = 0
  let s1Start = -1, s1End = -1, s2Start = -1, s2End = -1
  let s1Pos = 0, s2Pos = 0

  for (let k = 0; k < a1.length; k++) {
    const c1 = a1[k]
    const c2 = a2[k]

    if (c1 === '-' || c2 === '-') {
      midChars.push(' ')
      gapCount++
    } else if (c1.toUpperCase() === c2.toUpperCase()) {
      midChars.push('|')
      matches++
    } else if (isProtein && isSimilarAA(c1, c2)) {
      midChars.push(':')
      similarCount++
    } else {
      midChars.push(' ')
    }

    // 跟踪原始序列位置
    if (c1 !== '-') {
      if (s1Start === -1) s1Start = s1Pos
      s1End = s1Pos
      s1Pos++
    }
    if (c2 !== '-') {
      if (s2Start === -1) s2Start = s2Pos
      s2End = s2Pos
      s2Pos++
    }
  }

  const alignLen = a1.length
  const identity = alignLen > 0 ? Math.round((matches / alignLen) * 10000) / 100 : 0
  const similarity = alignLen > 0 ? Math.round(((matches + similarCount) / alignLen) * 10000) / 100 : 0

  log.debug(`NW alignment complete: score=${bestScore}, identity=${identity}%, similarity=${similarity}%, gaps=${gapCount}`)
  return {
    alignedSeq1: a1,
    alignedSeq2: a2,
    midline: midChars.join(''),
    score: bestScore,
    identity,
    similarity,
    gaps: gapCount,
    seq1Range: [Math.max(0, s1Start), s1End >= 0 ? s1End : 0],
    seq2Range: [Math.max(0, s2Start), s2End >= 0 ? s2End : 0]
  }
}
