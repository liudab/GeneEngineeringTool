/**
 * 克隆模拟引擎 — 限制性酶切克隆 / Gibson Assembly / In-Fusion
 * 规格书参考: optimization-spec.md §2.2.1, 基因工程软件优化规格说明书.md §4.1.1
 */

import { createLogger } from '../../utils/logger'

const log = createLogger('CloningEngine')

// ============ 类型定义 ============

export type CloningMethod = 'restriction' | 'gibson' | 'infusion'

export interface CloneFragment {
  id: string
  name: string
  sequence: string           // 5'→3' DNA序列
  features?: { name: string; start: number; end: number; type?: string }[]
  // restriction: 5' 和 3' 端酶
  fivePrimeEnzyme?: string   // 5'端限制酶名
  threePrimeEnzyme?: string  // 3'端限制酶名
  // gibson/infusion: 重叠区
  fivePrimeOverlap?: string  // 5'端重叠序列 (15-40bp)
  threePrimeOverlap?: string // 3'端重叠序列
}

export interface EnzymeDef {
  name: string
  recognition: string        // 识别序列（5'→3'）
  cutPos: number             // 切割位点（距识别序列5'端的碱基数）
  overhang: number           // 突出端长度（正=5'突出，负=3'突出，0=平端）
  isPalindromic: boolean
  optimalBuffer?: string     // 推荐缓冲液
  methylationSensitive?: string | null  // 甲基化敏感性
}

/** 从数据库 RestrictionEnzyme 转换为 EnzymeDef */
export function dbEnzymeToDef(e: {
  name: string; recognition_sequence: string; cut_position: number;
  overhang_type?: string; overhang_length?: number;
  optimal_buffer?: string; methylation_sensitive?: string | null;
}): EnzymeDef {
  const ohType = e.overhang_type ?? '5prime'
  const ohLen = e.overhang_length ?? 4
  const overhang = ohType === 'blunt' ? 0 : ohType === '3prime' ? -ohLen : ohLen
  return {
    name: e.name,
    recognition: e.recognition_sequence,
    cutPos: e.cut_position,
    overhang,
    isPalindromic: true, // 默认，DB 中已有该字段但此处不需要
    optimalBuffer: e.optimal_buffer,
    methylationSensitive: e.methylation_sensitive
  }
}

/** 常见限制酶库（cut_pos 表示从识别序列 5' 端起第几个碱基后切割顶链） */
export const COMMON_ENZYMES: EnzymeDef[] = [
  { name: 'EcoRI',   recognition: 'GAATTC',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'BamHI',   recognition: 'GGATCC',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'HindIII', recognition: 'AAGCTT',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'NotI',    recognition: 'GCGGCCGC', cutPos: 2, overhang: 4,  isPalindromic: true },
  { name: 'XhoI',    recognition: 'CTCGAG',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'SalI',    recognition: 'GTCGAC',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'XbaI',    recognition: 'TCTAGA',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'PstI',    recognition: 'CTGCAG',   cutPos: 5, overhang: 4,  isPalindromic: true },
  { name: 'SmaI',    recognition: 'CCCGGG',   cutPos: 3, overhang: 0,  isPalindromic: true },
  { name: 'KpnI',    recognition: 'GGTACC',   cutPos: 5, overhang: 4,  isPalindromic: true },
  { name: 'SacI',    recognition: 'GAGCTC',   cutPos: 5, overhang: 4,  isPalindromic: true },
  { name: 'NdeI',    recognition: 'CATATG',   cutPos: 2, overhang: 4,  isPalindromic: true },
  { name: 'NcoI',    recognition: 'CCATGG',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'SpeI',    recognition: 'ACTAGT',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'ApaI',    recognition: 'GGGCCC',   cutPos: 5, overhang: 4,  isPalindromic: true },
  { name: 'BglII',   recognition: 'AGATCT',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'ClaI',    recognition: 'ATCGAT',   cutPos: 2, overhang: 4,  isPalindromic: true },
  { name: 'EcoRV',   recognition: 'GATATC',   cutPos: 3, overhang: 0,  isPalindromic: true },
  { name: 'SphI',    recognition: 'GCATGC',   cutPos: 5, overhang: 4,  isPalindromic: true },
  { name: 'StuI',    recognition: 'AGGCCT',   cutPos: 3, overhang: 0,  isPalindromic: true },
  { name: 'AflII',   recognition: 'CTTAAG',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'AvrII',   recognition: 'CCTAGG',   cutPos: 1, overhang: 4,  isPalindromic: true },
  { name: 'BsaI',    recognition: 'GGTCTC',   cutPos: 7, overhang: 4,  isPalindromic: false },
  { name: 'BbsI',    recognition: 'GAAGAC',   cutPos: 8, overhang: 4,  isPalindromic: false },
]

export interface DigestResult {
  /** 线性化载体（酶切后去除5'突出或补齐） */
  linearizedVector: string
  /** 切下的片段（stuffer） */
  removedFragment: string | null
  /** 5'端粘性末端序列 */
  fivePrimeOverhang: string
  /** 3'端粘性末端序列 */
  threePrimeOverhang: string
  /** 切割位点 */
  cutSite5: number
  cutSite3: number
}

export interface CloningResult {
  success: boolean
  method: CloningMethod
  /** 最终构建产物序列 */
  productSequence: string
  /** 产物长度 */
  productLength: number
  /** 各片段在产物中的位置 */
  fragmentMap: { name: string; start: number; end: number }[]
  /** 连接位点信息 */
  junctions: { position: number; type: string; compatible: boolean }[]
  /** 警告信息 */
  warnings: string[]
  /** 错误信息 */
  errors: string[]
}

// ============ 工具函数 ============

const COMP: Record<string, string> = {
  a: 't', t: 'a', c: 'g', g: 'c',
  A: 'T', T: 'A', C: 'G', G: 'C'
}

function reverseComplement(seq: string): string {
  return seq.split('').map(c => COMP[c] || c).reverse().join('')
}

/** 在序列中查找酶识别位点（返回所有匹配位置） */
function findRecognitionSites(sequence: string, recognition: string): number[] {
  const sites: number[] = []
  const seq = sequence.toUpperCase()
  const rec = recognition.toUpperCase()
  const rc = reverseComplement(rec)
  let i = seq.indexOf(rec)
  while (i !== -1) { sites.push(i); i = seq.indexOf(rec, i + 1) }
  // 回文序列不重复搜索
  if (rc !== rec) {
    let j = seq.indexOf(rc)
    while (j !== -1) { sites.push(j); j = seq.indexOf(rc, j + 1) }
  }
  return sites.sort((a, b) => a - b)
}

/** 计算酶切后的粘性末端 */
function getOverhang(enzyme: EnzymeDef, _strand: 'top' | 'bottom' = 'top'): string {
  if (enzyme.overhang === 0) return '' // 平端
  if (enzyme.overhang > 0) {
    // 5' 突出: 切割后顶链 5'端露出
    return enzyme.recognition.slice(enzyme.cutPos, enzyme.cutPos + enzyme.overhang)
  }
  // 3' 突出
  const oh = Math.abs(enzyme.overhang)
  return enzyme.recognition.slice(enzyme.cutPos - oh, enzyme.cutPos)
}

/** 检查两个粘性末端是否兼容（互补） */
export function areOverhangsCompatible(oh5: string, oh3: string): boolean {
  if (!oh5 && !oh3) return true // 平端连接
  if (oh5.length !== oh3.length) return false
  return oh5.toUpperCase() === reverseComplement(oh3).toUpperCase()
}

// ============ 限制性酶切克隆 ============

/** 模拟双酶切载体 */
export function digestVector(
  vectorSeq: string,
  enzyme5: EnzymeDef,
  enzyme3: EnzymeDef
): DigestResult | { error: string } {
  log.info(`Digesting vector (${vectorSeq.length}bp) with ${enzyme5.name} + ${enzyme3.name}`)
  const sites5 = findRecognitionSites(vectorSeq, enzyme5.recognition)
  const sites3 = findRecognitionSites(vectorSeq, enzyme3.recognition)

  if (sites5.length === 0) return { error: `载体中未找到 ${enzyme5.name} 识别位点 (${enzyme5.recognition})` }
  if (sites3.length === 0) return { error: `载体中未找到 ${enzyme3.name} 识别位点 (${enzyme3.recognition})` }

  // 选择最近的两个位点（取第一个5'酶位点和其后最近的3'酶位点）
  const cut5 = sites5[0] + enzyme5.cutPos
  let cut3 = -1
  for (const s of sites3) {
    const pos = s + enzyme3.cutPos
    if (pos > cut5) { cut3 = pos; break }
  }
  if (cut3 === -1) return { error: `${enzyme3.name} 位点不在 ${enzyme5.name} 位点下游` }

  const linearized = vectorSeq.slice(0, cut5) + vectorSeq.slice(cut3)
  const removed = vectorSeq.slice(cut5, cut3)
  const oh5 = getOverhang(enzyme5)
  const oh3 = reverseComplement(getOverhang(enzyme3))

  return {
    linearizedVector: linearized,
    removedFragment: removed,
    fivePrimeOverhang: oh5,
    threePrimeOverhang: oh3,
    cutSite5: cut5,
    cutSite3: cut3,
  }
}

/** 模拟连接（载体 + 插入片段） */
export function ligate(
  vector: string,
  insert: string,
  vecOh5: string,
  vecOh3: string,
  insOh5: string,
  insOh3: string,
): CloningResult {
  log.info(`Ligating vector (${vector.length}bp) + insert (${insert.length}bp)`)
  const errors: string[] = []
  const warnings: string[] = []
  const junctions: { position: number; type: string; compatible: boolean }[] = []

  // 检查5'端兼容性
  const j5ok = areOverhangsCompatible(vecOh5, insOh5)
  if (!j5ok) errors.push(`5'端粘性末端不兼容: 载体 ${vecOh5} vs 插入片段 ${insOh5}`)
  junctions.push({ position: vector.length, type: `${vecOh5}-${insOh5}`, compatible: j5ok })

  // 检查3'端兼容性
  const j3ok = areOverhangsCompatible(insOh3, vecOh3)
  if (!j3ok) errors.push(`3'端粘性末端不兼容: 插入片段 ${insOh3} vs 载体 ${vecOh3}`)
  junctions.push({ position: vector.length + insert.length, type: `${insOh3}-${vecOh3}`, compatible: j3ok })

  if (errors.length > 0) {
    return {
      success: false, method: 'restriction', productSequence: '', productLength: 0,
      fragmentMap: [], junctions, warnings, errors
    }
  }

  // 连接
  const product = vector + insert
  const fragmentMap = [
    { name: '载体', start: 0, end: vector.length },
    { name: '插入片段', start: vector.length, end: vector.length + insert.length }
  ]

  // 平端警告
  if (!vecOh5 && !vecOh3) warnings.push('平端连接效率较低，建议使用粘性末端')

  return {
    success: true, method: 'restriction',
    productSequence: product,
    productLength: product.length,
    fragmentMap, junctions, warnings, errors: []
  }
}

// ============ Gibson Assembly ============

/** 设计 Gibson 重叠区引物 */
export function designGibsonOverlap(fragment1End: string, fragment2Start: string, overlapLen = 20): {
  fwdPrimer: string
  revPrimer: string
  overlap: string
  tm: number
} {
  // 取 fragment1 末端的最后 overlapLen 碱基作为重叠区
  const overlap = fragment1End.slice(-overlapLen).toUpperCase()
  const fwdPrimer = overlap + fragment2Start.slice(0, 20).toUpperCase()
  const revPrimer = reverseComplement(overlap)

  // 简单 Tm 估算（2°C × AT + 4°C × GC）
  const gc = overlap.split('').filter(c => 'GCgc'.includes(c)).length
  const at = overlap.length - gc
  const tm = 2 * at + 4 * gc

  return { fwdPrimer, revPrimer, overlap, tm }
}

/** 模拟 Gibson Assembly（多片段组装） */
export function simulateGibson(fragments: CloneFragment[]): CloningResult {
  log.info(`Simulating Gibson Assembly with ${fragments.length} fragments`)
  const errors: string[] = []
  const warnings: string[] = []
  const junctions: { position: number; type: string; compatible: boolean }[] = []
  const fragmentMap: { name: string; start: number; end: number }[] = []

  if (fragments.length < 2) {
    return {
      success: false, method: 'gibson', productSequence: '', productLength: 0,
      fragmentMap: [], junctions: [], warnings: [],
      errors: ['Gibson Assembly 至少需要 2 个片段']
    }
  }

  // 验证重叠区
  let product = ''
  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]
    const nextFrag = fragments[(i + 1) % fragments.length]

    // 检查重叠区
    const overlap3 = frag.threePrimeOverlap || frag.sequence.slice(-20).toUpperCase()
    const overlap5 = nextFrag.fivePrimeOverlap || nextFrag.sequence.slice(0, 20).toUpperCase()

    if (overlap3.toUpperCase() !== overlap5.toUpperCase()) {
      errors.push(`片段 ${frag.name} 3'端与 ${nextFrag.name} 5'端重叠区不匹配`)
      junctions.push({ position: product.length + frag.sequence.length, type: 'overlap-mismatch', compatible: false })
    } else {
      junctions.push({ position: product.length + frag.sequence.length, type: `overlap(${overlap3.length}bp)`, compatible: true })
    }

    fragmentMap.push({ name: frag.name, start: product.length, end: product.length + frag.sequence.length })
    product += frag.sequence
  }

  // Tm 警告
  for (const frag of fragments) {
    const ov = frag.threePrimeOverlap || ''
    if (ov.length < 15) warnings.push(`片段 ${frag.name} 重叠区过短 (${ov.length}bp)，建议 ≥15bp`)
    if (ov.length > 40) warnings.push(`片段 ${frag.name} 重叠区过长 (${ov.length}bp)，可能形成二级结构`)
  }

  return {
    success: errors.length === 0,
    method: 'gibson',
    productSequence: product,
    productLength: product.length,
    fragmentMap, junctions, warnings, errors
  }
}

// ============ In-Fusion 克隆 ============

/** 模拟 In-Fusion 克隆（类似 Gibson，使用 15bp 重叠区） */
export function simulateInFusion(vector: string, insert: string, overlapLen = 15): CloningResult {
  log.info(`Simulating In-Fusion cloning: vector(${vector.length}bp) + insert(${insert.length}bp), overlap=${overlapLen}bp`)
  const errors: string[] = []
  const warnings: string[] = []
  const junctions: { position: number; type: string; compatible: boolean }[] = []

  // In-Fusion 要求 15bp 重叠
  const vecEnd = vector.slice(-overlapLen).toUpperCase()
  const insStart = insert.slice(0, overlapLen).toUpperCase()
  const insEnd = insert.slice(-overlapLen).toUpperCase()
  const vecStart = vector.slice(0, overlapLen).toUpperCase()

  if (vecEnd !== insStart) {
    errors.push(`载体 3'端 (${vecEnd}) 与插入片段 5'端 (${insStart}) 重叠区不匹配`)
  }
  if (insEnd !== vecStart) {
    errors.push(`插入片段 3'端 (${insEnd}) 与载体 5'端 (${vecStart}) 重叠区不匹配`)
  }

  junctions.push(
    { position: vector.length, type: `In-Fusion 5' (${overlapLen}bp)`, compatible: vecEnd === insStart },
    { position: vector.length + insert.length, type: `In-Fusion 3' (${overlapLen}bp)`, compatible: insEnd === vecStart }
  )

  const product = vector + insert
  return {
    success: errors.length === 0,
    method: 'infusion',
    productSequence: product,
    productLength: product.length,
    fragmentMap: [
      { name: '载体', start: 0, end: vector.length },
      { name: '插入片段', start: vector.length, end: product.length }
    ],
    junctions, warnings, errors
  }
}

// ============ 双酶切兼容性检查 ============

/** 检查两种酶是否可以在同一缓冲液中工作 */
export function checkEnzymeCompatibility(
  enzyme1: EnzymeDef,
  enzyme2: EnzymeDef,
  seq: string
): {
  compatible: boolean
  distance: number
  warnings: string[]
  bufferRecommendation: string
} {
  log.info(`Checking enzyme compatibility: ${enzyme1.name} + ${enzyme2.name} on ${seq.length}bp sequence`)
  const warnings: string[] = []
  const sites1 = findRecognitionSites(seq, enzyme1.recognition)
  const sites2 = findRecognitionSites(seq, enzyme2.recognition)

  if (sites1.length === 0 || sites2.length === 0) {
    return { compatible: false, distance: -1, warnings: ['未找到酶切位点'], bufferRecommendation: '' }
  }

  // 计算最近位点距离
  let minDist = Infinity
  for (const s1 of sites1) {
    for (const s2 of sites2) {
      const d = Math.abs(s1 - s2)
      if (d < minDist) minDist = d
    }
  }

  if (minDist < 10) warnings.push(`两个酶切位点距离过近 (${minDist}bp)，可能影响酶切效率`)
  if (minDist < 3) warnings.push('位点重叠，不可同时使用')

  // 温度兼容性
  if (37 !== 37) warnings.push('两种酶的最适温度不同，需分步酶切') // placeholder

  return {
    compatible: minDist >= 10,
    distance: minDist,
    warnings,
    bufferRecommendation: minDist >= 10 ? '可使用通用缓冲液（如 NEBuffer 2.1 或 CutSmart）进行双酶切' : '建议分步酶切或使用不同酶'
  }
}

// ============ 切后片段计算 ============

/** 计算酶切后的所有片段 */
export function calculateDigestFragments(
  sequence: string,
  enzymes: EnzymeDef[]
): { start: number; end: number; length: number; fivePrimeOH: string; threePrimeOH: string }[] {
  log.info(`Calculating digest fragments: ${sequence.length}bp sequence with ${enzymes.length} enzyme(s)`)
  const allCuts: { pos: number; enzyme: string }[] = []

  for (const enz of enzymes) {
    const sites = findRecognitionSites(sequence, enz.recognition)
    for (const s of sites) {
      allCuts.push({ pos: s + enz.cutPos, enzyme: enz.name })
    }
  }

  allCuts.sort((a, b) => a.pos - b.pos)

  if (allCuts.length === 0) return [{ start: 0, end: sequence.length, length: sequence.length, fivePrimeOH: '', threePrimeOH: '' }]

  const fragments: { start: number; end: number; length: number; fivePrimeOH: string; threePrimeOH: string }[] = []

  // 线性序列：从 0 到第一个切点，各切点间，最后切点到末端
  let prev = 0
  for (const cut of allCuts) {
    if (cut.pos > prev) {
      fragments.push({
        start: prev, end: cut.pos, length: cut.pos - prev,
        fivePrimeOH: '', threePrimeOH: ''
      })
    }
    prev = cut.pos
  }
  if (prev < sequence.length) {
    fragments.push({
      start: prev, end: sequence.length, length: sequence.length - prev,
      fivePrimeOH: '', threePrimeOH: ''
    })
  }

  return fragments.sort((a, b) => b.length - a.length) // 按长度降序
}
