/**
 * 引物对评分系统 (100 分制)
 */

import type { PrimerDetail, DesignedPrimer, ScoreBreakdown, PrimerDesignParams } from './types'

/**
 * 对引物对进行评分
 */
export function scorePrimerPair(
  forward: PrimerDetail,
  reverse: PrimerDetail,
  productLength: number,
  params: PrimerDesignParams
): { pairScore: number; scoreBreakdown: ScoreBreakdown } {
  let rawScore = 100

  // 1. Tm 偏差扣分 (每偏离 optimalTm 1°C 扣 2 分)
  const fwdTmDev = Math.abs(forward.tm - params.optimalTm)
  const revTmDev = Math.abs(reverse.tm - params.optimalTm)
  const tmPenalty = Math.round((fwdTmDev + revTmDev) * 2 * 100) / 100

  // 2. 正反向 Tm 差异 (差异>5°C 开始扣分)
  const tmDiff = Math.abs(forward.tm - reverse.tm)
  const tmDiffPenalty = tmDiff > 5 ? Math.round((tmDiff - 5) * 3 * 100) / 100 : 0

  // 3. GC 偏差扣分 (偏离50%越远扣分越多)
  const fwdGcDev = Math.abs(forward.gc - 50)
  const revGcDev = Math.abs(reverse.gc - 50)
  const gcPenalty = Math.round(((fwdGcDev > 20 ? fwdGcDev - 20 : 0) + (revGcDev > 20 ? revGcDev - 20 : 0)) * 0.5 * 100) / 100

  // 4. 发夹惩罚
  const hairpinPenalty = Math.round((
    (forward.hairpinDG < params.hairpinThreshold ? Math.abs(forward.hairpinDG - params.hairpinThreshold) * 3 : 0) +
    (reverse.hairpinDG < params.hairpinThreshold ? Math.abs(reverse.hairpinDG - params.hairpinThreshold) * 3 : 0)
  ) * 100) / 100

  // 5. 二聚体惩罚
  const dimerPenalty = Math.round((
    (forward.homodimerDG < params.dimerThreshold ? Math.abs(forward.homodimerDG - params.dimerThreshold) * 2 : 0) +
    (reverse.homodimerDG < params.dimerThreshold ? Math.abs(reverse.homodimerDG - params.dimerThreshold) * 2 : 0)
  ) * 100) / 100

  // 6. 产物长度偏好
  const prodLenDev = Math.abs(productLength - params.optimalProductLength)
  const productLengthPenalty = prodLenDev > 200 ? Math.round((prodLenDev - 200) * 0.02 * 100) / 100 : 0

  // 7. 3'端稳定性 (太稳定或太不稳定都扣分)
  const fwd3pDG = Math.abs(forward.threePrimeDG)
  const rev3pDG = Math.abs(reverse.threePrimeDG)
  const threePrimePenalty = Math.round((
    (fwd3pDG < 3 ? (3 - fwd3pDG) * 2 : fwd3pDG > 8 ? (fwd3pDG - 8) * 1.5 : 0) +
    (rev3pDG < 3 ? (3 - rev3pDG) * 2 : rev3pDG > 8 ? (rev3pDG - 8) * 1.5 : 0)
  ) * 100) / 100

  // 8. 同聚物扣分 (连续>3个相同碱基)
  const homopolymerPenalty = 0 // 已在候选过滤中处理

  rawScore -= (tmPenalty + tmDiffPenalty + gcPenalty + hairpinPenalty +
               dimerPenalty + productLengthPenalty + threePrimePenalty + homopolymerPenalty)
  rawScore = Math.max(0, Math.min(100, rawScore))

  return {
    pairScore: Math.round(rawScore * 10) / 10,
    scoreBreakdown: {
      tmPenalty, tmDiffPenalty, gcPenalty, hairpinPenalty,
      dimerPenalty, productLengthPenalty, threePrimePenalty,
      homopolymerPenalty, rawScore: 100
    }
  }
}
