/**
 * 蛋白质理化性质分析引擎
 * 规格书: optimization-spec.md §2.2.4 ProteinAnalysis, §3.5 蛋白质理化分析
 *
 * 功能: 分子量(MW) / 等电点(pI) / Kyte-Doolittle疏水性 / 氨基酸组成
 */

import { createLogger } from '../../utils/logger'

const log = createLogger('ProteinAnalysis')

// ============ 氨基酸分子量 (Da) — 残基质量（脱水后）============
const AA_MW: Record<string, number> = {
  A: 71.08, R: 156.19, N: 114.10, D: 115.09, C: 103.14,
  E: 129.12, Q: 128.13, G: 57.05, H: 137.14, I: 113.16,
  L: 113.16, K: 128.17, M: 131.20, F: 147.18, P: 97.12,
  S: 87.08, T: 101.11, W: 186.21, Y: 163.18, V: 99.13,
}

// 水分子质量
const WATER_MW = 18.02

// ============ pKa 值（用于 pI 计算）============
interface pKaValues { N_term: number; C_term: number; side: Record<string, number> }

const PKA: pKaValues = {
  N_term: 8.0,
  C_term: 3.1,
  side: {
    C: 8.3, D: 3.9, E: 4.1, H: 6.0, K: 10.5, R: 12.5, Y: 10.1,
  }
}

// ============ Kyte-Doolittle 疏水性标度 ============
const KD_HYDROPHOBICITY: Record<string, number> = {
  A: 1.8, R: -4.5, N: -3.5, D: -3.5, C: 2.5,
  E: -3.5, Q: -3.5, G: -0.4, H: -3.2, I: 4.5,
  L: 3.8, K: -3.9, M: 1.9, F: 2.8, P: -1.6,
  S: -0.8, T: -0.7, W: -0.9, Y: -1.3, V: 4.2,
}

// ============ 氨基酸三字母代码 ============
const AA_THREE: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys',
  E: 'Glu', Q: 'Gln', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro',
  S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
}

// ============ 分析接口 ============

export interface ProteinAnalysisResult {
  /** 蛋白质序列 */
  sequence: string
  /** 氨基酸数量 */
  length: number
  /** 分子量 (Da) */
  molecularWeight: number
  /** 等电点 */
  isoelectricPoint: number
  /** 氨基酸组成 (count) */
  composition: Record<string, number>
  /** 氨基酸组成 (%) */
  compositionPercent: Record<string, number>
  /** Kyte-Doolittle 滑动窗口疏水性 (窗口大小7) */
  hydrophobicity: number[]
  /** 疏水性均值 */
  avgHydrophobicity: number
  /** 不稳定系数 (Instability Index) */
  instabilityIndex: number
  /** 总正电荷 (pH 7) */
  totalPositiveCharge: number
  /** 总负电荷 (pH 7) */
  totalNegativeCharge: number
  /** 脂肪族指数 (Aliphatic Index) */
  aliphaticIndex: number
  /** GRAVY (Grand Average of Hydropathy) */
  gravy: number
}

/** 完整蛋白质分析 */
export function analyzeProtein(sequence: string): ProteinAnalysisResult {
  log.info(`Analyzing protein sequence: ${sequence.length} amino acids`)
  const seq = sequence.toUpperCase().replace(/[^A-Z]/g, '')

  // 氨基酸组成
  const composition: Record<string, number> = {}
  for (const aa of seq) {
    composition[aa] = (composition[aa] || 0) + 1
  }

  // 分子量 = 残基质量之和 + 水分子
  let mw = WATER_MW
  for (const aa of seq) {
    mw += AA_MW[aa] || 0
  }

  // 等电点（二分法）
  const pI = calculatePI(seq, composition)

  // 氨基酸百分比
  const compositionPercent: Record<string, number> = {}
  for (const [aa, count] of Object.entries(composition)) {
    compositionPercent[aa] = Math.round((count / seq.length) * 10000) / 100
  }

  // Kyte-Doolittle 疏水性（滑动窗口 = 7）
  const windowSize = 7
  const hydrophobicity = slidingWindowKD(seq, windowSize)

  // GRAVY
  let totalKD = 0
  for (const aa of seq) totalKD += (KD_HYDROPHOBICITY[aa] || 0)
  const gravy = seq.length > 0 ? totalKD / seq.length : 0

  // 电荷 (pH 7)
  const posCharge = (composition['K'] || 0) + (composition['R'] || 0) + (composition['H'] || 0) + 1 // N-term
  const negCharge = (composition['D'] || 0) + (composition['E'] || 0) + 1 // C-term

  // 不稳定指数 (Guruprasad 1990)
  const instabilityIndex = calculateInstabilityIndex(seq)

  // 脂肪族指数 (Ikai 1980)
  const a = (composition['A'] || 0) / seq.length * 100
  const b = ((composition['V'] || 0) + (composition['I'] || 0) + (composition['L'] || 0)) / seq.length * 100
  const aliphaticIndex = a + 2.9 * b

  log.debug(`Protein analysis complete: MW=${mw.toFixed(2)} Da, pI=${pI.toFixed(2)}`)
  return {
    sequence: seq,
    length: seq.length,
    molecularWeight: Math.round(mw * 100) / 100,
    isoelectricPoint: Math.round(pI * 100) / 100,
    composition,
    compositionPercent,
    hydrophobicity,
    avgHydrophobicity: hydrophobicity.length > 0 ? hydrophobicity.reduce((a, b) => a + b, 0) / hydrophobicity.length : 0,
    instabilityIndex: Math.round(instabilityIndex * 100) / 100,
    totalPositiveCharge: posCharge,
    totalNegativeCharge: negCharge,
    aliphaticIndex: Math.round(aliphaticIndex * 100) / 100,
    gravy: Math.round(gravy * 1000) / 1000,
  }
}

/** DNA → 蛋白质翻译（标准遗传密码） */
export function translateDNA(dnaSequence: string, frame = 0): string {
  log.info(`Translating DNA sequence: ${dnaSequence.length}bp, frame=${frame}`)
  const CODON_TABLE: Record<string, string> = {
    TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
    CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
    ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
    GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
    TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
    CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
    ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
    GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
    TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
    CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
    AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
    GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
    TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
    CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
    AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
    GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
  }

  const seq = dnaSequence.toUpperCase().replace(/[^ATGCN]/g, '')
  let protein = ''
  for (let i = frame; i + 2 < seq.length; i += 3) {
    const codon = seq.slice(i, i + 3)
    const aa = CODON_TABLE[codon]
    if (aa === '*') break // 终止密码子
    protein += aa || 'X'
  }
  return protein
}

// ============ 内部函数 ============

function calculatePI(seq: string, composition: Record<string, number>): number {
  // 二分法: 找到使净电荷为0的pH值
  let lo = 0, hi = 14
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2
    const charge = netCharge(seq, composition, mid)
    if (charge > 0) lo = mid
    else hi = mid
    if (Math.abs(charge) < 0.001) break
  }
  return (lo + hi) / 2
}

function netCharge(seq: string, composition: Record<string, number>, pH: number): number {
  let charge = 0
  // N-terminal
  charge += 1 / (1 + Math.pow(10, pH - PKA.N_term))
  // C-terminal
  charge -= 1 / (1 + Math.pow(10, PKA.C_term - pH))
  // Side chains
  for (const [aa, pKa] of Object.entries(PKA.side)) {
    const count = composition[aa] || 0
    if (aa === 'D' || aa === 'E' || aa === 'C' || aa === 'Y') {
      charge -= count / (1 + Math.pow(10, pKa - pH))
    } else {
      charge += count / (1 + Math.pow(10, pH - pKa))
    }
  }
  return charge
}

function slidingWindowKD(seq: string, windowSize: number): number[] {
  const result: number[] = []
  const half = Math.floor(windowSize / 2)
  for (let i = half; i < seq.length - half; i++) {
    let sum = 0
    for (let j = i - half; j <= i + half; j++) {
      sum += KD_HYDROPHOBICITY[seq[j]] || 0
    }
    result.push(sum / windowSize)
  }
  return result
}

/** Guruprasad 不稳定指数 (DIWV 二肽不稳定值) */
function calculateInstabilityIndex(seq: string): number {
  // 简化版：使用12个最常见不稳定二肽的平均值
  const UNSTABLE_DIPEPS: Record<string, number> = {
    'RR': 69.35, 'KK': 58.56, 'EE': 51.12, 'DD': 48.65,
    'KR': 46.17, 'RK': 43.80, 'RE': 42.30, 'ER': 40.43,
    'DE': 38.11, 'ED': 36.55, 'KE': 34.20, 'EK': 32.15,
  }
  let totalDIWV = 0
  for (let i = 0; i < seq.length - 1; i++) {
    const dipep = seq.slice(i, i + 2)
    totalDIWV += UNSTABLE_DIPEPS[dipep] || 8.51 // 平均值
  }
  return seq.length > 1 ? (totalDIWV / (seq.length - 1)) * (10 / seq.length) : 0
}
