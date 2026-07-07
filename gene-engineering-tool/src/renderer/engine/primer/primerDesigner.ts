/**
 * 引物设计核心
 * 三种模式：扩增选区 / 选区内片段 / 包含选区的更长片段
 * 支持批量设计：多段选区 × 多组参数
 */

import type { PrimerDesignMode, PrimerDesignParams, PrimerDetail, DesignedPrimer, PrimerDesignResult } from './types'
import { DEFAULT_PRIMER_PARAMS } from './types'
import { calcTm, calcGc, calcThreePrimeStability, calcHairpinDG, calcDimerDG, maxHomopolymer } from './thermo'
import { scorePrimerPair } from './primerScorer'

/** 批量设计参数组合 */
export interface BatchDesignOptions {
  /** 多段选区 */
  regions: Array<{
    selectionStart: number
    selectionEnd: number
    /** 可选区域标签 */
    label?: string
  }>
  /** 多组参数（每组都会对所有区域运行） */
  paramSets?: Array<Partial<PrimerDesignParams> & { label?: string }>
  /** 设计模式 */
  mode: PrimerDesignMode
}

/** 批量设计结果 */
export interface BatchDesignResult {
  /** 所有结果（regions × paramSets 的笛卡尔积） */
  results: Array<{
    regionIndex: number
    regionLabel?: string
    paramSetIndex: number
    paramSetLabel?: string
    result: PrimerDesignResult
  }>
  /** 总耗时 ms */
  totalTimeMs: number
}

/**
 * 设计引物对
 * @param templateSeq 模板序列（完整载体/基因序列）
 * @param selectionStart 选区起始 (0-based)
 * @param selectionEnd 选区结束 (0-based, inclusive)
 * @param mode 设计模式
 * @param params 参数覆盖
 */
export function designPrimers(
  templateSeq: string,
  selectionStart: number,
  selectionEnd: number,
  mode: PrimerDesignMode,
  params?: Partial<PrimerDesignParams>
): PrimerDesignResult {
  const p: PrimerDesignParams = { ...DEFAULT_PRIMER_PARAMS, ...params }
  const seq = templateSeq.toUpperCase()
  const seqLen = seq.length

  let fwdSearchStart: number, fwdSearchEnd: number
  let revSearchStart: number, revSearchEnd: number

  switch (mode) {
    case 'amplify-region':
      // 扩增选区：正向引物在选区上游侧翼，反向引物在选区下游侧翼的反向互补
      fwdSearchStart = Math.max(0, selectionStart - p.flankRange)
      fwdSearchEnd = selectionStart
      revSearchStart = selectionEnd + 1
      revSearchEnd = Math.min(seqLen, selectionEnd + 1 + p.flankRange)
      break
    case 'within-selection':
      // 选区内片段：正向和反向引物都在选区内部
      fwdSearchStart = selectionStart
      fwdSearchEnd = Math.min(selectionEnd - p.minProductLength, selectionStart + p.flankRange)
      revSearchStart = Math.max(selectionStart + p.minProductLength, selectionEnd - p.flankRange)
      revSearchEnd = selectionEnd + 1
      break
    case 'flanking-selection':
      // 包含选区的更长片段：正向在选区上游，反向在选区下游（比 amplify-region 更远）
      fwdSearchStart = Math.max(0, selectionStart - p.flankRange)
      fwdSearchEnd = Math.max(0, selectionStart - 10)
      revSearchStart = Math.min(seqLen, selectionEnd + 10)
      revSearchEnd = Math.min(seqLen, selectionEnd + 1 + p.flankRange)
      break
    default:
      throw new Error(`Unknown mode: ${mode}`)
  }

  // 枚举候选引物
  const fwdCandidates = enumerateCandidates(seq, fwdSearchStart, fwdSearchEnd, 'forward', p)
  const revCandidates = enumerateCandidates(seq, revSearchStart, revSearchEnd, 'reverse', p)

  // 配对评分
  const pairs: DesignedPrimer[] = []
  for (const fwd of fwdCandidates) {
    for (const rev of revCandidates) {
      const productStart = fwd.position
      const productEnd = rev.position + rev.length
      const productLength = productEnd - productStart

      if (productLength < p.minProductLength || productLength > p.maxProductLength) continue

      // 交叉二聚体检测
      const crossDimerDG = calcDimerDG(fwd.sequence, rev.sequence)
      const crossDimerPenalty = crossDimerDG < p.dimerThreshold ? Math.abs(crossDimerDG) * 2 : 0

      const { pairScore, scoreBreakdown } = scorePrimerPair(fwd, rev, productLength, p)
      const adjustedScore = Math.max(0, pairScore - crossDimerPenalty)

      pairs.push({
        forward: fwd,
        reverse: rev,
        productStart,
        productEnd,
        productLength,
        pairScore: Math.round(adjustedScore * 10) / 10,
        scoreBreakdown: { ...scoreBreakdown, dimerPenalty: scoreBreakdown.dimerPenalty + Math.round(crossDimerPenalty * 100) / 100 }
      })
    }
  }

  // 按评分降序排序
  pairs.sort((a, b) => b.pairScore - a.pairScore)

  return {
    mode,
    params: p,
    pairs: pairs.slice(0, p.topN),
    forwardCandidates: fwdCandidates.length,
    reverseCandidates: revCandidates.length
  }
}

/**
 * 批量引物设计
 * 对 regions × paramSets 笛卡尔积逐一调用 designPrimers
 * @param templateSeq 模板序列
 * @param options 批量选项
 */
export function designBatchPrimers(
  templateSeq: string,
  options: BatchDesignOptions
): BatchDesignResult {
  const t0 = performance.now()
  const paramSets = options.paramSets ?? [{}]
  const results: BatchDesignResult['results'] = []

  for (let ri = 0; ri < options.regions.length; ri++) {
    const region = options.regions[ri]
    for (let pi = 0; pi < paramSets.length; pi++) {
      const ps = paramSets[pi]
      const result = designPrimers(
        templateSeq,
        region.selectionStart,
        region.selectionEnd,
        options.mode,
        ps
      )
      results.push({
        regionIndex: ri,
        regionLabel: region.label,
        paramSetIndex: pi,
        paramSetLabel: ps.label,
        result
      })
    }
  }

  return {
    results,
    totalTimeMs: Math.round((performance.now() - t0) * 100) / 100
  }
}

function enumerateCandidates(
  seq: string,
  searchStart: number,
  searchEnd: number,
  direction: 'forward' | 'reverse',
  params: PrimerDesignParams
): PrimerDetail[] {
  const candidates: PrimerDetail[] = []
  const seqLen = seq.length

  for (let pos = searchStart; pos < searchEnd && pos < seqLen; pos++) {
    for (let len = params.minLength; len <= params.maxLength; len++) {
      let primerSeq: string
      let primerPos: number

      if (direction === 'forward') {
        if (pos + len > seqLen) continue
        primerSeq = seq.substring(pos, pos + len)
        primerPos = pos
      } else {
        // 反向引物：取反向互补
        if (pos + len > seqLen) continue
        primerSeq = reverseComplement(seq.substring(pos, pos + len))
        primerPos = pos
      }

      // 基本过滤
      if (hasAmbiguousBases(primerSeq)) continue
      if (maxHomopolymer(primerSeq) > params.maxHomopolymer) continue

      // 计算热力学参数
      const tm = calcTm(primerSeq)
      if (tm < params.minTm || tm > params.maxTm) continue

      const gc = calcGc(primerSeq)
      if (gc < params.minGc || gc > params.maxGc) continue

      // GC clamp: 3'端最后碱基应为 G 或 C
      const lastBase = primerSeq[primerSeq.length - 1]
      if (lastBase !== 'G' && lastBase !== 'C') {
        // 不直接排除，但后面评分会扣分
      }

      const threePrimeDG = calcThreePrimeStability(primerSeq)
      const hairpinDG = calcHairpinDG(primerSeq)
      const homodimerDG = calcDimerDG(primerSeq, primerSeq)

      candidates.push({
        sequence: primerSeq,
        position: primerPos,
        length: len,
        tm, gc,
        threePrimeDG,
        hairpinDG,
        homodimerDG
      })
    }
  }

  // 按 Tm 接近 optimal 排序，取前 N 个
  candidates.sort((a, b) => Math.abs(a.tm - params.optimalTm) - Math.abs(b.tm - params.optimalTm))
  return candidates.slice(0, 100) // 限制候选数量
}

function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}

function hasAmbiguousBases(seq: string): boolean {
  return /[^ATCG]/i.test(seq)
}
