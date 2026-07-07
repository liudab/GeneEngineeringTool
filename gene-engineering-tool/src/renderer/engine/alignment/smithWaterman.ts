/**
 * Smith-Waterman 局部比对算法
 * 使用仿射空位罚分模型
 * 可返回多条不重叠的局部比对结果
 */

import type { AlignmentParams, AlignmentResult } from './types'
import { getScore, isSimilarAA } from './scoring'

/**
 * Smith-Waterman 局部比对
 */
export function smithWaterman(
  seq1: string,
  seq2: string,
  params: AlignmentParams,
  isProtein: boolean = false,
  topK: number = 1
): AlignmentResult[] {
  const n = seq1.length
  const m = seq2.length
  const { gapOpen, gapExtend } = params

  // 三矩阵
  const H: number[][] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1) as any) as any // 主矩阵
  const E: number[][] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1) as any) as any // seq1 gap
  const F: number[][] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1) as any) as any // seq2 gap

  // 初始化全 0（Smith-Waterman 特有）
  // 已由 Float64Array 默认值保证

  // 填充矩阵
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = getScore(seq1[i - 1], seq2[j - 1], params, isProtein)

      // E: gap in seq2 (水平)
      E[i][j] = Math.max(
        H[i][j - 1] + gapOpen + gapExtend,
        E[i][j - 1] + gapExtend
      )

      // F: gap in seq1 (垂直)
      F[i][j] = Math.max(
        H[i - 1][j] + gapOpen + gapExtend,
        F[i - 1][j] + gapExtend
      )

      // H: 匹配或从 gap 态回来
      H[i][j] = Math.max(
        0, // Smith-Waterman: 不允许负分
        H[i - 1][j - 1] + s,
        E[i][j],
        F[i][j]
      )
    }
  }

  // 收集 top-K 不重叠的局部比对
  const results: AlignmentResult[] = []
  const usedCells = new Set<string>()

  for (let k = 0; k < topK; k++) {
    // 找最高分（排除已使用的区域）
    let maxScore = 0
    let maxI = 0, maxJ = 0
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (H[i][j] > maxScore && !usedCells.has(`${i},${j}`)) {
          maxScore = H[i][j]
          maxI = i
          maxJ = j
        }
      }
    }

    if (maxScore <= 0) break

    // 回溯
    const result = traceback(H, E, F, seq1, seq2, params, isProtein, maxI, maxJ, usedCells)
    if (result) results.push(result)
  }

  return results
}

function traceback(
  H: number[][], E: number[][], F: number[][],
  seq1: string, seq2: string,
  params: AlignmentParams, isProtein: boolean,
  startI: number, startJ: number,
  usedCells: Set<string>
): AlignmentResult | null {
  const { gapOpen, gapExtend } = params
  const aligned1: string[] = []
  const aligned2: string[] = []
  let i = startI, j = startJ

  while (i > 0 && j > 0 && H[i][j] > 0) {
    usedCells.add(`${i},${j}`)

    const s = getScore(seq1[i - 1], seq2[j - 1], params, isProtein)

    // 确定来源
    if (H[i][j] === H[i - 1][j - 1] + s) {
      aligned1.push(seq1[i - 1])
      aligned2.push(seq2[j - 1])
      i--; j--
    } else if (H[i][j] === E[i][j]) {
      aligned1.push('-')
      aligned2.push(seq2[j - 1])
      j--
    } else if (H[i][j] === F[i][j]) {
      aligned1.push(seq1[i - 1])
      aligned2.push('-')
      i--
    } else {
      break
    }
  }

  aligned1.reverse()
  aligned2.reverse()

  const a1 = aligned1.join('')
  const a2 = aligned2.join('')
  if (a1.length === 0) return null

  // 计算 midline 和统计
  const midChars: string[] = []
  let matches = 0, similarCount = 0, gapCount = 0
  let s1Start = -1, s1End = -1, s2Start = -1, s2End = -1
  let s1Pos = i, s2Pos = j // 回溯结束位置就是起始位置

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

  return {
    alignedSeq1: a1,
    alignedSeq2: a2,
    midline: midChars.join(''),
    score: H[startI][startJ],
    identity,
    similarity,
    gaps: gapCount,
    seq1Range: [Math.max(0, s1Start), s1End >= 0 ? s1End : 0],
    seq2Range: [Math.max(0, s2Start), s2End >= 0 ? s2End : 0]
  }
}
