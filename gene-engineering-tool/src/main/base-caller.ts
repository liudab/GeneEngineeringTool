/**
 * AB1 碱基识别算法 (Base Caller) — V3
 *
 * 遵循 Sanger 测序色谱图的物理规律：
 *   1. 信号起始前噪声区跳过（引物二聚体等杂信号）
 *   2. 信号起始判定（第一个明确大高峰才开始识别）
 *   3. 主峰识别碱基（净信号窗口求和，最强通道 > 1.5x 次强通道）
 *   4. 杂峰/套峰忽略（低于主通道 30% 的通道不参与竞争）
 *   5. 信号衰减与终止（SNR 退化 / 信号过低 / 连续差峰 → 停止识别）
 *   6. 多聚碱基处理（峰宽异常时标记）
 *   7. Savitzky-Golay 平滑 + 局部基线扣除
 */

import { createLogger } from './logger'

const log = createLogger('BaseCaller')

export interface BaseCallResult {
  /** 碱基序列（长度 === peakPositions.length） */
  sequence: string
  /** 精修后的峰位数据点索引（与输入 peakPositions 一一对应） */
  refinedPeaks: number[]
  /** 每个碱基的 Phred 质量值（长度 === peakPositions.length） */
  qualityScores: number[]
}

const BASES = ['A', 'C', 'G', 'T'] as const

// ===================== 信号处理 =====================

/**
 * 5 点 Savitzky-Golay 平滑（二次多项式拟合）
 * 系数: [-3, 12, 17, 12, -3] / 35
 */
function smoothChannel(raw: number[]): number[] {
  const n = raw.length
  if (n < 5) return raw.slice()
  const out = new Float64Array(n)
  out[0] = raw[0]
  out[1] = raw[1]
  out[n - 2] = raw[n - 2]
  out[n - 1] = raw[n - 1]
  for (let i = 2; i < n - 2; i++) {
    out[i] = (-3 * raw[i - 2] + 12 * raw[i - 1] + 17 * raw[i] + 12 * raw[i + 1] - 3 * raw[i + 2]) / 35
  }
  return Array.from(out)
}

/**
 * 估计全局基线
 * 使用整个通道信号的 5% 百分位数作为全局基线
 * 避免局部窗口导致的通道间基线不一致
 */
function computeGlobalBaseline(channel: number[]): number {
  if (channel.length === 0) return 0
  const sorted = channel.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.05)] || 0
}

/** 扣除全局基线后的净信号（不允许负值） */
function subtractGlobalBaseline(channel: number[], baseline: number): number[] {
  const n = channel.length
  const net = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    net[i] = Math.max(0, channel[i] - baseline)
  }
  return Array.from(net)
}

// ===================== 峰分析工具 =====================

/** 在 pos 附近搜索合成信号的局部最大值（而非单通道，避免套峰区被杂峰误导） */
function refineOnCombined(combinedNet: ArrayLike<number>, pos: number, searchRadius: number): number {
  const n = combinedNet.length
  const lo = Math.max(0, pos - searchRadius)
  const hi = Math.min(n - 1, pos + searchRadius)
  let maxVal = -Infinity
  let maxPos = pos
  for (let j = lo; j <= hi; j++) {
    if (combinedNet[j] > maxVal) {
      maxVal = combinedNet[j]
      maxPos = j
    }
  }
  return maxPos
}

/** 净区窗口求和 */
function netWindowSum(netChannel: ArrayLike<number>, pos: number, w: number): number {
  const n = netChannel.length
  const lo = Math.max(0, pos - w)
  const hi = Math.min(n - 1, pos + w)
  let sum = 0
  for (let j = lo; j <= hi; j++) sum += netChannel[j]
  return sum
}

/** 测量峰的半高全宽 (FWHM) — 基于合成信号 */
function measureFWHM(combinedNet: ArrayLike<number>, peakPos: number): number {
  const n = combinedNet.length
  const peakVal = combinedNet[peakPos]
  if (peakVal <= 0) return 0
  const halfMax = peakVal / 2

  let left = peakPos
  for (let j = peakPos - 1; j >= 0; j--) {
    if (combinedNet[j] <= halfMax) break
    left = j
  }
  let right = peakPos
  for (let j = peakPos + 1; j < n; j++) {
    if (combinedNet[j] <= halfMax) break
    right = j
  }
  return right - left
}

/** 基于净信号 SNR 计算 Phred 质量值 */
function computeQuality(netSums: number[]): number {
  const sorted = netSums.slice().sort((a, b) => b - a)
  const winner = Math.max(sorted[0], 1)
  const second = Math.max(sorted[1], 0)
  if (second === 0) return 60
  const ratio = winner / second
  if (ratio < 1.3) return 2
  if (ratio < 1.8) return 5
  if (ratio < 2.5) return 10
  if (ratio < 3.5) return 20
  if (ratio < 5) return 30
  if (ratio < 8) return 40
  if (ratio < 16) return 50
  return 60
}

// ===================== 主函数 =====================

/**
 * 碱基识别 V3 — 遵循 Sanger 测序物理规律
 *
 * @param traces  四通道 trace 数据
 * @param peakPositions  仪器 PLOC（数据点索引）
 * @param existingQuality  仪器 PQV（可选）
 */
export function callBases(
  traces: { A: number[]; C: number[]; G: number[]; T: number[] },
  peakPositions: number[],
  existingQuality?: number[],
): BaseCallResult {
  if (peakPositions.length === 0) {
    return { sequence: '', refinedPeaks: [], qualityScores: [] }
  }

  const nPeaks = peakPositions.length

  // ========== Step 1: 信号准备 ==========
  // ABIF 分析后数据已经过仪器颜色校正
  // 应用全局基线扣除以消除背景噪声对通道竞争的影响
  const baselines: Record<string, number> = {
    A: computeGlobalBaseline(traces.A),
    C: computeGlobalBaseline(traces.C),
    G: computeGlobalBaseline(traces.G),
    T: computeGlobalBaseline(traces.T),
  }
  const net: Record<string, number[]> = {
    A: subtractGlobalBaseline(traces.A, baselines.A),
    C: subtractGlobalBaseline(traces.C, baselines.C),
    G: subtractGlobalBaseline(traces.G, baselines.G),
    T: subtractGlobalBaseline(traces.T, baselines.T),
  }
  const netArr = [net.A, net.C, net.G, net.T]
  log.debug(`Baselines: A=${Math.round(baselines.A)}, C=${Math.round(baselines.C)}, G=${Math.round(baselines.G)}, T=${Math.round(baselines.T)}`)

  // 计算平均峰间距
  let avgSpacing = 25
  if (nPeaks > 1) {
    avgSpacing = Math.round((peakPositions[nPeaks - 1] - peakPositions[0]) / (nPeaks - 1))
  }

  // 构建合成净信号（每点取四通道最大值）
  const dataPoints = Math.max(net.A.length, net.C.length, net.G.length, net.T.length)
  const combinedNet = new Float64Array(dataPoints)
  for (let i = 0; i < dataPoints; i++) {
    combinedNet[i] = Math.max(net.A[i] || 0, net.C[i] || 0, net.G[i] || 0, net.T[i] || 0)
  }

  // ========== Step 2: 信号起始判定 ==========
  const plocSignals: number[] = []
  for (let k = 0; k < nPeaks; k++) {
    const pos = peakPositions[k]
    if (pos < dataPoints) plocSignals.push(combinedNet[pos])
  }
  plocSignals.sort((a, b) => a - b)
  const medianSignal = plocSignals.length > 0
    ? plocSignals[Math.floor(plocSignals.length / 2)] : 0

  // 起始阈值：中位数的 20%
  const startThreshold = medianSignal * 0.2

  let signalStartIdx = 0
  for (let k = 0; k < nPeaks; k++) {
    const pos = peakPositions[k]
    if (pos < dataPoints && combinedNet[pos] >= startThreshold) {
      signalStartIdx = k; break
    }
  }

  // 计算中位数 FWHM（用中位数而非平均值，更鲁棒）
  const fwhmValues: number[] = []
  for (let k = signalStartIdx; k < nPeaks; k++) {
    const pos = peakPositions[k]
    if (pos < dataPoints && combinedNet[pos] >= startThreshold) {
      fwhmValues.push(measureFWHM(combinedNet, pos))
    }
  }
  fwhmValues.sort((a, b) => a - b)
  const medianFwhm = fwhmValues.length > 0
    ? fwhmValues[Math.floor(fwhmValues.length / 2)] : 10

  // ========== Step 3: 套峰检测 — 预计算每个峰的属性 ==========
  interface PeakAttr {
    origPos: number
    refinedPos: number
    signal: number     // 合成信号峰值
    fwhm: number
    suppressed: boolean // 套峰抑制标记
  }
  const peakAttrs: PeakAttr[] = []
  const refineRadius = Math.max(5, Math.round(avgSpacing * 0.4))

  for (let k = 0; k < nPeaks; k++) {
    const origPos = peakPositions[k]
    const refined = refineOnCombined(combinedNet, origPos, refineRadius)
    const clamped = Math.max(0, Math.min(dataPoints - 1, refined))
    const signal = clamped < dataPoints ? combinedNet[clamped] : 0
    const fwhm = measureFWHM(combinedNet, clamped)
    peakAttrs.push({ origPos, refinedPos: clamped, signal, fwhm, suppressed: false })
  }

  // --- 套峰检测第一层：精修后去重（多个 PLOC 收敛到同一位置）---
  const dedupThreshold = avgSpacing * 0.3
  for (let i = 0; i < nPeaks - 1; i++) {
    const cur = peakAttrs[i]
    const nxt = peakAttrs[i + 1]
    if (cur.suppressed || nxt.suppressed) continue
    const spacing = Math.abs(nxt.refinedPos - cur.refinedPos)
    if (spacing < dedupThreshold) {
      // 精修后位置极近 → 只保留信号更强的
      if (cur.signal >= nxt.signal) nxt.suppressed = true
      else cur.suppressed = true
    }
  }

  // --- 套峰检测第二层：滑动窗口峰密度检查 ---
  // 在 avgSpacing×1.0 窗口内，只保留合成信号最强的 PLOC
  const densityWindow = Math.round(avgSpacing * 1.0)
  for (let i = 0; i < nPeaks; i++) {
    if (peakAttrs[i].suppressed) continue
    // 找到窗口内所有未抑制的峰
    let strongest = i
    for (let j = i + 1; j < nPeaks; j++) {
      if (peakAttrs[j].suppressed) continue
      if (peakAttrs[j].refinedPos - peakAttrs[i].refinedPos > densityWindow) break
      // 窗口内的另一个峰
      if (peakAttrs[j].signal > peakAttrs[strongest].signal) {
        strongest = j
      }
    }
    // 抑制窗口内非最强的峰
    for (let j = i + 1; j < nPeaks; j++) {
      if (peakAttrs[j].suppressed) continue
      if (peakAttrs[j].refinedPos - peakAttrs[i].refinedPos > densityWindow) break
      if (j !== strongest) {
        peakAttrs[j].suppressed = true
      }
    }
  }

  // --- 套峰检测第三层：相邻峰间距 + 信号强度比 ---
  const overlapThreshold = avgSpacing * 0.75
  for (let i = 0; i < nPeaks - 1; i++) {
    const cur = peakAttrs[i]
    const nxt = peakAttrs[i + 1]
    if (cur.suppressed || nxt.suppressed) continue
    const spacing = nxt.refinedPos - cur.refinedPos

    if (spacing < overlapThreshold) {
      const ratio = Math.min(cur.signal, nxt.signal) / Math.max(cur.signal, nxt.signal, 1)
      if (ratio < 0.65) {
        if (cur.signal >= nxt.signal) nxt.suppressed = true
        else cur.suppressed = true
      }
    }
  }

  // ========== Step 4: 逐峰碱基识别 ==========
  const windowRadius = Math.max(5, Math.round(avgSpacing * 0.35))
  const minSnrRatio = 1.2

  // 诊断日志：前 20 个有效峰的原始信号 vs 净信号
  let diagCount = 0
  const DIAG_LIMIT = 20

  const sequence: string[] = []
  const refinedPeaks: number[] = []
  const qualityScores: number[] = []
  let consecutiveBadPeaks = 0
  let signalTerminated = false

  for (let k = 0; k < nPeaks; k++) {
    const attr = peakAttrs[k]
    refinedPeaks.push(attr.refinedPos)

    // 起始噪声区 / 信号已终止
    if (k < signalStartIdx || signalTerminated) {
      sequence.push('N')
      qualityScores.push(0)
      continue
    }

    // 套峰抑制：使用原始信号在 origPos 处判定，质量值为 0
    if (attr.suppressed) {
      const sigs: number[] = []
      for (let b = 0; b < 4; b++) sigs.push(netArr[b][attr.origPos] ?? 0)
      const s = sigs.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
      sequence.push(s[0].v > 0 ? BASES[s[0].i] : 'N')
      qualityScores.push(0)
      continue
    }

    // 信号过低 → 尝试给碱基但低质量，连续5个差峰才终止
    if (attr.signal <= 0) {
      sequence.push('N'); qualityScores.push(0)
      consecutiveBadPeaks++
      if (consecutiveBadPeaks >= 5) signalTerminated = true
      continue
    }
    if (attr.signal < startThreshold * 0.15) {
      consecutiveBadPeaks++
      if (consecutiveBadPeaks >= 5) {
        signalTerminated = true
        sequence.push('N'); qualityScores.push(0); continue
      }
    }

    // FWHM 异常检测：峰宽 < 中位数 × 0.4 或 > 中位数 × 2.0
    const fwhmAbnormal = attr.fwhm < medianFwhm * 0.4 || attr.fwhm > medianFwhm * 2.0

    // 碱基判定：使用原始 PLOC 位置处的信号（而非精修位置）
    // 精修位置可能偏移到邻近峰处，导致通道信号比例失真
    const pos = attr.origPos
    
    // 各通道在 PLOC 位置处的信号
    const signals: number[] = []
    for (let b = 0; b < 4; b++) {
      signals.push(netArr[b][pos] ?? 0)
    }

    // 诊断日志
    if (diagCount < DIAG_LIMIT) {
      diagCount++
      const rawAtPeak = BASES.map((b, i) => {
        const raw = traces[b]?.[pos] ?? 0
        return `${b}:raw=${raw}`
      })
      const sigStr = BASES.map((b, i) => `${b}=${Math.round(signals[i])}`).join(',')
      log.debug(`Peak[${k}] pos=${pos} | ${rawAtPeak.join(' | ')} | signals(${sigStr})`)
    }

    // 信号排序
    const sorted = signals.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
    const winner = sorted[0]
    const second = sorted[1]
    const ratio = second.v > 0 ? winner.v / second.v : 999

    // 判定碱基
    let calledBaseIdx = winner.i
    let quality = ratio > 5 ? 50 : ratio > 3 ? 35 : ratio > 2 ? 20 : ratio > 1.5 ? 10 : 5
    consecutiveBadPeaks = 0

    if (ratio < minSnrRatio) {
      sequence.push(BASES[calledBaseIdx]); qualityScores.push(2)
    } else {
      sequence.push(BASES[calledBaseIdx])
      if (existingQuality && k < existingQuality.length && existingQuality[k] > 0) {
        qualityScores.push(existingQuality[k])
      } else {
        let q = quality
        if (fwhmAbnormal) q = Math.min(q, 15)
        qualityScores.push(q)
      }
    }
  }

  // ========== 日志 ==========
  const validBases = sequence.filter(b => b !== 'N').length
  const suppressedCount = peakAttrs.filter(p => p.suppressed).length
  log.info(
    `${nPeaks} peaks → ${validBases} valid bases ` +
    `(skipped start: ${signalStartIdx}, suppressed overlap: ${suppressedCount}, ` +
    `terminated: ${signalTerminated}, startThr: ${Math.round(startThreshold)}, ` +
    `medianFWHM: ${Math.round(medianFwhm)}, avgSpacing: ${avgSpacing})`
  )

  return {
    sequence: sequence.join(''),
    refinedPeaks,
    qualityScores,
  }
}
