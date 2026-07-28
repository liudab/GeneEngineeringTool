/**
 * 热力学计算模块
 * Tm: Nearest-Neighbor 方法 (SantaLucia 1998)
 * GC%, 3'端稳定性
 */

/** NN 热力学参数 (SantaLucia 1998, PNAS 95:1460-1465) ΔH cal/mol, ΔS cal/(mol·K) */
const NN_PARAMS: Record<string, { dH: number; dS: number }> = {
  'AA': { dH: -7900, dS: -22.2 }, 'TT': { dH: -7900, dS: -22.2 },
  'AT': { dH: -7200, dS: -20.4 },
  'TA': { dH: -7200, dS: -21.3 },
  'CA': { dH: -8500, dS: -22.7 }, 'TG': { dH: -8500, dS: -22.7 },
  'GT': { dH: -8400, dS: -22.4 }, 'AC': { dH: -8400, dS: -22.4 },
  'CT': { dH: -7800, dS: -21.0 }, 'AG': { dH: -7800, dS: -21.0 },
  'GA': { dH: -8200, dS: -22.2 }, 'TC': { dH: -8200, dS: -22.2 },
  'CG': { dH: -10600, dS: -27.2 },
  'GC': { dH: -9800, dS: -24.4 },
  'GG': { dH: -8000, dS: -19.9 }, 'CC': { dH: -8000, dS: -19.9 }
}

/**
 * Loop 惩罚表 (SantaLucia 1998, Table 3 经验值)
 * 单位 kcal/mol (37°C)
 */
const LOOP_PENALTY: Record<number, number> = {
  3: 5.7, 4: 5.6, 5: 5.5, 6: 5.4, 7: 6.0, 8: 5.5, 9: 6.4, 10: 6.5
}

/**
 * Nearest-Neighbor Tm 计算 (SantaLucia 1998)
 * @param seq 引物序列 (5'→3')
 * @param primerConc 引物浓度 (M, default 250nM)
 * @param saltConc 盐浓度 (M, default 50mM Na+)
 *
 * 公式: Tm = ΔH / (ΔS + 0.368×(N-1)×ln[Na+] + R×ln(Ct)) - 273.15
 * - ΔS 盐校正: SantaLucia 1998, Eq. 5
 * - Ct (非 Ct/4): PCR 引物-模板杂交非自互补
 */
export function calcTm(seq: string, primerConc: number = 250e-9, saltConc: number = 0.05): number {
  const s = seq.toUpperCase()
  if (s.length < 2) return 0

  // 短引物（<14bp）用简化公式
  if (s.length < 14) {
    const gc = countGC(s)
    const at = s.length - gc
    return (at * 2 + gc * 4) - 5
  }

  // NN stacking（不含 initiation，SL98 unified 参数已自含）
  let totalDH = 0
  let totalDS = 0

  for (let i = 0; i < s.length - 1; i++) {
    const dinuc = s.substring(i, i + 2)
    const params = NN_PARAMS[dinuc]
    if (params) {
      totalDH += params.dH
      totalDS += params.dS
    }
  }

  // ΔS 盐校正 (SantaLucia 1998, Eq. 5): ΔS_salt = ΔS + 0.368 × (N-1) × ln[Na+]
  const R = 1.987 // cal/(mol·K)
  const N = s.length
  const dsSalt = totalDS + 0.368 * (N - 1) * Math.log(saltConc)

  // Tm = ΔH / (ΔS(salt) + R × ln(Ct))  — Ct 而非 Ct/4
  const tm = (totalDH / (dsSalt + R * Math.log(primerConc))) - 273.15

  return Math.round(tm * 100) / 100
}

/**
 * 计算 GC 含量百分比
 */
export function calcGc(seq: string): number {
  const s = seq.toUpperCase()
  if (s.length === 0) return 0
  const gc = countGC(s)
  return Math.round((gc / s.length) * 10000) / 100
}

/**
 * 3'端稳定性（最后5碱基的 NN ΔG 总和）
 * @param seq 引物序列 (5'→3')
 * @param tempK 计算温度 (K, default 310.15 = 37°C, SantaLucia 1998 标准参考温度)
 *   文献: SantaLucia 1998 PNAS 95:1460 — ΔG 报告温度惯例为 37°C
 *   注意: 此参数用于温度敏感性分析, 默认值保持与 Primer3/IDT 一致
 */
export function calcThreePrimeStability(seq: string, tempK: number = 310.15): number {
  const s = seq.toUpperCase()
  if (s.length < 2) return 0
  const tail = s.substring(Math.max(0, s.length - 5))
  let dG = 0
  for (let i = 0; i < tail.length - 1; i++) {
    const dinuc = tail.substring(i, i + 2)
    const params = NN_PARAMS[dinuc]
    if (params) {
      dG += (params.dH - tempK * params.dS) / 1000 // ΔG kcal/mol
    }
  }
  return Math.round(dG * 100) / 100
}

/**
 * 计算两条序列间的局部互补 ΔG（用于二聚体检测）
 * 使用 Smith-Waterman 局部对齐：仅寻找最佳连续互补片段，而非全局求和
 * 返回最低（最负）的 ΔG 值
 * @param tempK 计算温度 (K, default 310.15 = 37°C)
 *   文献: SantaLucia 1998 — NN ΔG 标准报告温度; Primer3 self_any_thal 使用 37°C
 */
export function calcDimerDG(seq1: string, seq2: string, tempK: number = 310.15): number {
  const s1 = seq1.toUpperCase()
  const s2 = reverseComplement(seq2.toUpperCase())
  let globalMinDG = 0

  for (let offset = -(s1.length - 3); offset < s2.length - 2; offset++) {
    const iStart = Math.max(0, -offset)
    const iEnd = Math.min(s1.length, s2.length - offset)
    if (iEnd - iStart < 3) continue

    // 在每个 offset 内做局部对齐：追踪最佳连续段
    let runDG = 0
    let bestRun = 0
    let consecutive = 0
    let prevWasMatch = false

    for (let i = iStart; i < iEnd; i++) {
      const j = i + offset
      if (s1[i] === s2[j]) {
        consecutive++
        // NN stacking（连续 2+ 匹配碱基对）— 已包含氢键贡献，不再额外加 per-base pairing
        if (prevWasMatch) {
          const dinuc = s1.substring(i - 1, i + 1)
          const params = NN_PARAMS[dinuc]
          if (params) {
            runDG += (params.dH - tempK * params.dS) / 1000 // kcal/mol
          }
        } else {
          // 首个匹配碱基对：仅起始贡献（~0 kcal/mol，NN 模型中 initiation 项已含在参数表内）
        }
        prevWasMatch = true
        if (runDG < bestRun) bestRun = runDG
      } else {
        // 错配打断连续段，重置
        consecutive = 0
        runDG = 0
        prevWasMatch = false
      }
    }
    if (bestRun < globalMinDG) globalMinDG = bestRun
  }
  return Math.round(globalMinDG * 100) / 100
}

/**
 * 发夹 ΔG 计算
 * 遍历可能的 stem+loop 组合，stem 使用 NN stacking 计算
 * @param tempK 计算温度 (K, default 310.15 = 37°C)
 *   文献: SantaLucia 1998 Table 3 (Loop 惩罚值基于 37°C)
 */
export function calcHairpinDG(seq: string, tempK: number = 310.15): number {
  const s = seq.toUpperCase()
  let minDG = 0
  const minStem = 3
  const maxStem = Math.min(8, Math.floor(s.length / 2))
  const minLoop = 3

  for (let stemLen = minStem; stemLen <= maxStem; stemLen++) {
    for (let i = 0; i <= s.length - 2 * stemLen - minLoop; i++) {
      const stem1 = s.substring(i, i + stemLen)
      const loopStart = i + stemLen
      const stem2Start = loopStart + minLoop
      if (stem2Start + stemLen > s.length) continue
      const stem2 = s.substring(stem2Start, stem2Start + stemLen)
      const loopLen = stem2Start - loopStart

      // 检查 stem 互补性（stem2 的 RC 应与 stem1 匹配）
      let matches = 0
      for (let j = 0; j < stemLen; j++) {
        if (isComplement(stem1[j], stem2[stemLen - 1 - j])) matches++
      }
      if (matches < stemLen - 1) continue // 允许1个错配

      // 计算 stem ΔG（使用正向链 NN stacking）
      let stemDG = 0
      for (let j = 0; j < stemLen - 1; j++) {
        const dinuc = stem1.substring(j, j + 2)
        const params = NN_PARAMS[dinuc]
        if (params) {
          stemDG += (params.dH - tempK * params.dS) / 1000 // kcal/mol
        }
      }
      // 闭合碱基对：取 loop 邻接碱基对（而非末端碱基对）
      // stem1[stemLen-1] 与 stem2[0] 是紧邻 loop 的配对碱基
      const closingPair = stem1[stemLen - 1] + stem2[0]
      stemDG += isComplement(stem1[stemLen - 1], stem2[0])
        ? ((closingPair.includes('G') || closingPair.includes('C')) ? -1.5 : -1.0)
        : 0

      // Loop 惩罚 (SantaLucia 1998, Table 3 经验值)
      const loopDG = LOOP_PENALTY[loopLen] ?? (5.4 + 0.2 * (loopLen - 6)) // loopLen>10 线性外推

      const totalDG = stemDG + loopDG
      if (totalDG < minDG) minDG = totalDG
    }
  }
  return Math.round(minDG * 100) / 100
}

/**
 * 检查同聚物连续碱基
 */
export function maxHomopolymer(seq: string): number {
  const s = seq.toUpperCase()
  let max = 0
  let current = 1
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) { current++; max = Math.max(max, current) }
    else { current = 1 }
  }
  return Math.max(max, current)
}

function countGC(s: string): number {
  let count = 0
  for (const c of s) { if (c === 'G' || c === 'C') count++ }
  return count
}

function complement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  return seq.split('').map(c => comp[c] || c).join('')
}

function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}

function isComplement(a: string, b: string): boolean {
  return (a === 'A' && b === 'T') || (a === 'T' && b === 'A') ||
         (a === 'G' && b === 'C') || (a === 'C' && b === 'G')
}

/**
 * 引物自身 3'端互补性得分（Primer3 self_end_complementarity 风格）
 * 检查引物 3'端与自身其他区域的反向互补匹配
 * 返回 3'端方向最大连续互补碱基数
 * 用于检测 3'端发夹形成风险
 */
export function calcSelfThreePrimeComplementarity(seq: string): number {
  const s = seq.toUpperCase()
  if (s.length < 3) return 0

  let maxMatches = 0

  // 检查引物 3'端最后 i 个碱基是否能与自身其他位置形成连续碱基对
  // 即 hairpin 模型：3'端折叠回自身
  for (let endLen = 2; endLen <= Math.min(s.length - 3, 10); endLen++) {
    for (let start = 0; start <= s.length - endLen - 3; start++) {
      // 确保 3'端区域和检查区域不重叠（至少 3bp 间隔作为 loop）
      if (start + endLen + 3 > s.length - endLen) continue

      let consecutive = 0
      for (let j = 0; j < endLen; j++) {
        const threePrimeBase = s[s.length - endLen + j]
        const checkBase = s[start + endLen - 1 - j]
        if (isComplement(threePrimeBase, checkBase)) {
          consecutive++
        } else {
          consecutive = 0 // 必须是连续匹配
        }
      }
      if (consecutive > maxMatches) maxMatches = consecutive
    }
  }

  return maxMatches
}

/**
 * 引物自身整体互补性得分（Primer3 self_complementarity_any 风格）
 * 使用加权评分：GC 配对 +3，AT 配对 +2，错配 -1
 * 采用 Kadane 算法实现局部对齐（仅追踪最佳连续互补片段）
 * 随机序列期望得分 ≈ 0，有结构的序列得分 > 5
 */
export function calcSelfComplementarity(seq: string): number {
  const s = seq.toUpperCase()
  if (s.length < 3) return 0

  // 使用 complement(s)（非 reverseComplement）— Primer3 self_complementarity_any 算法
  const comp = complement(s)
  let maxScore = 0

  // 滑动窗口比对 + Kadane 局部对齐
  for (let offset = -(s.length - 3); offset < comp.length - 2; offset++) {
    let currentScore = 0
    for (let i = 0; i < s.length; i++) {
      const j = i + offset
      if (j >= 0 && j < comp.length) {
        if (s[i] === comp[j]) {
          currentScore += (s[i] === 'G' || s[i] === 'C') ? 3 : 2
        } else {
          currentScore -= 1 // 错配惩罚（Primer3 标准）
        }
        // Kadane: 当累积分变负时重置（局部对齐核心）
        if (currentScore < 0) currentScore = 0
        if (currentScore > maxScore) maxScore = currentScore
      } else {
        // 超出有效范围，重置
        currentScore = 0
      }
    }
  }

  return maxScore
}

/**
 * 引物对间 3'端互补性（Primer3 pair_3_complementarity）
 * 检查正向引物 3'端与反向引物 3'端的互补程度
 * 返回最大连续互补碱基数
 */
export function calcPairThreePrimeComplementarity(fwd: string, rev: string): number {
  const f = fwd.toUpperCase()
  const r = rev.toUpperCase()
  if (f.length < 3 || r.length < 3) return 0
  
  const rcRev = reverseComplement(r)
  let maxMatches = 0
  
  // 检查正向 3'端与反向 3'端的互补
  // 正向 3'端: f[length-i...], 反向 3'端的互补: rcRev[length-j...]
  for (let len = 1; len <= Math.min(10, f.length, r.length); len++) {
    let matches = 0
    for (let i = 0; i < len; i++) {
      const fwdIdx = f.length - len + i
      const revIdx = rcRev.length - len + i
      if (fwdIdx < f.length && revIdx >= 0 && revIdx < rcRev.length) {
        if (f[fwdIdx] === rcRev[revIdx]) {
          matches++
        }
      }
    }
    if (matches > maxMatches) maxMatches = matches
  }
  
  return maxMatches
}

/**
 * 检测最长回文子串长度
 * 回文序列 = 连续子串与其反向互补相同的部分
 * 例如 GCGC 的反向互补是 GCGC，所以 GCGC 是 4bp 回文
 * 使用滑动窗口检查所有连续子串
 */
export function calcPalindromeLength(seq: string): number {
  const s = seq.toUpperCase()
  const n = s.length
  if (n < 2) return n

  let maxLen = 0

  // 检查所有连续子串是否为回文
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i <= n - len; i++) {
      const sub = s.substring(i, i + len)
      if (isDnaPalindrome(sub)) {
        if (len > maxLen) maxLen = len
        break // 当前长度已找到，无需继续同一长度的其他位置
      }
    }
  }

  return maxLen
}

/** 检查序列是否为 DNA 回文（序列 = 其反向互补） */
function isDnaPalindrome(seq: string): boolean {
  const n = seq.length
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    if (!isComplement(seq[i], seq[n - 1 - i])) return false
  }
  return true
}

/**
 * 3'端 10bp 区域严格发夹 dG 检查
 * 仅检查引物 3'端最后 10 个碱基（或更短）的发夹结构
 * @param seq 引物序列 (5'→3')
 * @param stemMinLen 发夹茎最小长度 (default 3)
 * @param tempK 计算温度 (K, default 310.15 = 37°C)
 * @returns 3'端区域最低发夹 dG (kcal/mol)，0 表示无发夹
 */
export function calcHairpinThreePrimeDG(seq: string, stemMinLen: number = 3, tempK: number = 310.15): number {
  const s = seq.toUpperCase()
  if (s.length < 6) return 0

  // 仅取 3'端 10bp 区域
  const threePrimeRegion = s.substring(Math.max(0, s.length - 10))
  const regionLen = threePrimeRegion.length
  let minDG = 0
  const minStem = stemMinLen
  const maxStem = Math.min(8, Math.floor(regionLen / 2))
  const minLoop = 3

  for (let stemLen = minStem; stemLen <= maxStem; stemLen++) {
    for (let i = 0; i <= regionLen - 2 * stemLen - minLoop; i++) {
      const stem1 = threePrimeRegion.substring(i, i + stemLen)
      const loopStart = i + stemLen
      const stem2Start = loopStart + minLoop
      if (stem2Start + stemLen > regionLen) continue
      const stem2 = threePrimeRegion.substring(stem2Start, stem2Start + stemLen)
      const loopLen = stem2Start - loopStart

      // 检查 stem 互补性
      let matches = 0
      for (let j = 0; j < stemLen; j++) {
        if (isComplement(stem1[j], stem2[stemLen - 1 - j])) matches++
      }
      if (matches < stemLen - 1) continue

      // 计算 stem ΔG
      let stemDG = 0
      for (let j = 0; j < stemLen - 1; j++) {
        const dinuc = stem1.substring(j, j + 2)
        const params = NN_PARAMS[dinuc]
        if (params) {
          stemDG += (params.dH - tempK * params.dS) / 1000 // kcal/mol
        }
      }
      // 闭合碱基对：取 loop 邻接碱基对
      const closingPair = stem1[stemLen - 1] + stem2[0]
      stemDG += isComplement(stem1[stemLen - 1], stem2[0])
        ? ((closingPair.includes('G') || closingPair.includes('C')) ? -1.5 : -1.0)
        : 0

      // Loop 惩罚 (SantaLucia 1998, Table 3 经验值)
      const loopDG = LOOP_PENALTY[loopLen] ?? (5.4 + 0.2 * (loopLen - 6))
      const totalDG = stemDG + loopDG
      if (totalDG < minDG) minDG = totalDG
    }
  }
  return Math.round(minDG * 100) / 100
}
