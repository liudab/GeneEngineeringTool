/**
 * 引物对评分系统 (100 分制)
 * 加权归一化模型：每个维度独立计算 0-100 子分数，按权重加权求和。
 * 避免纯减法“一票否决”效应——即使某维度偏差大，也不会将总分拉到 0。
 */

import type { PrimerDetail, DesignedPrimer, ScoreBreakdown, PrimerDesignParams, PrimerDesignMode, ScoringWeights } from './types'
import { calcPalindromeLength, calcDimerDG } from './thermo'

/**
 * 计算引物对的 PCR 适用性评分 (0-100)
 * 连续评分模型：基于发夹/二聚体 ΔG + 3'端二聚体专项检查
 *
 * 评分公式：各维度独立计算 0-100 子分，按权重加权求和。
 * 子分函数：连续递减函数 f(dG) = 100 / (1 + (|dG|/halfPoint)^power)
 *   - dG=0 → 100 分（无二级结构）
 *   - dG=halfPoint → 50 分（中等风险）
 *   - dG 越负 → 趋近 0 分
 *
 * 文献依据：
 *   - 发夹阈值 -2 kcal/mol: Primer3 hairpin_thal 47°C 的等效 ΔG (Untergasser 2012)
 *   - 自二聚体阈值 -4 kcal/mol: IDT OligoAnalyzer "acceptable" 水平
 *   - 交叉二聚体阈值 -5 kcal/mol: 比自二聚体更严格 (Primer3 pair penalty)
 *   - 3'端二聚体: PCR 失败首要原因 (SantaLucia 2004, Thermodynamic treatment)
 */
export function calcPcrScore(
  fwd: PrimerDetail, rev: PrimerDetail,
  fwdSelfDimerDG: number, revSelfDimerDG: number, heteroDimerDG: number,
  fwdHairpinDG: number, revHairpinDG: number
): { pcrScore: number; pcrGrade: '优' | '良' | '差'; threePrimeDimerDG: number } {

  // 3'端二聚体专项检查：仅取两条引物 3'端最后 10bp 计算二聚体 ΔG
  // 3'端互补导致的引物延伸是 PCR 失败的首要原因
  // 文献: SantaLucia 2004 — 3'端 dimer 扩增效率显著高于内部 dimer
  const fwdTail = fwd.sequence.substring(Math.max(0, fwd.sequence.length - 10))
  const revTail = rev.sequence.substring(Math.max(0, rev.sequence.length - 10))
  const threePrimeDimerDG = calcDimerDG(fwdTail, revTail)

  // 连续评分子分函数
  // halfPoint: 该 ΔG 值对应 50 分（半惩罚点）
  // power: 曲线陡峭度，2 = 平滑递减，3 = 更陡峭的阈值效应
  const subScore = (dg: number, halfPoint: number, power: number = 2): number => {
    if (dg >= 0) return 100
    const ratio = Math.abs(dg) / halfPoint
    return Math.round(100 / (1 + Math.pow(ratio, power)))
  }

  // 各维度子分（权重反映对 PCR 失败的重要性）
  // 交叉二聚体权重最高（30%）：正反向引物互相结合导致无产物
  // 发夹权重各 15%：阻碍聚合酶延伸
  // 自二聚体权重各 12.5%：引物自结合降低有效浓度
  // 3'端二聚体权重 15%：特异性扩增失败
  const fwdDimerScore = subScore(fwdSelfDimerDG, 4.0, 2)     // halfPoint=-4, IDT 标准
  const revDimerScore = subScore(revSelfDimerDG, 4.0, 2)
  const crossDimerScore = subScore(heteroDimerDG, 5.0, 2.5)  // halfPoint=-5, 更严格
  const fwdHairpinScore = subScore(fwdHairpinDG, 2.0, 2)     // halfPoint=-2, Primer3 等效
  const revHairpinScore = subScore(revHairpinDG, 2.0, 2)
  const threePrimeScore = subScore(threePrimeDimerDG, 4.0, 2.5) // 3'端更严格

  // 加权求和
  const score = Math.round(
    fwdDimerScore * 0.125 +
    revDimerScore * 0.125 +
    crossDimerScore * 0.30 +
    fwdHairpinScore * 0.15 +
    revHairpinScore * 0.15 +
    threePrimeScore * 0.15
  )

  const pcrGrade: '优' | '良' | '差' = score >= 80 ? '优' : score >= 50 ? '良' : '差'
  return { pcrScore: score, pcrGrade, threePrimeDimerDG }
}

/**
 * 维度子分数转换：penalty=0 → 100 分，penalty=cap → 0 分，线性插值
 * cap 是该维度“完全不合格”的惩罚阈值，超出后子分数保持 0
 */
function dimScore(penalty: number, cap: number): number {
  if (penalty <= 0) return 100
  if (penalty >= cap) return 0
  return 100 - (penalty / cap) * 100
}

/**
 * 对引物对进行评分（加权归一化模型）
 */
export function scorePrimerPair(
  forward: PrimerDetail,
  reverse: PrimerDetail,
  productLength: number,
  params: PrimerDesignParams,
  mode?: PrimerDesignMode,
  selectionStart?: number,
  selectionEnd?: number,
  crossDimerDG?: number,
  preFwdPalindrome?: number,
  preRevPalindrome?: number
): { pairScore: number; scoreBreakdown: ScoreBreakdown } {

  // 1. Tm 偏差 (每偏离 optimalTm 1°C 扣 3 分，双向累加)
  const fwdTmDev = Math.abs(forward.tm - params.optimalTm)
  const revTmDev = Math.abs(reverse.tm - params.optimalTm)
  const tmPenalty = Math.round((fwdTmDev + revTmDev) * 3 * 100) / 100

  // 2. 正反向 Tm 差异 (差异>1°C 开始扣分，每 1°C 扣 4 分)
  const tmDiff = Math.abs(forward.tm - reverse.tm)
  const tmDiffPenalty = tmDiff > 1 ? Math.round((tmDiff - 1) * 4 * 100) / 100 : 0

  // 3. GC 偏差 (偏离 50% 超过 10% 的部分每 1% 扣 1 分)
  const fwdGcDev = Math.abs(forward.gc - 50)
  const revGcDev = Math.abs(reverse.gc - 50)
  const gcPenalty = Math.round(((fwdGcDev > 10 ? fwdGcDev - 10 : 0) + (revGcDev > 10 ? revGcDev - 10 : 0)) * 1.0 * 100) / 100

  // 3b. 正反向 GC 差异 (差异>2% 开始扣分，每 1% 扣 3 分)
  const gcDiff = Math.abs(forward.gc - reverse.gc)
  const gcDiffPenalty = gcDiff > 2 ? Math.round((gcDiff - 2) * 3 * 100) / 100 : 0

  // 4. 发夹惩罚 (ΔG < threshold 部分每 kcal 扣 4 分，双向累加)
  const hairpinPenalty = Math.round((
    (forward.hairpinDG < params.hairpinThreshold ? Math.abs(forward.hairpinDG - params.hairpinThreshold) * 4 : 0) +
    (reverse.hairpinDG < params.hairpinThreshold ? Math.abs(reverse.hairpinDG - params.hairpinThreshold) * 4 : 0)
  ) * 100) / 100

  // 5. 同源二聚体惩罚 (ΔG < threshold 部分每 kcal 扣 3 分，双向累加)
  const dimerPenalty = Math.round((
    (forward.homodimerDG < params.dimerThreshold ? Math.abs(forward.homodimerDG - params.dimerThreshold) * 3 : 0) +
    (reverse.homodimerDG < params.dimerThreshold ? Math.abs(reverse.homodimerDG - params.dimerThreshold) * 3 : 0)
  ) * 100) / 100

  // 5b. 交叉二聚体惩罚（正反向引物间，ΔG < threshold 部分每 kcal 扣 3 分）
  const crossDimerPenalty = (crossDimerDG !== undefined && crossDimerDG < params.dimerThreshold)
    ? Math.round(Math.abs(crossDimerDG - params.dimerThreshold) * 3 * 100) / 100
    : 0

  // 6. 产物长度偏好（amplify-region / flanking-selection 模式跳过）
  //    amplify-region：产物长度由选区边界贴合度约束
  //    flanking-selection：产物长度由侧翼范围隐式决定，无需惩罚
  //    放宽模式：降低产物长度偏差扣分，让引物质量指标占更大比重
  let productLengthPenalty = 0
  if (mode !== 'amplify-region' && mode !== 'flanking-selection') {
    const prodLenDev = Math.abs(productLength - params.optimalProductLength)
    const penaltyRate = params.relaxedProductLength ? 0.05 : 0.15
    productLengthPenalty = prodLenDev > 50 ? Math.round((prodLenDev - 50) * penaltyRate * 100) / 100 : 0
  }

  // 6b. 产物边界贴合度惩罚（仅 amplify-region 模式）
  let boundaryPenalty = 0
  if (mode === 'amplify-region' && selectionStart !== undefined && selectionEnd !== undefined) {
    const productStart = forward.position
    const productEnd0 = reverse.position + reverse.length - 1
    const startDev = Math.abs(productStart - selectionStart)
    const endDev = Math.abs(productEnd0 - selectionEnd)
    boundaryPenalty = Math.round((startDev + endDev) * 3.0 * 100) / 100
  }

  // 7. 3'端稳定性 (|ΔG| 在 3-8 之间最佳，太稳定或太不稳定都扣分)
  const fwd3pDG = Math.abs(forward.threePrimeDG)
  const rev3pDG = Math.abs(reverse.threePrimeDG)
  const threePrimePenalty = Math.round((
    (fwd3pDG < 3 ? (3 - fwd3pDG) * 2 : fwd3pDG > 8 ? (fwd3pDG - 8) * 1.5 : 0) +
    (rev3pDG < 3 ? (3 - rev3pDG) * 2 : rev3pDG > 8 ? (rev3pDG - 8) * 1.5 : 0)
  ) * 100) / 100

  // 8. 同聚物扣分 (连续 >3 个相同碱基)
  const fwdHomopolymer = maxHomopolymerSeq(forward.sequence)
  const revHomopolymer = maxHomopolymerSeq(reverse.sequence)
  const homopolymerPenalty = Math.round((
    (fwdHomopolymer > 3 ? (fwdHomopolymer - 3) * 3 : 0) +
    (revHomopolymer > 3 ? (revHomopolymer - 3) * 3 : 0)
  ) * 100) / 100

  // 9. 自身互补性扣分 (>4 部分每单位扣 2 分)
  const selfComplPenalty = Math.round((
    (forward.selfComplementarity > 4 ? (forward.selfComplementarity - 4) * 2 : 0) +
    (reverse.selfComplementarity > 4 ? (reverse.selfComplementarity - 4) * 2 : 0)
  ) * 100) / 100

  // 10. 3'端互补性扣分 (>2 部分每单位扣 5 分)
  const threePrimeComplPenalty = Math.round((
    (forward.selfThreePrimeComplementarity > 2 ? (forward.selfThreePrimeComplementarity - 2) * 5 : 0) +
    (reverse.selfThreePrimeComplementarity > 2 ? (reverse.selfThreePrimeComplementarity - 2) * 5 : 0)
  ) * 100) / 100

  // 11. GC clamp 惩罚（3'端为 G/C 最佳，A/T 每个扣 2 分）
  const fwdGcClampPenalty = forward.gcClamp ? 0 : 2
  const revGcClampPenalty = reverse.gcClamp ? 0 : 2
  const gcClampPenalty = fwdGcClampPenalty + revGcClampPenalty

  // 12. 特异性惩罚 (每个 off-target 扣 5 分)
  const fwdSpecPenalty = (forward.offTargetCount ?? 0) * 5
  const revSpecPenalty = (reverse.offTargetCount ?? 0) * 5
  const specificityPenalty = fwdSpecPenalty + revSpecPenalty

  // 13. 回文惩罚（优先使用预计算值，避免配对循环中重复调用 calcPalindromeLength）
  const fwdPalindrome = preFwdPalindrome ?? calcPalindromeLength(forward.sequence)
  const revPalindrome = preRevPalindrome ?? calcPalindromeLength(reverse.sequence)
  const palindromePenalty = Math.round((
    (fwdPalindrome > 4 ? (fwdPalindrome - 4) * 2 : 0) +
    (revPalindrome > 4 ? (revPalindrome - 4) * 2 : 0)
  ) * 100) / 100

  // 加权归一化：从 params.weights 读取用户权重，归一化为总和 1.0
  const w = params.weights
  const dimerCombined = dimerPenalty + crossDimerPenalty
  const productCombined = productLengthPenalty + boundaryPenalty
  const relaxed = params.relaxedProductLength && mode !== 'amplify-region'

  // 构建 14 维权重数组（与 dimScore 顺序对应）
  const rawWeights = [
    w.tm,           // Tm 偏差
    w.tmDiff,       // Tm 差异
    w.gc,           // GC 偏差
    w.gcDiff,       // GC 差异
    w.hairpin,      // 发夹
    w.dimer,        // 二聚体
    w.dimer,        // 产物长度/边界
    w.threePrime,   // 3'端稳定性
    w.homopolymer,  // 同聚物
    w.selfComplementarity, // 自互补
    w.threePrime,   // 3'端互补
    w.gcClamp,      // GC clamp
    w.specificity,  // 特异性
    w.palindrome,   // 回文
  ]

  // 各维度的 cap 值
  const caps = [40, 20, 20, 20, 20, 30, 50, 15, 15, 15, 20, 4, 15, 20]
  const penalties = [
    tmPenalty, tmDiffPenalty, gcPenalty, gcDiffPenalty, hairpinPenalty,
    dimerCombined, productCombined, threePrimePenalty,
    homopolymerPenalty, selfComplPenalty, threePrimeComplPenalty,
    gcClampPenalty, specificityPenalty, palindromePenalty
  ]

  // 新评分公式：取消归一化，权重直接作为乘数
  // pairScore = Σ(dimScore_i × weight_i) / Σ(maxScore_i × weight_i) × 100
  // weight=0 时该维度既不贡献分子也不贡献分母（完全忽略）
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < penalties.length; i++) {
    const wi = rawWeights[i]
    if (wi === 0) continue // 权重为 0 时完全跳过该维度
    numerator += dimScore(penalties[i], caps[i]) * wi
    denominator += 100 * wi // 每维度满分 100
  }

  // 若所有权重为 0，回退为满分
  const pairScore = denominator > 0 ? (numerator / denominator) * 100 : 100

  return {
    pairScore: Math.round(pairScore * 10) / 10,
    scoreBreakdown: {
      tmPenalty, tmDiffPenalty, gcPenalty, hairpinPenalty,
      dimerPenalty, crossDimerPenalty,
      productLengthPenalty, boundaryPenalty, threePrimePenalty,
      homopolymerPenalty, selfComplPenalty, threePrimeComplPenalty,
      gcClampPenalty, specificityPenalty, palindromePenalty, rawScore: 100
    }
  }
}

function maxHomopolymerSeq(seq: string): number {
  const s = seq.toUpperCase()
  let max = 0
  let current = 1
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) { current++; max = Math.max(max, current) }
    else { current = 1 }
  }
  return Math.max(max, current)
}
