/**
 * 引物设计模块 — 统一导出
 */

export type {
  PrimerDesignMode, PrimerDesignParams, PrimerDetail,
  DesignedPrimer, PrimerDesignResult, ScoreBreakdown
} from './types'
export { DEFAULT_PRIMER_PARAMS } from './types'
export { calcTm, calcGc, calcThreePrimeStability, calcHairpinDG, calcDimerDG, maxHomopolymer } from './thermo'
export { scorePrimerPair } from './primerScorer'
export { designPrimers, designBatchPrimers } from './primerDesigner'
export type { BatchDesignOptions, BatchDesignResult } from './primerDesigner'

import type { PrimerDesignResult, DesignedPrimer } from './types'

/**
 * 导出引物设计结果为 FASTA 格式
 */
export function exportPrimerToFasta(result: PrimerDesignResult): string {
  const lines: string[] = []
  lines.push(`# Primer Design Result — Mode: ${result.mode}`)
  lines.push(`# Forward candidates: ${result.forwardCandidates}, Reverse candidates: ${result.reverseCandidates}`)
  lines.push(`# Top ${result.pairs.length} pairs`)
  lines.push('')

  for (let i = 0; i < result.pairs.length; i++) {
    const pair = result.pairs[i]
    lines.push(`# Pair ${i + 1} — Score: ${pair.pairScore}, Product: ${pair.productLength} bp`)
    lines.push(`>Forward_${i + 1} | pos:${pair.forward.position} len:${pair.forward.length} Tm:${pair.forward.tm}°C GC:${pair.forward.gc}%`)
    lines.push(pair.forward.sequence)
    lines.push(`>Reverse_${i + 1} | pos:${pair.reverse.position} len:${pair.reverse.length} Tm:${pair.reverse.tm}°C GC:${pair.reverse.gc}%`)
    lines.push(pair.reverse.sequence)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 导出引物设计结果为 CSV 格式
 */
export function exportPrimerToCSV(result: PrimerDesignResult): string {
  const header = [
    'PairIndex', 'Score',
    'FwdSeq', 'FwdPos', 'FwdLen', 'FwdTm', 'FwdGC', 'Fwd3pDG', 'FwdHairpin', 'FwdHomodimer',
    'RevSeq', 'RevPos', 'RevLen', 'RevTm', 'RevGC', 'Rev3pDG', 'RevHairpin', 'RevHomodimer',
    'ProductStart', 'ProductEnd', 'ProductLength'
  ].join(',')

  const rows: string[] = [header]

  for (let i = 0; i < result.pairs.length; i++) {
    const p = result.pairs[i]
    rows.push([
      i + 1,
      p.pairScore,
      `"${p.forward.sequence}"`, p.forward.position, p.forward.length, p.forward.tm, p.forward.gc,
      p.forward.threePrimeDG, p.forward.hairpinDG, p.forward.homodimerDG,
      `"${p.reverse.sequence}"`, p.reverse.position, p.reverse.length, p.reverse.tm, p.reverse.gc,
      p.reverse.threePrimeDG, p.reverse.hairpinDG, p.reverse.homodimerDG,
      p.productStart, p.productEnd, p.productLength
    ].join(','))
  }

  return rows.join('\n')
}
