/**
 * 引物设计核心
 * 三种模式：扩增选区 / 选区内片段 / 包含选区的更长片段
 * 支持批量设计：多段选区 × 多组参数
 */

import type { PrimerDesignMode, PrimerDesignParams, PrimerDetail, DesignedPrimer, PrimerDesignResult, FailureReasons, FunnelStage, DiagnosticSuggestion, IterationInfo, PairingFunnelStage, RecommendedPcrConditions } from './types'
import { DEFAULT_PRIMER_PARAMS } from './types'
import { calcTm, calcGc, calcThreePrimeStability, calcHairpinDG, calcDimerDG, maxHomopolymer, calcSelfComplementarity, calcSelfThreePrimeComplementarity, calcPairThreePrimeComplementarity, calcPalindromeLength, calcHairpinThreePrimeDG } from './thermo'
import { scorePrimerPair, calcPcrScore } from './primerScorer'
import { checkSpecificity } from './specificityChecker'
import { runInSilicoPcr } from './inSilicoPcr'
import { createLogger } from '../../utils/logger'

const log = createLogger('PrimerDesigner')

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

/** 获取上游/下游侧翼范围（兼容旧的 flankRange 参数） */
function getFlankRanges(p: PrimerDesignParams): { upstream: number; downstream: number } {
  return {
    upstream: p.upstreamFlankRange ?? p.flankRange ?? 300,
    downstream: p.downstreamFlankRange ?? p.flankRange ?? 300,
  }
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
  log.info(`Designing primers: mode=${mode}, selection=[${selectionStart}, ${selectionEnd}], template=${templateSeq.length}bp`)
  const p: PrimerDesignParams = { ...DEFAULT_PRIMER_PARAMS, ...params }
  const seq = templateSeq.toUpperCase()
  const seqLen = seq.length
  const { upstream, downstream } = getFlankRanges(p)

  // amplify-region 模式：产物长度 = 选区长度，自动调整过滤范围
  // 避免固定默认值（100-1000bp）过滤掉大选区（如 2000bp）的有效引物对
  if (mode === 'amplify-region') {
    const selectionLength = selectionEnd - selectionStart + 1
    // edgeSearchDepth 固定为 0，margin 仅考虑引物长度容差
    const margin = p.maxLength * 2
    // 仅在默认范围无法容纳选区时自动扩展
    if (p.minProductLength > selectionLength - margin) {
      p.minProductLength = Math.max(50, selectionLength - margin)
    }
    if (p.maxProductLength < selectionLength + margin) {
      p.maxProductLength = selectionLength + margin
    }
    // GC 范围自适应：基因首尾 GC 含量可能极端，40-60% 默认范围过窄
    // 参照 Primer3 允许 GC 20-80%；仅在默认值时自动扩展，用户自定义值不受影响
    if (p.minGc === 40) p.minGc = 30
    if (p.maxGc === 60) p.maxGc = 70
    // Tm 范围自适应：端部引物 Tm 可能偏低（AT-rich 3'端）或偏高（GC-rich 5'端）
    // SL98 ΔS 盐校正 + Ct 模型与 Vector NTI 偏差约 3-8°C，42-70°C 宽范围兼容
    if (p.minTm === 55) p.minTm = 42
    if (p.maxTm === 65) p.maxTm = 70
    // 引物长度自适应：Vector NTI 可设计 29-31bp 引物，默认 30bp 上限不足
    if (p.maxLength === 30) p.maxLength = 35
    // 自互补阈值自适应：基因端部序列可能含有天然自互补结构
    // 默认 8 对某些基因过于严格（Vector NTI 允许更高）
    if (p.maxSelfComplementarity === 8) p.maxSelfComplementarity = 20
    // Tm 差异阈值自适应：因 Tm 系统性低估，AT-rich 反向引物 Tm 偏差放大
    // Vector NTI 允许 Tm 差 3.1°C 的引物对，我们的模型计算结果为 6.0°C
    if (p.maxTmDiff === 5.0) p.maxTmDiff = 8.0
    // GC 差异阈值自适应：基因首尾 GC% 可能差异显著（OsNAC25 #4 达 15.2%）
    if (p.maxGcDiff === 10.0) p.maxGcDiff = 20.0
  }

  // relaxedProductLength 模式：放宽产物长度过滤以换取更高质量引物
  // 仅对 within-selection / flanking-selection 模式生效
  const isRelaxed = p.relaxedProductLength && mode !== 'amplify-region'
  if (isRelaxed) {
    p.minProductLength = Math.max(50, Math.round(p.minProductLength * 0.5))
    p.maxProductLength = Math.round(p.maxProductLength * 2.0)
  }

  let fwdSearchStart: number, fwdSearchEnd: number
  let revSearchStart: number, revSearchEnd: number

  // flanking-selection 回退标志：当回退到 amplify-region 时，需要应用 amplify-region 的边界约束
  let flankingFallback = false
  // flanking-selection 无下游标志：反向引物必须终止于 selectionEnd
  let flankingNoDownstream = false

  switch (mode) {
    case 'amplify-region': {
      // 扩增选区：引物紧贴选区边缘，产物=选区长度
      // edgeSearchDepth 固定为 0，引物必须精确贴合选区边缘
      const depth = 0
      // 正向引物搜索窗口：固定在 selectionStart
      fwdSearchStart = selectionStart
      fwdSearchEnd = Math.min(selectionStart + 1, selectionEnd)
      // 反向引物搜索窗口：反向引物在 pos 位置、长度 len 时产物终止于 pos+len-1
      // 要使产物精确贴合选区，需要 pos+len-1 = selectionEnd，即 pos = selectionEnd - len + 1
      // pos 有效范围：[selectionEnd - maxLength + 1, selectionEnd - minLength + 1]
      revSearchStart = Math.max(fwdSearchEnd + 1, selectionEnd - p.maxLength + 1)
      revSearchEnd = Math.min(seqLen, selectionEnd - p.minLength + 1)
      // 正向引物边界收缩：当窗口右端超出可容纳 maxLength 的范围时，向左移入序列内部
      const fwdMaxPos = seqLen - p.maxLength
      if (fwdSearchEnd > fwdMaxPos) {
        fwdSearchEnd = Math.max(fwdSearchStart + 1, fwdMaxPos)
      }
      break
    }
    case 'within-selection': {
      // 选区内片段：正反向引物都在选区内部
      // 反向引物在 pos 位置、长度 len 时产物终止于 pos + len - 1
      // 理想产物长度 = optimalProductLength → 反向引物理想位置 ≈ selectionStart + optimalProductLength - avgLen
      const avgLen = Math.round((p.minLength + p.maxLength) / 2)
      const idealRevStart = selectionStart + p.optimalProductLength - avgLen
      // 正向：选区前半段（给反向窗口留空间），上限 selectionEnd - minProductLength + 1
      fwdSearchStart = selectionStart
      fwdSearchEnd = Math.max(fwdSearchStart + 1, Math.min(selectionEnd - p.minProductLength + 1, idealRevStart))
      // 反向：围绕 idealRevStart 扩展，上限 selectionEnd + 1
      revSearchStart = Math.max(fwdSearchEnd, selectionStart + p.minLength - p.maxLength)
      revSearchEnd = Math.min(selectionEnd + 1, idealRevStart + p.optimalProductLength)
      break
    }
    case 'flanking-selection': {
      // 包含选区的更长片段：正向在选区上游侧翼，反向在选区下游侧翼
      // 正向引物搜索窗口：[selectionStart - upstream, selectionStart) — 必须在选区上游
      // 反向引物搜索窗口：[selectionEnd + 1, selectionEnd + 1 + downstream) — 必须在选区下游
      // 侧翼空间判断：不仅检查是否有侧翼序列，还要检查是否足以容纳最小引物长度
      // 否则搜索窗口内的位置都无法生成有效候选（如仅 1bp 下游无法生成 ≥18bp 引物）
      const hasUpstream = selectionStart >= p.minLength
      const hasDownstream = (seqLen - selectionEnd - 1) >= p.minLength

      if (hasUpstream && hasDownstream) {
        // === 两侧都有侧翼序列，正常 flanking-selection ===
        fwdSearchStart = Math.max(0, selectionStart - upstream)
        fwdSearchEnd = selectionStart
        revSearchStart = selectionEnd + 1
        revSearchEnd = Math.min(seqLen, selectionEnd + 1 + downstream)
      } else if (!hasUpstream && !hasDownstream) {
        // === 两侧都无侧翼序列（如全长选区），回退到 amplify-region ===
        log.warn(`[flanking-selection] 选区 [${selectionStart},${selectionEnd}] 两侧都无侧翼序列，回退到 amplify-region 模式`)
        flankingFallback = true

        // amplify-region 自适应参数
        const selectionLength = selectionEnd - selectionStart + 1
        const margin = p.maxLength * 2
        if (p.minProductLength > selectionLength - margin) p.minProductLength = Math.max(50, selectionLength - margin)
        if (p.maxProductLength < selectionLength + margin) p.maxProductLength = selectionLength + margin
        if (p.minGc === 40) p.minGc = 30
        if (p.maxGc === 60) p.maxGc = 70
        if (p.minTm === 55) p.minTm = 42
        if (p.maxTm === 65) p.maxTm = 70
        if (p.maxLength === 30) p.maxLength = 35
        if (p.maxSelfComplementarity === 8) p.maxSelfComplementarity = 20
        if (p.maxTmDiff === 5.0) p.maxTmDiff = 8.0
        if (p.maxGcDiff === 10.0) p.maxGcDiff = 20.0

        fwdSearchStart = selectionStart
        fwdSearchEnd = Math.min(selectionStart + 1, selectionEnd)
        revSearchStart = Math.max(fwdSearchEnd + 1, selectionEnd - p.maxLength + 1)
        revSearchEnd = Math.min(seqLen, selectionEnd - p.minLength + 1)
        const fwdMaxPos = seqLen - p.maxLength
        if (fwdSearchEnd > fwdMaxPos) fwdSearchEnd = Math.max(fwdSearchStart + 1, fwdMaxPos)
      } else if (!hasUpstream && hasDownstream) {
        // === 无上游侧翼，正向固定在选区起始位置，反向正常搜索下游侧翼 ===
        log.info(`[flanking-selection] 无上游侧翼，正向引物固定在选区起始位置 ${selectionStart}，反向在 [${selectionEnd + 1}, ${Math.min(seqLen, selectionEnd + 1 + downstream)}) 搜索`)
        fwdSearchStart = selectionStart
        fwdSearchEnd = selectionStart + 1  // 仅 pos=selectionStart
        revSearchStart = selectionEnd + 1
        revSearchEnd = Math.min(seqLen, selectionEnd + 1 + downstream)
      } else {
        // === 无下游侧翼，正向正常搜索上游侧翼，反向固定在选区结束位置 ===
        // 反向引物必须终止于 selectionEnd：pos + len - 1 = selectionEnd → pos = selectionEnd - len + 1
        log.info(`[flanking-selection] 无下游侧翼，正向在 [${Math.max(0, selectionStart - upstream)}, ${selectionStart}) 搜索，反向固定在选区结束位置附近`)
        flankingNoDownstream = true
        fwdSearchStart = Math.max(0, selectionStart - upstream)
        fwdSearchEnd = selectionStart
        revSearchStart = Math.max(fwdSearchEnd + 1, selectionEnd - p.maxLength + 1)
        revSearchEnd = Math.min(seqLen, selectionEnd - p.minLength + 1)
      }
      break
    }
    default:
      throw new Error(`Unknown mode: ${mode}`)
  }

  // 通用安全钳位：确保搜索窗口内的位置能容纳完整引物
  // 正向引物：需要 pos + maxLength <= seqLen（否则所有长度都会越界）
  // 反向引物：只需 pos + minLength <= seqLen（更长的 len 越界时仅该长度被跳过，仍可有更短有效引物）
  const fwdSafeMaxPos = seqLen - p.maxLength
  const revSafeMaxPos = seqLen - p.minLength
  if (fwdSearchEnd > fwdSafeMaxPos) fwdSearchEnd = Math.max(fwdSearchStart + 1, fwdSafeMaxPos)
  if (revSearchEnd > revSafeMaxPos) revSearchEnd = Math.max(revSearchStart + 1, revSafeMaxPos)
  fwdSearchStart = Math.max(0, fwdSearchStart)
  fwdSearchEnd = Math.max(fwdSearchStart + 1, fwdSearchEnd)
  revSearchStart = Math.max(0, revSearchStart)
  revSearchEnd = Math.max(revSearchStart + 1, revSearchEnd)

  // 枚举候选引物（带失败原因统计）
  // 特异性检查使用扩展的 target 区域，包含引物可能结合的侧翼范围
  // 避免将扩增模式下选区外侧的正确引物结合位点误判为 off-target
  const specMargin = p.maxLength + 10 // 扩展余量 = 最大引物长度 + 10bp
  const specTargetStart = Math.max(0, selectionStart - specMargin)
  const specTargetEnd = Math.min(seqLen - 1, selectionEnd + specMargin)
  const useSpec = p.enableSpecificityCheck

  // 预计算权重放宽阈值（weight=1~8 时渐进放宽硬过滤，weight=9 为基准，weight=10 收紧）
  const rt = computeRelaxedThresholds(p)

  const fwdResult = enumerateCandidatesWithReasons(seq, fwdSearchStart, fwdSearchEnd, 'forward', p, useSpec ? specTargetStart : -1, useSpec ? specTargetEnd : -1, rt)
  const revResult = enumerateCandidatesWithReasons(seq, revSearchStart, revSearchEnd, 'reverse', p, useSpec ? specTargetStart : -1, useSpec ? specTargetEnd : -1, rt)

  const fwdCandidates = fwdResult.candidates
  const revCandidates = revResult.candidates

  // Soft fallback: 若严格过滤后某方向候选不足 2 条，用放宽阈值重新枚举
  // 避免用户手动反复放宽条件；仅在首轮严格无候选时触发
  if (fwdResult.candidates.length < 2 || revResult.candidates.length < 2) {
    const relaxedRt = computeRelaxedThresholds({
      ...p,
      minTm: p.minTm - 3,
      maxTm: p.maxTm + 3,
      minGc: Math.max(20, p.minGc - 10),
      maxGc: Math.min(80, p.maxGc + 10),
    })
    if (fwdResult.candidates.length < 2) {
      const fallback = enumerateCandidatesWithReasons(seq, fwdSearchStart, fwdSearchEnd, 'forward', p, useSpec ? specTargetStart : -1, useSpec ? specTargetEnd : -1, relaxedRt)
      if (fallback.candidates.length > fwdResult.candidates.length) {
        fwdResult.candidates = fallback.candidates
        fwdResult.reasons = fallback.reasons
        log.info(`[soft-fallback] 正向引物: 严格=${fwdResult.candidates.length} → 放宽=${fallback.candidates.length}`)
      }
    }
    if (revResult.candidates.length < 2) {
      const fallback = enumerateCandidatesWithReasons(seq, revSearchStart, revSearchEnd, 'reverse', p, useSpec ? specTargetStart : -1, useSpec ? specTargetEnd : -1, relaxedRt)
      if (fallback.candidates.length > revResult.candidates.length) {
        revResult.candidates = fallback.candidates
        revResult.reasons = fallback.reasons
        log.info(`[soft-fallback] 反向引物: 严格=${revResult.candidates.length} → 放宽=${fallback.candidates.length}`)
      }
    }
  }

  // amplify-region 模式：枚举阶段后置边界约束
  // 反向引物必须满足 pos + len = selectionEnd + 1（产物精确贴合选区右边缘）
  // 正向引物已由搜索窗口保证 pos = selectionStart，无需额外过滤
  // flanking-selection 回退时和无下游时也需应用此约束
  if (mode === 'amplify-region' || flankingFallback || flankingNoDownstream) {
    for (let i = revCandidates.length - 1; i >= 0; i--) {
      if (revCandidates[i].position + revCandidates[i].length !== selectionEnd + 1) {
        revCandidates.splice(i, 1)
      }
    }
    log.info(`[amplify-region] 反向引物边界约束: 保留 ${revCandidates.length} 条候选 (pos+len=${selectionEnd + 1})`)
  }

  // 正反向分离的失败原因
  const fwdReasons = fwdResult.reasons
  const revReasons = revResult.reasons

  const failureReasons: FailureReasons = {
    fwdTotalEnumerated: fwdReasons.fwdTotalEnumerated,
    revTotalEnumerated: revReasons.revTotalEnumerated,
    fwdFilteredByLength: fwdReasons.fwdFilteredByLength,
    revFilteredByLength: revReasons.revFilteredByLength,
    fwdFilteredByTm: fwdReasons.fwdFilteredByTm,
    revFilteredByTm: revReasons.revFilteredByTm,
    fwdFilteredByGc: fwdReasons.fwdFilteredByGc,
    revFilteredByGc: revReasons.revFilteredByGc,
    fwdFilteredByHomopolymer: fwdReasons.fwdFilteredByHomopolymer,
    revFilteredByHomopolymer: revReasons.revFilteredByHomopolymer,
    fwdFilteredByComplementarity: fwdReasons.fwdFilteredByComplementarity,
    revFilteredByComplementarity: revReasons.revFilteredByComplementarity,
    fwdFilteredBySpecificity: fwdReasons.fwdFilteredBySpecificity,
    revFilteredBySpecificity: revReasons.revFilteredBySpecificity,
    validForward: fwdCandidates.length,
    validReverse: revCandidates.length,
    failedPairing: 0,
    filteredByProductLength: 0,
    filteredByBoundary: 0,
    filteredByInSilicoPcr: 0,
    filteredByPairComplementarity: 0,
    fwdFilteredByPalindrome: fwdReasons.fwdFilteredByPalindrome,
    revFilteredByPalindrome: revReasons.revFilteredByPalindrome,
    fwdFilteredByThreePrimeSelfCompl: fwdReasons.fwdFilteredByThreePrimeSelfCompl,
    revFilteredByThreePrimeSelfCompl: revReasons.revFilteredByThreePrimeSelfCompl,
    filteredByTmDiff: 0,
    filteredByGcDiff: 0,
    filteredByAmpliconGc: 0,
    filteredByPairDimerDG: 0,
    filteredByPairThreePrimeDG: 0
  }

  // 配对评分
  const pairs: DesignedPrimer[] = []
  let filteredByProductLength = 0
  let filteredByBoundary = 0
  let filteredByInSilicoPcr = 0
  let filteredByPairComplementarity = 0
  let filteredByTmDiff = 0
  let filteredByGcDiff = 0
  let filteredByAmpliconGc = 0
  let filteredByPairDimerDG = 0
  let filteredByPairThreePrimeDG = 0
  const totalPairsAttempted = fwdCandidates.length * revCandidates.length

  for (const fwd of fwdCandidates) {
    for (const rev of revCandidates) {
      const productStart = fwd.position
      const productEnd = rev.position + rev.length
      const productLength = productEnd - productStart

      // 产物长度过滤：flanking-selection 模式跳过（产物长度由侧翼范围隐式决定）
      // flanking-selection 回退到 amplify-region 时仍需过滤
      if (mode !== 'flanking-selection' || flankingFallback) {
        if (productLength < p.minProductLength || productLength > p.maxProductLength) {
          filteredByProductLength++
          continue
        }
      }

      // amplify-region 模式：枚举阶段已保证边界贴合，无需配对阶段检查
      // 正向引物 pos = selectionStart（搜索窗口保证）
      // 反向引物 pos + len = selectionEnd + 1（后置过滤保证）

      // 显式 Tm 差过滤（权重=0 跳过；权重 1-8 渐进放宽容差）
      const tmDiff = Math.abs(fwd.tm - rev.tm)
      if (p.weights.tmDiff > 0 && tmDiff > rt.maxTmDiff) {
        filteredByTmDiff++
        continue
      }

      // 显式 GC 差过滤（权重=0 跳过；权重 1-8 渐进放宽容差）
      const gcDiff = Math.abs(fwd.gc - rev.gc)
      if (p.weights.gcDiff > 0 && gcDiff > rt.maxGcDiff) {
        filteredByGcDiff++
        continue
      }

      // 引物间二聚体 dG 过滤（权重=0 跳过；权重 1-8 渐进放宽阈值）
      const crossDimerDG = calcDimerDG(fwd.sequence, rev.sequence)
      if (p.weights.dimer > 0 && crossDimerDG < rt.maxPairDimerDG) {
        filteredByPairDimerDG++
        continue
      }

      // 3'端互补 dG 过滤（权重=0 跳过；权重 1-8 渐进放宽阈值）
      const fwdThreePrime = fwd.sequence.substring(Math.max(0, fwd.sequence.length - 10))
      const revThreePrime = rev.sequence.substring(Math.max(0, rev.sequence.length - 10))
      const pairThreePrimeDG = calcDimerDG(fwdThreePrime, revThreePrime)
      if (p.weights.threePrime > 0 && pairThreePrimeDG < rt.maxPairThreePrimeDG) {
        filteredByPairThreePrimeDG++
        continue
      }

      // 扩增子 GC 过滤（权重=0 跳过；权重 1-8 渐进放宽范围）
      const ampliconSeq = seq.substring(productStart, productEnd)
      const ampliconGc = calcGc(ampliconSeq)
      if (p.weights.gc > 0 && (ampliconGc < rt.minAmpliconGc || ampliconGc > rt.maxAmpliconGc)) {
        filteredByAmpliconGc++
        continue
      }

      // 引物对 3'端互补性检测（权重=0 跳过；权重 1-8 渐进放宽阈值）
      const pairThreePrimeCompl = calcPairThreePrimeComplementarity(fwd.sequence, rev.sequence)
      if (p.weights.threePrime > 0 && pairThreePrimeCompl > rt.maxPairThreePrimeComplementarity) {
        filteredByPairComplementarity++
        continue
      }

      const { pairScore, scoreBreakdown } = scorePrimerPair(fwd, rev, productLength, p, mode, selectionStart, selectionEnd, crossDimerDG, fwd.palindromeLength, rev.palindromeLength)

      // PCR 适用性评分（基于发夹/二聚体 ΔG 的连续评分模型）
      const { pcrScore, pcrGrade } = calcPcrScore(
        fwd, rev,
        fwd.homodimerDG, rev.homodimerDG, crossDimerDG,
        fwd.hairpinDG, rev.hairpinDG
      )

      // 推荐 PCR 反应条件
      // 退火温度: min(Tm_fwd, Tm_rev) - 3°C, 下限 48°C
      //   文献: Rychlik 1990 NAR — Ta = Tm - 3~5°C
      // 延伸时间: productLength / 1000 × 60 秒 (Taq ~1kb/min)
      //   文献: Saiki 1988 Science
      // 循环数: ≤500bp→30, ≤1kb→35, >1kb→40
      const annealingTemp = Math.max(48, Math.round(Math.min(fwd.tm, rev.tm) - 3))
      const extensionTimeSec = Math.max(30, Math.round(productLength / 1000 * 60))
      const cycles = productLength <= 500 ? 30 : productLength <= 1000 ? 35 : 40
      const recommendedPcrConditions: RecommendedPcrConditions = {
        annealingTemp,
        extensionTimeSec,
        cycles,
        denaturationTemp: 95,
        denaturationTimeSec: 30
      }

      // In-silico PCR 验证（可选）
      let specificityInfo: DesignedPrimer['specificity'] | undefined
      if (p.enableInSilicoPcr && fwdCandidates.length < 80 && revCandidates.length < 80) {
        const pcrResult = runInSilicoPcr(fwd.sequence, rev.sequence, seq, productStart, productEnd, 2, p.maxProductLength)
        specificityInfo = {
          fwdOffTargets: fwd.offTargetCount ?? 0,
          revOffTargets: rev.offTargetCount ?? 0,
          isSpecific: pcrResult.isSpecific
        }
        if (!pcrResult.isSpecific) {
          filteredByInSilicoPcr++
          continue
        }
      } else {
        specificityInfo = {
          fwdOffTargets: fwd.offTargetCount ?? 0,
          revOffTargets: rev.offTargetCount ?? 0,
          isSpecific: true
        }
      }

      // 5'端尾序列拼接
      let finalFwd = fwd
      let finalRev = rev
      if (p.fwdFivePrimeTail) {
        finalFwd = { ...fwd, sequence: p.fwdFivePrimeTail + fwd.sequence }
      }
      if (p.revFivePrimeTail) {
        finalRev = { ...rev, sequence: p.revFivePrimeTail + rev.sequence }
      }

      pairs.push({
        forward: finalFwd,
        reverse: finalRev,
        productStart,
        productEnd,
        productLength,
        pairScore,
        scoreBreakdown,
        pairThreePrimeComplementarity: pairThreePrimeCompl,
        pcrScore,
        pcrGrade,
        recommendedPcrConditions,
        specificity: specificityInfo
      })
    }
  }

  // 综合排序：pairScore（权重加权评分）为主排序，PCR 适用性为辅助排序
  pairs.sort((a, b) => {
    if (b.pairScore !== a.pairScore) return b.pairScore - a.pairScore
    return b.pcrScore - a.pcrScore
  })
  failureReasons.filteredByProductLength = filteredByProductLength
  failureReasons.filteredByBoundary = filteredByBoundary
  failureReasons.filteredByInSilicoPcr = filteredByInSilicoPcr
  failureReasons.filteredByPairComplementarity = filteredByPairComplementarity
  failureReasons.filteredByTmDiff = filteredByTmDiff
  failureReasons.filteredByGcDiff = filteredByGcDiff
  failureReasons.filteredByAmpliconGc = filteredByAmpliconGc
  failureReasons.filteredByPairDimerDG = filteredByPairDimerDG
  failureReasons.filteredByPairThreePrimeDG = filteredByPairThreePrimeDG
  failureReasons.failedPairing = totalPairsAttempted - pairs.length

  // 构建漏斗数据
  const fwdFunnel = buildDirectionFunnel(fwdReasons, 'forward')
  const revFunnel = buildDirectionFunnel(revReasons, 'reverse')
  const pairingFunnel: PairingFunnelStage = {
    validForward: fwdCandidates.length,
    validReverse: revCandidates.length,
    totalPairs: totalPairsAttempted,
    filteredByProductLength,
    filteredByBoundary,
    filteredByTmDiff,
    filteredByGcDiff,
    filteredByDimerDG: filteredByPairDimerDG,
    filteredByThreePrimeDG: filteredByPairThreePrimeDG,
    filteredByAmpliconGc,
    filteredByComplementarity: filteredByPairComplementarity,
    filteredByInSilicoPcr,
    successfulPairs: pairs.length
  }

  const result: PrimerDesignResult = {
    mode,
    params: p,
    pairs: pairs.slice(0, p.topN),
    forwardCandidates: fwdCandidates.length,
    reverseCandidates: revCandidates.length,
    failureReasons: pairs.length === 0 ? failureReasons : undefined,
    fwdFunnel,
    revFunnel,
    pairingFunnel,
    diagnostics: pairs.length === 0 ? buildDiagnostics(failureReasons, fwdReasons, revReasons, p) : undefined
  }
  log.info(`Primer design complete: ${pairs.length} pairs found (fwd=${fwdCandidates.length}, rev=${revCandidates.length})`)
  return result
}

/**
 * 批量引物设计
 */
export function designBatchPrimers(
  templateSeq: string,
  options: BatchDesignOptions
): BatchDesignResult {
  log.info(`Batch primer design: ${options.regions.length} region(s), mode=${options.mode}`)
  const t0 = performance.now()
  const paramSets = options.paramSets ?? [{}]
  const results: BatchDesignResult['results'] = []

  for (let ri = 0; ri < options.regions.length; ri++) {
    const region = options.regions[ri]
    for (let pi = 0; pi < paramSets.length; pi++) {
      const ps = paramSets[pi]
      const result = designPrimers(templateSeq, region.selectionStart, region.selectionEnd, options.mode, ps)
      results.push({ regionIndex: ri, regionLabel: region.label, paramSetIndex: pi, paramSetLabel: ps.label, result })
    }
  }

  return { results, totalTimeMs: Math.round((performance.now() - t0) * 100) / 100 }
}

/** 单个方向的枚举失败统计 */
interface DirectionReasons {
  fwdTotalEnumerated: number
  revTotalEnumerated: number
  fwdFilteredByLength: number
  revFilteredByLength: number
  fwdFilteredByTm: number
  revFilteredByTm: number
  fwdFilteredByGc: number
  revFilteredByGc: number
  fwdFilteredByHomopolymer: number
  revFilteredByHomopolymer: number
  fwdFilteredByComplementarity: number
  revFilteredByComplementarity: number
  fwdFilteredBySpecificity: number
  revFilteredBySpecificity: number
  fwdFilteredByPalindrome: number
  revFilteredByPalindrome: number
  fwdFilteredByThreePrimeSelfCompl: number
  revFilteredByThreePrimeSelfCompl: number
  fwdFilteredByHairpinThreePrime: number
  revFilteredByHairpinThreePrime: number
}

function emptyDirectionReasons(direction: 'forward' | 'reverse'): DirectionReasons {
  return {
    fwdTotalEnumerated: 0, revTotalEnumerated: 0,
    fwdFilteredByLength: 0, revFilteredByLength: 0,
    fwdFilteredByTm: 0, revFilteredByTm: 0,
    fwdFilteredByGc: 0, revFilteredByGc: 0,
    fwdFilteredByHomopolymer: 0, revFilteredByHomopolymer: 0,
    fwdFilteredByComplementarity: 0, revFilteredByComplementarity: 0,
    fwdFilteredBySpecificity: 0, revFilteredBySpecificity: 0,
    fwdFilteredByPalindrome: 0, revFilteredByPalindrome: 0,
    fwdFilteredByThreePrimeSelfCompl: 0, revFilteredByThreePrimeSelfCompl: 0,
    fwdFilteredByHairpinThreePrime: 0, revFilteredByHairpinThreePrime: 0,
  }
}

interface EnumerateResult {
  candidates: PrimerDetail[]
  reasons: DirectionReasons
}

function enumerateCandidatesWithReasons(
  seq: string,
  searchStart: number,
  searchEnd: number,
  direction: 'forward' | 'reverse',
  params: PrimerDesignParams,
  targetStart: number,
  targetEnd: number,
  rt: ReturnType<typeof computeRelaxedThresholds>
): EnumerateResult {
  const candidates: PrimerDetail[] = []
  const seqLen = seq.length
  const p = direction === 'forward' ? 'fwd' : 'rev'

  const reasons: DirectionReasons = emptyDirectionReasons(direction)

  for (let pos = searchStart; pos < searchEnd && pos < seqLen; pos++) {
    for (let len = params.minLength; len <= params.maxLength; len++) {
      // 递增枚举计数
      if (p === 'fwd') reasons.fwdTotalEnumerated++; else reasons.revTotalEnumerated++

      if (pos + len > seqLen) {
        if (p === 'fwd') reasons.fwdFilteredByLength++; else reasons.revFilteredByLength++
        continue
      }

      let primerSeq: string
      let primerPos: number

      if (direction === 'forward') {
        primerSeq = seq.substring(pos, pos + len)
        primerPos = pos
      } else {
        primerSeq = reverseComplement(seq.substring(pos, pos + len))
        primerPos = pos
      }

      // 基本过滤（非 ATCG）
      if (hasAmbiguousBases(primerSeq)) {
        if (p === 'fwd') reasons.fwdFilteredByLength++; else reasons.revFilteredByLength++
        continue
      }

      // 同聚物过滤（权重=0 跳过；权重 1-8 渐进放宽阈值）
      if (params.weights.homopolymer > 0 && maxHomopolymer(primerSeq) > rt.maxHomopolymer) {
        if (p === 'fwd') reasons.fwdFilteredByHomopolymer++; else reasons.revFilteredByHomopolymer++
        continue
      }

      // Tm 过滤（权重=0 跳过；权重 1-8 渐进放宽容差）
      const tm = calcTm(primerSeq, params.primerConcentration * 1e-9, params.saltConcentration * 1e-3)
      if (params.weights.tm > 0 && (tm < rt.minTm || tm > rt.maxTm)) {
        if (p === 'fwd') reasons.fwdFilteredByTm++; else reasons.revFilteredByTm++
        continue
      }

      // GC 过滤（权重=0 跳过；权重 1-8 渐进放宽范围）
      const gc = calcGc(primerSeq)
      if (params.weights.gc > 0 && (gc < rt.minGc || gc > rt.maxGc)) {
        if (p === 'fwd') reasons.fwdFilteredByGc++; else reasons.revFilteredByGc++
        continue
      }

      // 自身互补性检测（权重=0 跳过；权重 1-8 渐进放宽阈值）
      const selfCompl = calcSelfComplementarity(primerSeq)
      if (params.weights.selfComplementarity > 0 && selfCompl > rt.maxSelfComplementarity) {
        if (p === 'fwd') reasons.fwdFilteredByComplementarity++; else reasons.revFilteredByComplementarity++
        continue
      }

      // 3'端自身互补性检测（权重=0 跳过；权重 1-8 渐进放宽阈值）—— 使用独立计数器
      const selfThreePrimeCompl = calcSelfThreePrimeComplementarity(primerSeq)
      if (params.weights.threePrime > 0 && selfThreePrimeCompl > rt.maxSelfThreePrimeComplementarity) {
        if (p === 'fwd') reasons.fwdFilteredByThreePrimeSelfCompl++; else reasons.revFilteredByThreePrimeSelfCompl++
        continue
      }

      // 回文长度过滤（权重=0 跳过；权重 1-8 渐进放宽阈值）
      const palindromeLen = calcPalindromeLength(primerSeq)
      if (params.weights.palindrome > 0 && palindromeLen > rt.maxPalindromeLength) {
        if (p === 'fwd') reasons.fwdFilteredByPalindrome++; else reasons.revFilteredByPalindrome++
        continue
      }

      // 3'端发夹严格检查（权重=0 跳过；权重 1-8 渐进放宽阈值）
      const hairpinThreePrime = calcHairpinThreePrimeDG(primerSeq, params.hairpinStemMinLength)
      if (params.weights.hairpin > 0 && hairpinThreePrime < rt.hairpinThreePrimeDG) {
        if (p === 'fwd') reasons.fwdFilteredByHairpinThreePrime++; else reasons.revFilteredByHairpinThreePrime++
        continue
      }

      const lastBase = primerSeq[primerSeq.length - 1]
      const gcClamp = lastBase === 'G' || lastBase === 'C'

      const threePrimeDG = calcThreePrimeStability(primerSeq)
      const hairpinDG = calcHairpinDG(primerSeq)
      const homodimerDG = calcDimerDG(primerSeq, primerSeq)

      // 特异性检查（可选）
      let offTargetCount: number | undefined
      if (params.enableSpecificityCheck && targetStart >= 0 && targetEnd >= 0) {
        // 根据 similarityThreshold 确定 maxMismatches：
        // ≥85% → 0, ≥75% → 1, ≥65% → 2, <65% → 3（参考 Vector NTI / Primer-BLAST）
        const maxMm = params.similarityThreshold >= 85 ? 0 : params.similarityThreshold >= 75 ? 1 : params.similarityThreshold >= 65 ? 2 : 3
        const specResult = checkSpecificity(primerSeq, seq, targetStart, targetEnd, maxMm, params.maxOffTargets)
        offTargetCount = specResult.offTargetCount
        if (!specResult.isSpecific) {
          if (p === 'fwd') reasons.fwdFilteredBySpecificity++; else reasons.revFilteredBySpecificity++
          continue
        }
      }

      candidates.push({
        sequence: primerSeq,
        position: primerPos,
        length: len,
        tm, gc,
        threePrimeDG,
        hairpinDG,
        homodimerDG,
        selfComplementarity: selfCompl,
        selfThreePrimeComplementarity: selfThreePrimeCompl,
        gcClamp,
        offTargetCount,
        palindromeLength: palindromeLen
      })
    }
  }

  // 按 Tm 接近 optimal 排序，取前 N 个（用户通过 maxCandidates 控制上限）
  candidates.sort((a, b) => Math.abs(a.tm - params.optimalTm) - Math.abs(b.tm - params.optimalTm))
  const limit = Math.max(40, Math.min(9999, params.maxCandidates || 200))
  const limitedCandidates = candidates.slice(0, limit)

  return { candidates: limitedCandidates, reasons }
}

function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}

function hasAmbiguousBases(seq: string): boolean {
  return /[^ATCG]/i.test(seq)
}

/**
 * 根据权重值计算放宽/收紧的硬过滤阈值
 * - weight=0  → 跳过过滤（调用方自行判断）
 * - weight=1  → 阈值放宽 ~2.35 倍（如 Tm 容差 5°C → 11.75°C）
 * - weight=9  → 基准阈值（1.0 倍，不调整）
 * - weight=10 → 阈值收紧 ~0.89 倍（如 Tm 容差 5°C → 4.44°C）
 * 公式：factor = (w + 1) / 10  →  缩放 = 1 / factor
 */
function computeRelaxedThresholds(p: PrimerDesignParams) {
  const w = p.weights
  const f = (weight: number) => weight === 0 ? 1 : 10 / (weight + 1)

  // 枚举级阈值（放宽 = 增大容差 / 放大上限）
  const tmTol = (p.optimalTm - p.minTm) * f(w.tm)
  const gcTol = (50 - p.minGc) * f(w.gc)

  return {
    // 枚举级
    minTm: p.optimalTm - tmTol,
    maxTm: p.optimalTm + tmTol,
    minGc: Math.max(5, 50 - gcTol),
    maxGc: Math.min(95, 50 + gcTol),
    maxHomopolymer: Math.ceil(p.maxHomopolymer * f(w.homopolymer)),
    maxSelfComplementarity: Math.ceil(p.maxSelfComplementarity * f(w.selfComplementarity)),
    maxSelfThreePrimeComplementarity: Math.ceil(p.maxSelfThreePrimeComplementarity * f(w.threePrime)),
    maxPalindromeLength: Math.ceil(p.maxPalindromeLength * f(w.palindrome)),
    hairpinThreePrimeDG: p.hairpinThreePrimeDG * f(w.hairpin),

    // 配对级
    maxTmDiff: p.maxTmDiff * f(w.tmDiff),
    maxGcDiff: p.maxGcDiff * f(w.gcDiff),
    maxPairDimerDG: p.maxPairDimerDG * f(w.dimer),
    maxPairThreePrimeDG: p.maxPairThreePrimeDG * f(w.threePrime),
    maxPairThreePrimeComplementarity: Math.ceil(p.maxPairThreePrimeComplementarity * f(w.threePrime)),
    minAmpliconGc: p.minAmpliconGc - (p.minAmpliconGc * (f(w.gc) - 1)),
    maxAmpliconGc: Math.min(95, p.maxAmpliconGc + (100 - p.maxAmpliconGc) * (f(w.gc) - 1)),
  }
}

/**
 * 多轮迭代设计（智能调权）
 */
export function designPrimersWithIterations(
  templateSeq: string,
  selectionStart: number,
  selectionEnd: number,
  mode: PrimerDesignMode,
  params?: Partial<PrimerDesignParams>,
  onProgress?: (percent: number, message: string) => void
): PrimerDesignResult {
  const maxRounds = 5
  log.info(`Starting iterative primer design: mode=${mode}, maxRounds=${maxRounds}`)
  const baseParams: PrimerDesignParams = { ...DEFAULT_PRIMER_PARAMS, ...params }
  const iterations: IterationInfo[] = []

  let currentParams = { ...baseParams, weights: { ...baseParams.weights } }

  for (let round = 0; round < maxRounds; round++) {
    const pctBase = Math.round((round / maxRounds) * 80) + 10
    onProgress?.(pctBase, `第 ${round + 1}/${maxRounds} 轮设计${round > 0 ? '（智能调权）' : ''}...`)

    const result = designPrimers(templateSeq, selectionStart, selectionEnd, mode, currentParams)
    iterations.push({
      round: round + 1,
      params: { ...currentParams },
      pairsFound: result.pairs.length,
      failureReasons: result.failureReasons
    })

    if (result.pairs.length > 0) {
      return {
        ...result,
        iterations,
        iterationCount: round + 1,
        fwdFunnel: result.fwdFunnel,
        revFunnel: result.revFunnel,
        pairingFunnel: result.pairingFunnel,
        diagnostics: round > 0 ? buildIterationDiagnostics(iterations, baseParams) : result.diagnostics
      }
    }

    // 分析失败原因，智能调整权重或阈值
    if (round < maxRounds - 1) {
      currentParams = buildSmartRelaxation(currentParams, result, 'forward')
      currentParams = buildSmartRelaxation(currentParams, result, 'reverse')
    }
  }

  // 所有轮次都失败
  const lastResult = designPrimers(templateSeq, selectionStart, selectionEnd, mode, currentParams)
  return {
    ...lastResult,
    iterations,
    iterationCount: maxRounds,
    fwdFunnel: lastResult.fwdFunnel,
    revFunnel: lastResult.revFunnel,
    pairingFunnel: lastResult.pairingFunnel,
    diagnostics: buildIterationDiagnostics(iterations, baseParams)
  }
}

/** 构建智能调权参数（基于上一轮失败原因） */
function buildSmartRelaxation(
  currentParams: PrimerDesignParams,
  result: PrimerDesignResult,
  direction: 'forward' | 'reverse'
): PrimerDesignParams {
  const newParams = { ...currentParams, weights: { ...currentParams.weights } }
  const fr = result.failureReasons
  if (!fr) return newParams

  const p = direction === 'forward' ? 'fwd' : 'rev'

  // 检查是否有有效候选引物
  const hasCandidates = (p === 'fwd' ? fr.validForward : fr.validReverse) > 0

  if (!hasCandidates) {
    // 候选引物不足，放宽硬性过滤阈值
    if (direction === 'forward') {
      if (fr.fwdTotalEnumerated === 0) {
        newParams.upstreamFlankRange = (newParams.upstreamFlankRange || 300) + 200
      }
    } else {
      if (fr.revTotalEnumerated === 0) {
        newParams.downstreamFlankRange = (newParams.downstreamFlankRange || 300) + 200
      }
    }
    // 放宽 Tm/GC 范围（amplify-region 模式位置固定，需更激进放宽）
    const tmStep = 4  // 从 2 增加到 4
    const gcStep = 8  // 从 5 增加到 8
    newParams.minTm = newParams.minTm - tmStep
    newParams.maxTm = newParams.maxTm + tmStep
    newParams.minGc = Math.max(10, newParams.minGc - gcStep)
    newParams.maxGc = Math.min(90, newParams.maxGc + gcStep)
    return newParams
  }

  // 有候选引物但无有效配对：分析配对瓶颈或单引物瓶颈
  const total = p === 'fwd' ? fr.fwdTotalEnumerated : fr.revTotalEnumerated

  if (fr.validForward > 0 && fr.validReverse > 0) {
    // 配对阶段瓶颈：降低对应权重
    const pairBottlenecks = [
      { count: fr.filteredByProductLength, key: 'dimer' as const },
      { count: fr.filteredByTmDiff, key: 'tmDiff' as const },
      { count: fr.filteredByGcDiff, key: 'gcDiff' as const },
      { count: fr.filteredByPairComplementarity, key: 'threePrime' as const },
      { count: fr.filteredByInSilicoPcr, key: 'specificity' as const },
    ]
    const bottleneck = pairBottlenecks.reduce((a, b) => b.count > a.count ? b : a)

    if (bottleneck.count > 0 && newParams.weights[bottleneck.key] > 0) {
      const oldW = newParams.weights[bottleneck.key]
      newParams.weights[bottleneck.key] = Math.max(0, oldW - 4)
    } else if (bottleneck.count > 0) {
      // 权重已为 0，放宽硬性阈值
      if (bottleneck.key === 'tmDiff') newParams.maxTmDiff += 3
      else if (bottleneck.key === 'gcDiff') newParams.maxGcDiff += 5
    }
  } else {
    // 单引物瓶颈：找到过滤最多的维度，降低其权重
    const filterCounts = [
      { count: p === 'fwd' ? fr.fwdFilteredByTm : fr.revFilteredByTm, key: 'tm' as const },
      { count: p === 'fwd' ? fr.fwdFilteredByGc : fr.revFilteredByGc, key: 'gc' as const },
      { count: p === 'fwd' ? fr.fwdFilteredByHomopolymer : fr.revFilteredByHomopolymer, key: 'homopolymer' as const },
      { count: p === 'fwd' ? fr.fwdFilteredByComplementarity : fr.revFilteredByComplementarity, key: 'selfComplementarity' as const },
      { count: p === 'fwd' ? fr.fwdFilteredByThreePrimeSelfCompl : fr.revFilteredByThreePrimeSelfCompl, key: 'threePrime' as const },
      { count: p === 'fwd' ? fr.fwdFilteredByPalindrome : fr.revFilteredByPalindrome, key: 'palindrome' as const },
      { count: p === 'fwd' ? fr.fwdFilteredBySpecificity : fr.revFilteredBySpecificity, key: 'specificity' as const },
    ]
    const bottleneck = filterCounts.reduce((a, b) => b.count > a.count ? b : a)
    const pct = total > 0 ? Math.round((bottleneck.count / total) * 100) : 0

    if (pct >= 15 && bottleneck.count > 0) {
      if (newParams.weights[bottleneck.key] > 0) {
        // 降低权重（每次减 4，最低到 0）
        newParams.weights[bottleneck.key] = Math.max(0, newParams.weights[bottleneck.key] - 4)
      } else {
        // 权重已为 0，放宽硬性阈值
        adjustThreshold(newParams, bottleneck.key, direction)
      }
    }
  }

  return newParams
}

/** 当权重已为 0 时，放宽对应维度的硬性过滤阈值 */
function adjustThreshold(params: PrimerDesignParams, key: string, _dir: 'forward' | 'reverse'): void {
  switch (key) {
    case 'tm':
      params.minTm = params.minTm - 4
      params.maxTm = params.maxTm + 4
      break
    case 'gc':
      params.minGc = Math.max(10, params.minGc - 8)
      params.maxGc = Math.min(90, params.maxGc + 8)
      break
    case 'homopolymer':
      params.maxHomopolymer = params.maxHomopolymer + 2
      break
    case 'selfComplementarity':
      params.maxSelfComplementarity = params.maxSelfComplementarity + 4
      params.maxSelfThreePrimeComplementarity = params.maxSelfThreePrimeComplementarity + 2
      break
    case 'palindrome':
      params.maxPalindromeLength = params.maxPalindromeLength + 4
      break
    case 'specificity':
      params.maxOffTargets = params.maxOffTargets + 3
      break
  }
}

/** 构建单方向筛选漏斗 */
function buildDirectionFunnel(reasons: DirectionReasons, direction: 'forward' | 'reverse'): FunnelStage[] {
  const p = direction === 'forward' ? 'fwd' : 'rev'
  const total = p === 'fwd' ? reasons.fwdTotalEnumerated : reasons.revTotalEnumerated
  const filteredByLength = p === 'fwd' ? reasons.fwdFilteredByLength : reasons.revFilteredByLength
  const filteredByTm = p === 'fwd' ? reasons.fwdFilteredByTm : reasons.revFilteredByTm
  const filteredByGc = p === 'fwd' ? reasons.fwdFilteredByGc : reasons.revFilteredByGc
  const filteredByHomopolymer = p === 'fwd' ? reasons.fwdFilteredByHomopolymer : reasons.revFilteredByHomopolymer
  const filteredByComplementarity = p === 'fwd' ? reasons.fwdFilteredByComplementarity : reasons.revFilteredByComplementarity
  const filteredByThreePrimeSelfCompl = p === 'fwd' ? reasons.fwdFilteredByThreePrimeSelfCompl : reasons.revFilteredByThreePrimeSelfCompl
  const filteredBySpecificity = p === 'fwd' ? reasons.fwdFilteredBySpecificity : reasons.revFilteredBySpecificity
  const filteredByPalindrome = p === 'fwd' ? reasons.fwdFilteredByPalindrome : reasons.revFilteredByPalindrome
  const filteredByHairpinThreePrime = p === 'fwd' ? reasons.fwdFilteredByHairpinThreePrime : reasons.revFilteredByHairpinThreePrime

  const stages: Array<{ label: string; filtered: number }> = [
    { label: '总枚举', filtered: 0 },
    { label: '长度过滤', filtered: filteredByLength },
    { label: 'Tm 过滤', filtered: filteredByTm },
    { label: 'GC% 过滤', filtered: filteredByGc },
    { label: '同聚物过滤', filtered: filteredByHomopolymer },
    { label: '自互补过滤', filtered: filteredByComplementarity },
    { label: '3\'端互补过滤', filtered: filteredByThreePrimeSelfCompl },
    { label: '回文过滤', filtered: filteredByPalindrome },
    { label: '3\'端发夹过滤', filtered: filteredByHairpinThreePrime },
    { label: '特异性过滤', filtered: filteredBySpecificity },
  ]

  let running = total
  const result: FunnelStage[] = []
  let maxFiltered = 0
  let bottleneckIdx = 0

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i]
    if (i === 0) {
      result.push({ label: s.label, input: total, passed: total, filtered: 0, filterPercent: 0, isBottleneck: false })
    } else {
      const input = running
      const filtered = s.filtered
      const passed = Math.max(0, input - filtered)
      const pct = input > 0 ? Math.round((filtered / input) * 100) : 0
      result.push({ label: s.label, input, passed, filtered, filterPercent: pct, isBottleneck: false })
      running = passed
      if (filtered > maxFiltered) { maxFiltered = filtered; bottleneckIdx = i }
    }
  }

  // 标记瓶颈
  if (result.length > 1 && maxFiltered > 0) result[bottleneckIdx].isBottleneck = true
  return result
}

/** 构建诊断建议（基于正反向分离数据） */
function buildDiagnostics(
  reasons: FailureReasons,
  fwdReasons: DirectionReasons,
  revReasons: DirectionReasons,
  params: PrimerDesignParams
): DiagnosticSuggestion[] {
  const suggestions: DiagnosticSuggestion[] = []

  // 判断哪个方向是主要问题
  const fwdTotal = reasons.fwdTotalEnumerated || 1
  const revTotal = reasons.revTotalEnumerated || 1

  // 搜索窗口检查
  if (reasons.fwdTotalEnumerated === 0) {
    suggestions.push({
      stage: '正向搜索窗口',
      filterPercent: 100,
      suggestion: '正向引物搜索窗口为空。选区可能太靠近序列起始位置，或侧翼范围设置太小。请增大上游侧翼范围。',
      paramKey: 'upstreamFlankRange',
      suggestedValue: (params.upstreamFlankRange ?? params.flankRange ?? 300) + 200
    })
  }
  if (reasons.revTotalEnumerated === 0) {
    suggestions.push({
      stage: '反向搜索窗口',
      filterPercent: 100,
      suggestion: '反向引物搜索窗口为空。选区可能太靠近序列末端，或侧翼范围设置太小。请增大下游侧翼范围。',
      paramKey: 'downstreamFlankRange',
      suggestedValue: (params.downstreamFlankRange ?? params.flankRange ?? 300) + 200
    })
  }

  // Tm 瓶颈
  const fwdTmPct = Math.round((fwdReasons.fwdFilteredByTm / fwdTotal) * 100)
  const revTmPct = Math.round((revReasons.revFilteredByTm / revTotal) * 100)
  if (fwdTmPct >= 15 || revTmPct >= 15) {
    const maxPct = Math.max(fwdTmPct, revTmPct)
    const dir = fwdTmPct >= revTmPct ? '正向' : '反向'
    suggestions.push({
      stage: `${dir} Tm 过滤`,
      filterPercent: maxPct,
      suggestion: `${dir}引物 Tm 过滤了 ${maxPct}%。建议将 Tm 范围放宽至 ${params.minTm - 3}–${params.maxTm + 3}°C`,
      paramKey: 'minTm',
      suggestedValue: params.minTm - 3
    })
  }

  // GC 瓶颈
  const fwdGcPct = Math.round((fwdReasons.fwdFilteredByGc / fwdTotal) * 100)
  const revGcPct = Math.round((revReasons.revFilteredByGc / revTotal) * 100)
  if (fwdGcPct >= 15 || revGcPct >= 15) {
    const maxPct = Math.max(fwdGcPct, revGcPct)
    const dir = fwdGcPct >= revGcPct ? '正向' : '反向'
    suggestions.push({
      stage: `${dir} GC% 过滤`,
      filterPercent: maxPct,
      suggestion: `${dir}引物 GC 过滤了 ${maxPct}%。建议将 GC 范围放宽至 ${Math.max(10, params.minGc - 5)}–${Math.min(90, params.maxGc + 5)}%`,
      paramKey: 'minGc',
      suggestedValue: Math.max(10, params.minGc - 5)
    })
  }

  // 同聚物瓶颈
  const fwdHomPct = Math.round((fwdReasons.fwdFilteredByHomopolymer / fwdTotal) * 100)
  const revHomPct = Math.round((revReasons.revFilteredByHomopolymer / revTotal) * 100)
  if (fwdHomPct >= 15 || revHomPct >= 15) {
    const maxPct = Math.max(fwdHomPct, revHomPct)
    const dir = fwdHomPct >= revHomPct ? '正向' : '反向'
    suggestions.push({
      stage: `${dir} 同聚物过滤`,
      filterPercent: maxPct,
      suggestion: `${dir}引物同聚物过滤了 ${maxPct}%。建议将最大同聚物从 ${params.maxHomopolymer} 提高到 ${params.maxHomopolymer + 2}`,
      paramKey: 'maxHomopolymer',
      suggestedValue: params.maxHomopolymer + 2
    })
  }

  // 自互补瓶颈（仅由 maxSelfComplementarity 控制）
  const fwdSelfComplPct = Math.round((fwdReasons.fwdFilteredByComplementarity / fwdTotal) * 100)
  const revSelfComplPct = Math.round((revReasons.revFilteredByComplementarity / revTotal) * 100)
  if (fwdSelfComplPct >= 15 || revSelfComplPct >= 15) {
    const maxPct = Math.max(fwdSelfComplPct, revSelfComplPct)
    const dir = fwdSelfComplPct >= revSelfComplPct ? '正向' : '反向'
    suggestions.push({
      stage: `${dir} 自互补过滤`,
      filterPercent: maxPct,
      suggestion: `${dir}引物自互补过滤了 ${maxPct}%。建议将自互补上限从 ${params.maxSelfComplementarity} 提高到 ${params.maxSelfComplementarity + 4}`,
      paramKey: 'maxSelfComplementarity',
      suggestedValue: params.maxSelfComplementarity + 4
    })
  }

  // 3'端自互补瓶颈（仅由 maxSelfThreePrimeComplementarity 控制）
  const fwdThreePrimeComplPct = Math.round((fwdReasons.fwdFilteredByThreePrimeSelfCompl / fwdTotal) * 100)
  const revThreePrimeComplPct = Math.round((revReasons.revFilteredByThreePrimeSelfCompl / revTotal) * 100)
  if (fwdThreePrimeComplPct >= 15 || revThreePrimeComplPct >= 15) {
    const maxPct = Math.max(fwdThreePrimeComplPct, revThreePrimeComplPct)
    const dir = fwdThreePrimeComplPct >= revThreePrimeComplPct ? '正向' : '反向'
    suggestions.push({
      stage: `${dir} 3'端互补过滤`,
      filterPercent: maxPct,
      suggestion: `${dir}引物3'端互补过滤了 ${maxPct}%。建议将3'端自互补上限从 ${params.maxSelfThreePrimeComplementarity} 提高到 ${params.maxSelfThreePrimeComplementarity + 2}`,
      paramKey: 'maxSelfThreePrimeComplementarity',
      suggestedValue: params.maxSelfThreePrimeComplementarity + 2
    })
  }

  // 特异性瓶颈
  const fwdSpecPct = Math.round((fwdReasons.fwdFilteredBySpecificity / fwdTotal) * 100)
  const revSpecPct = Math.round((revReasons.revFilteredBySpecificity / revTotal) * 100)
  if (fwdSpecPct >= 15 || revSpecPct >= 15) {
    const maxPct = Math.max(fwdSpecPct, revSpecPct)
    const dir = fwdSpecPct >= revSpecPct ? '正向' : '反向'
    suggestions.push({
      stage: `${dir} 特异性过滤`,
      filterPercent: maxPct,
      suggestion: `${dir}引物特异性过滤了 ${maxPct}%。建议将 maxOffTargets 从 ${params.maxOffTargets} 提高到 ${params.maxOffTargets + 3}`,
      paramKey: 'maxOffTargets',
      suggestedValue: params.maxOffTargets + 3
    })
  }

  // 配对阶段瓶颈：逐一检查 9 个配对过滤条件
  if (reasons.validForward > 0 && reasons.validReverse > 0) {
    const pairTotal = reasons.validForward * reasons.validReverse || 1
    const pairingIssues = [
      {
        count: reasons.filteredByProductLength,
        label: '产物长度',
        suggestion: () => `配对因产物长度被过滤 ${Math.round((reasons.filteredByProductLength / pairTotal) * 100)}%。建议扩大产物长度范围或降低产物长度权重`,
        paramKey: 'maxProductLength' as const,
        suggestedValue: params.maxProductLength + 200
      },
      {
        count: reasons.filteredByBoundary,
        label: '边界贴合',
        suggestion: () => `配对阶段因边界贴合被过滤 ${Math.round((reasons.filteredByBoundary / pairTotal) * 100)}%。枚举阶段已保证边界贴合，此项不应>0，请报告为程序异常`,
        paramKey: undefined,
        suggestedValue: undefined
      },
      {
        count: reasons.filteredByTmDiff,
        label: 'Tm 差异',
        suggestion: () => `配对因 Tm 差异被过滤 ${Math.round((reasons.filteredByTmDiff / pairTotal) * 100)}%。建议降低 Tm差异 权重或增大 maxTmDiff (当前 ${params.maxTmDiff.toFixed(1)}°C)`,
        paramKey: 'maxTmDiff' as const,
        suggestedValue: params.maxTmDiff + 3
      },
      {
        count: reasons.filteredByGcDiff,
        label: 'GC 差异',
        suggestion: () => `配对因 GC 差异被过滤 ${Math.round((reasons.filteredByGcDiff / pairTotal) * 100)}%。建议降低 GC差异 权重或增大 maxGcDiff (当前 ${params.maxGcDiff.toFixed(1)}%)`,
        paramKey: 'maxGcDiff' as const,
        suggestedValue: params.maxGcDiff + 5
      },
      {
        count: reasons.filteredByPairDimerDG,
        label: '二聚体 dG',
        suggestion: () => `配对因异源二聚体 dG 被过滤 ${Math.round((reasons.filteredByPairDimerDG / pairTotal) * 100)}%。建议降低 二聚体 权重或放宽 maxPairDimerDG (当前 ${params.maxPairDimerDG} kcal/mol)`,
        paramKey: 'maxPairDimerDG' as const,
        suggestedValue: params.maxPairDimerDG - 5
      },
      {
        count: reasons.filteredByPairThreePrimeDG,
        label: '3\'端 dG',
        suggestion: () => `配对因 3\'端互补 dG 被过滤 ${Math.round((reasons.filteredByPairThreePrimeDG / pairTotal) * 100)}%。建议降低 3\'端 权重或放宽 maxPairThreePrimeDG (当前 ${params.maxPairThreePrimeDG} kcal/mol)`,
        paramKey: 'maxPairThreePrimeDG' as const,
        suggestedValue: params.maxPairThreePrimeDG - 2
      },
      {
        count: reasons.filteredByAmpliconGc,
        label: '扩增子 GC',
        suggestion: () => `配对因扩增子 GC 被过滤 ${Math.round((reasons.filteredByAmpliconGc / pairTotal) * 100)}%。建议降低 GC偏差 权重或放宽扩增子 GC 范围`,
        paramKey: 'maxAmpliconGc' as const,
        suggestedValue: params.maxAmpliconGc + 5
      },
      {
        count: reasons.filteredByPairComplementarity,
        label: '3\'端互补性',
        suggestion: () => `配对因 3\'端互补性被过滤 ${Math.round((reasons.filteredByPairComplementarity / pairTotal) * 100)}%。建议降低 3\'端 权重或增大 maxPairThreePrimeComplementarity (当前 ${params.maxPairThreePrimeComplementarity})`,
        paramKey: 'maxPairThreePrimeComplementarity' as const,
        suggestedValue: params.maxPairThreePrimeComplementarity + 2
      },
      {
        count: reasons.filteredByInSilicoPcr,
        label: 'In-silico PCR',
        suggestion: () => `配对因 In-silico PCR 验证失败被过滤 ${Math.round((reasons.filteredByInSilicoPcr / pairTotal) * 100)}%。建议关闭 in-silico PCR 验证或检查引物特异性`,
        paramKey: 'enableInSilicoPcr' as const,
        suggestedValue: false
      }
    ]

    // 按过滤数量降序排列，输出所有过滤比例 >= 15% 的环节
    pairingIssues.sort((a, b) => b.count - a.count)
    for (const issue of pairingIssues) {
      const pct = Math.round((issue.count / pairTotal) * 100)
      if (pct >= 15) {
        suggestions.push({
          stage: `配对-${issue.label}`,
          filterPercent: pct,
          suggestion: issue.suggestion(),
          paramKey: issue.paramKey,
          suggestedValue: issue.suggestedValue
        })
      }
    }
  }

  // 排序
  suggestions.sort((a, b) => b.filterPercent - a.filterPercent)
  return suggestions.slice(0, 6)
}

/** 构建迭代诊断（含权重调整建议） */
function buildIterationDiagnostics(iterations: IterationInfo[], baseParams: PrimerDesignParams): DiagnosticSuggestion[] {
  const lastIteration = iterations[iterations.length - 1]
  if (!lastIteration?.failureReasons) {
    return [{
      stage: '多轮迭代',
      filterPercent: 100,
      suggestion: `经过 ${iterations.length} 轮迭代仍未找到引物对。建议手动检查选区序列质量或尝试不同的设计模式。`
    }]
  }
  const fr = lastIteration.failureReasons

  // 构建临时 DirectionReasons 用于诊断
  const fwdR: DirectionReasons = {
    fwdTotalEnumerated: fr.fwdTotalEnumerated, revTotalEnumerated: 0,
    fwdFilteredByLength: fr.fwdFilteredByLength, revFilteredByLength: 0,
    fwdFilteredByTm: fr.fwdFilteredByTm, revFilteredByTm: 0,
    fwdFilteredByGc: fr.fwdFilteredByGc, revFilteredByGc: 0,
    fwdFilteredByHomopolymer: fr.fwdFilteredByHomopolymer, revFilteredByHomopolymer: 0,
    fwdFilteredByComplementarity: fr.fwdFilteredByComplementarity, revFilteredByComplementarity: 0,
    fwdFilteredBySpecificity: fr.fwdFilteredBySpecificity, revFilteredBySpecificity: 0,
    fwdFilteredByPalindrome: fr.fwdFilteredByPalindrome ?? 0, revFilteredByPalindrome: 0,
    fwdFilteredByThreePrimeSelfCompl: fr.fwdFilteredByThreePrimeSelfCompl ?? 0, revFilteredByThreePrimeSelfCompl: 0,
    fwdFilteredByHairpinThreePrime: fr.fwdFilteredByHairpinThreePrime ?? 0, revFilteredByHairpinThreePrime: 0,
  }
  const revR: DirectionReasons = {
    fwdTotalEnumerated: 0, revTotalEnumerated: fr.revTotalEnumerated,
    fwdFilteredByLength: 0, revFilteredByLength: fr.revFilteredByLength,
    fwdFilteredByTm: 0, revFilteredByTm: fr.revFilteredByTm,
    fwdFilteredByGc: 0, revFilteredByGc: fr.revFilteredByGc,
    fwdFilteredByHomopolymer: 0, revFilteredByHomopolymer: fr.revFilteredByHomopolymer,
    fwdFilteredByComplementarity: 0, revFilteredByComplementarity: fr.revFilteredByComplementarity,
    fwdFilteredBySpecificity: 0, revFilteredBySpecificity: fr.revFilteredBySpecificity,
    fwdFilteredByPalindrome: 0, revFilteredByPalindrome: fr.revFilteredByPalindrome ?? 0,
    fwdFilteredByThreePrimeSelfCompl: 0, revFilteredByThreePrimeSelfCompl: fr.revFilteredByThreePrimeSelfCompl ?? 0,
    fwdFilteredByHairpinThreePrime: 0, revFilteredByHairpinThreePrime: fr.revFilteredByHairpinThreePrime ?? 0,
  }

  const diags = buildDiagnostics(fr, fwdR, revR, lastIteration.params)

  // 添加权重调整建议：对比各轮权重变化
  const weightLabels: Record<string, string> = {
    tm: 'Tm偏差', tmDiff: 'Tm差异', gc: 'GC偏差', gcDiff: 'GC差异',
    hairpin: '发夹', dimer: '二聚体', palindrome: '回文',
    homopolymer: '同聚物', selfComplementarity: '自互补',
    threePrime: '3\'端', gcClamp: 'GC Clamp', specificity: '特异性'
  }

  // 找出权重被调整的维度
  if (iterations.length > 1) {
    const firstW = iterations[0].params.weights
    const lastW = lastIteration.params.weights
    const changes: string[] = []
    for (const key of Object.keys(weightLabels) as (keyof typeof weightLabels)[]) {
      const oldVal = firstW[key as keyof typeof firstW]
      const newVal = lastW[key as keyof typeof lastW]
      if (oldVal !== newVal) {
        changes.push(`${weightLabels[key]}: ${oldVal}→${newVal}`)
      }
    }
    if (changes.length > 0) {
      diags.unshift({
        stage: '智能调权',
        filterPercent: 95,
        suggestion: `迭代中自动调整了权重: ${changes.join(', ')}。您可以点击"应用"按钮一键应用这些调整。`
      })
    }
  }

  diags.unshift({
    stage: '多轮迭代',
    filterPercent: 100,
    suggestion: `经过 ${iterations.length} 轮智能调权迭代仍未找到引物对。有效正向 ${fr.validForward} / 反向 ${fr.validReverse}。建议手动检查选区序列质量或降低更多维度的权重。`
  })
  return diags
}
