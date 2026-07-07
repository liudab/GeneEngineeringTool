/**
 * 热力学计算模块
 * Tm: Nearest-Neighbor 方法 (SantaLucia 1998)
 * GC%, 3'端稳定性
 */

/** NN 热力学参数 (SantaLucia 1998) ΔH cal/mol, ΔS cal/(mol·K) */
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

/** 初始化参数 (initiation) */
const INIT_PARAMS = { dH: 100, dS: -2.8 }

/** 盐校正系数 */
const SALT_CORRECTION = 16.6 // SantaLucia 1998 简化盐校正

/**
 * Nearest-Neighbor Tm 计算
 * @param seq 引物序列 (5'→3')
 * @param primerConc 引物浓度 (M, default 250nM)
 * @param saltConc 盐浓度 (M, default 50mM Na+)
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

  let totalDH = INIT_PARAMS.dH
  let totalDS = INIT_PARAMS.dS

  for (let i = 0; i < s.length - 1; i++) {
    const dinuc = s.substring(i, i + 2)
    const params = NN_PARAMS[dinuc]
    if (params) {
      totalDH += params.dH
      totalDS += params.dS
    }
  }

  // Tm = ΔH / (ΔS + R × ln(Ct/4)) - 273.15 + 盐校正
  const R = 1.987 // cal/(mol·K)
  const tm = (totalDH / (totalDS + R * Math.log(primerConc / 4))) - 273.15
  const saltCorrection = SALT_CORRECTION * Math.log10(saltConc)

  return Math.round((tm + saltCorrection) * 100) / 100
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
 */
export function calcThreePrimeStability(seq: string): number {
  const s = seq.toUpperCase()
  if (s.length < 2) return 0
  const tail = s.substring(Math.max(0, s.length - 5))
  let dG = 0
  for (let i = 0; i < tail.length - 1; i++) {
    const dinuc = tail.substring(i, i + 2)
    const params = NN_PARAMS[dinuc]
    if (params) {
      dG += params.dH - 310.15 * params.dS / 1000 // ΔG = ΔH - TΔS at 37°C
    }
  }
  return Math.round(dG * 100) / 100
}

/**
 * 计算两条序列间的局部互补 ΔG（用于二聚体检测）
 * 简化局部比对，返回最低 ΔG
 */
export function calcDimerDG(seq1: string, seq2: string): number {
  const s1 = seq1.toUpperCase()
  const s2 = reverseComplement(seq2.toUpperCase())
  let minDG = 0

  for (let offset = -(s1.length - 3); offset < s2.length - 2; offset++) {
    let dG = 0
    let matchLen = 0
    for (let i = 0; i < s1.length; i++) {
      const j = i + offset
      if (j >= 0 && j < s2.length && s1[i] === s2[j]) {
        matchLen++
        // 简化的每碱基贡献
        dG += (s1[i] === 'G' || s1[i] === 'C') ? -2.0 : -1.0
        // 连续匹配奖励
        if (matchLen >= 3) dG -= 0.5
      } else {
        matchLen = 0
        dG += 1.0 // 错配惩罚
      }
    }
    if (dG < minDG) minDG = dG
  }
  return Math.round(minDG * 100) / 100
}

/**
 * 发夹 ΔG 计算
 * 遍历可能的 stem+loop 组合
 */
export function calcHairpinDG(seq: string): number {
  const s = seq.toUpperCase()
  let minDG = 0
  const minStem = 3
  const maxStem = Math.min(8, Math.floor(s.length / 2))
  const minLoop = 3

  for (let stemLen = minStem; stemLen <= maxStem; stemLen++) {
    for (let i = 0; i <= s.length - 2 * stemLen - minLoop; i++) {
      const stem1 = s.substring(i, i + stemLen)
      const loopStart = i + stemLen
      // stem2 在 stem1 之后的反向互补匹配区
      const stem2Start = loopStart + minLoop
      if (stem2Start + stemLen > s.length) continue
      const stem2 = s.substring(s.length - stemLen - i, s.length - i)

      // 检查 stem 互补性
      let matches = 0
      for (let j = 0; j < stemLen; j++) {
        if (isComplement(stem1[j], stem2[stemLen - 1 - j])) matches++
      }
      if (matches < stemLen - 1) continue // 允许1个错配

      // 计算 stem ΔG
      let stemDG = 0
      for (let j = 0; j < stemLen - 1; j++) {
        const dinuc = stem1.substring(j, j + 2)
        const params = NN_PARAMS[dinuc]
        if (params) {
          stemDG += (params.dH - 310.15 * params.dS / 1000) / 1000 // kcal/mol
        }
      }
      // Loop 惩罚
      const loopLen = s.length - 2 * stemLen - i * 2
      const loopDG = loopLen >= 3 ? 4.0 + 1.75 * Math.log(loopLen) : 10.0

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

function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}

function isComplement(a: string, b: string): boolean {
  return (a === 'A' && b === 'T') || (a === 'T' && b === 'A') ||
         (a === 'G' && b === 'C') || (a === 'C' && b === 'G')
}
