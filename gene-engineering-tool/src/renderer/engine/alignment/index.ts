/**
 * 序列比对模块 — 统一导出
 */

export type { AlignmentType, AlignmentParams, AlignmentResult, AlignmentOutput, TranslatedFrame } from './types'
export { DEFAULT_NUCLEOTIDE_PARAMS, DEFAULT_PROTEIN_PARAMS } from './types'
export { needlemanWunsch } from './needlemanWunsch'
export { smithWaterman } from './smithWaterman'
export { sixFrameTranslation, nucleotideProteinAlignment } from './sixFrameTranslation'
export { translateSequence, reverseComplement } from './codonTable'
export { blosum62Score, isSimilarAA, getScore } from './scoring'

import type { AlignmentParams, AlignmentOutput } from './types'
import { DEFAULT_NUCLEOTIDE_PARAMS, DEFAULT_PROTEIN_PARAMS } from './types'
import { needlemanWunsch } from './needlemanWunsch'
import { smithWaterman } from './smithWaterman'
import { nucleotideProteinAlignment } from './sixFrameTranslation'
import type { AlignmentType } from './types'

/**
 * 统一比对入口
 * @param seq1 序列1
 * @param seq2 序列2
 * @param type 比对类型
 * @param params 可选参数覆盖
 * @param seq1Name 序列1名称
 * @param seq2Name 序列2名称
 */
export function alignSequences(
  seq1: string,
  seq2: string,
  type: AlignmentType,
  params?: Partial<AlignmentParams>,
  seq1Name?: string,
  seq2Name?: string
): AlignmentOutput {
  const isProtein = type === 'protein'
  const defaults = isProtein ? DEFAULT_PROTEIN_PARAMS : DEFAULT_NUCLEOTIDE_PARAMS
  const fullParams: AlignmentParams = { ...defaults, ...params }

  switch (type) {
    case 'nucleotide-nw': {
      const result = needlemanWunsch(seq1, seq2, fullParams, false)
      return { type, params: fullParams, results: [result], seq1Name, seq2Name }
    }
    case 'nucleotide-sw': {
      const results = smithWaterman(seq1, seq2, fullParams, false, 5)
      return { type, params: fullParams, results, seq1Name, seq2Name }
    }
    case 'protein': {
      const result = needlemanWunsch(seq1, seq2, fullParams, true)
      return { type, params: fullParams, results: [result], seq1Name, seq2Name }
    }
    case 'nucleotide-protein': {
      const result = nucleotideProteinAlignment(seq1, seq2, fullParams)
      if (result) {
        return {
          type, params: fullParams, results: [result.result],
          translationFrame: result.frame.frame, seq1Name, seq2Name
        }
      }
      return { type, params: fullParams, results: [], seq1Name, seq2Name }
    }
    default:
      throw new Error(`Unknown alignment type: ${type}`)
  }
}

/**
 * 导出比对结果为 FASTA 格式
 */
export function exportAlignmentToFasta(output: AlignmentOutput): string {
  const lines: string[] = []
  for (let i = 0; i < output.results.length; i++) {
    const r = output.results[i]
    const n1 = output.seq1Name || 'Sequence1'
    const n2 = output.seq2Name || 'Sequence2'
    if (output.results.length > 1) {
      lines.push(`# Alignment ${i + 1} (Score: ${r.score}, Identity: ${r.identity}%)`)
    }
    lines.push(`>${n1}`)
    lines.push(r.alignedSeq1)
    lines.push(`>${n2}`)
    lines.push(r.alignedSeq2)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * 导出比对结果为 CSV 格式
 */
export function exportAlignmentToCSV(output: AlignmentOutput): string {
  const lines: string[] = [
    'Index,Score,Identity%,Similarity%,Gaps,Seq1Range,Seq2Range,AlignedSeq1,AlignedSeq2,Midline'
  ]
  for (let i = 0; i < output.results.length; i++) {
    const r = output.results[i]
    lines.push([
      i + 1,
      r.score,
      r.identity,
      r.similarity,
      r.gaps,
      `${r.seq1Range[0]}-${r.seq1Range[1]}`,
      `${r.seq2Range[0]}-${r.seq2Range[1]}`,
      `"${r.alignedSeq1}"`,
      `"${r.alignedSeq2}"`,
      `"${r.midline}"`
    ].join(','))
  }
  return lines.join('\n')
}
