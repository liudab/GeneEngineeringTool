/**
 * 六框翻译 + 核酸-蛋白质跨类型比对
 */

import type { AlignmentParams, AlignmentResult, TranslatedFrame } from './types'
import { translateSequence, reverseComplement } from './codonTable'
import { smithWaterman } from './smithWaterman'

/**
 * 六框翻译
 * @param nucleotideSeq 核酸序列
 * @returns 6 个翻译帧的结果
 */
export function sixFrameTranslation(nucleotideSeq: string): TranslatedFrame[] {
  const frames: TranslatedFrame[] = []
  const upper = nucleotideSeq.toUpperCase().replace(/U/g, 'T')
  const rc = reverseComplement(upper)

  // 正链三框
  for (let f = 0; f < 3; f++) {
    const protein = translateSequence(upper, f)
    const codonPositions: number[] = []
    for (let i = f; i + 2 < upper.length; i += 3) {
      codonPositions.push(i)
    }
    frames.push({ frame: f, strand: '+', protein, codonPositions })
  }

  // 反链三框
  for (let f = 0; f < 3; f++) {
    const protein = translateSequence(rc, f)
    const codonPositions: number[] = []
    for (let i = f; i + 2 < rc.length; i += 3) {
      // 映射回正链位置
      codonPositions.push(nucleotideSeq.length - 1 - (i + 2))
    }
    frames.push({ frame: f + 3, strand: '-', protein, codonPositions })
  }

  return frames
}

/**
 * 核酸-蛋白质跨类型比对
 * 将核酸六框翻译后，与蛋白质序列做 Smith-Waterman 比对
 * 返回最佳帧的比对结果
 */
export function nucleotideProteinAlignment(
  nucleotideSeq: string,
  proteinSeq: string,
  params: AlignmentParams
): { result: AlignmentResult; frame: TranslatedFrame } | null {
  const frames = sixFrameTranslation(nucleotideSeq)
  let bestResult: AlignmentResult | null = null
  let bestFrame: TranslatedFrame | null = null
  let bestScore = -Infinity

  for (const frame of frames) {
    // 去除终止密码子后的蛋白序列
    const cleanProtein = frame.protein.replace(/\*/g, 'X')
    if (cleanProtein.length < 3) continue

    const results = smithWaterman(cleanProtein, proteinSeq, params, true, 1)
    if (results.length > 0 && results[0].score > bestScore) {
      bestScore = results[0].score
      bestResult = results[0]
      bestFrame = frame
    }
  }

  if (!bestResult || !bestFrame) return null

  return { result: bestResult, frame: bestFrame }
}
