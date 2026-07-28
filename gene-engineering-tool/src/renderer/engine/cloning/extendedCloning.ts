/**
 * 扩展克隆方法引擎
 * 包含 Golden Gate、TA 克隆、TOPO 克隆、Gateway BP/LR
 * 以及定点诱变（Site-Directed Mutagenesis）
 */

import { createLogger } from '../../utils/logger'

const log = createLogger('ExtendedCloning')

// ============ 类型定义 ============

export type ExtendedCloningMethod = 'golden-gate' | 'ta' | 'topo' | 'gateway-bp' | 'gateway-lr'

export interface GoldenGateEntry {
  name: string
  recognition: string  // 4bp 识别序列（如 GGAG, AATG 等）
  enzyme: string       // 使用的 Type IIS 酶（BsaI, BbsI 等）
}

export interface GoldenGateResult {
  success: boolean
  productSequence: string
  productLength: number
  assemblyOrder: string[]
  junctions: { position: number; overhang: string; valid: boolean }[]
  warnings: string[]
  errors: string[]
}

export interface TACloneResult {
  success: boolean
  productSequence: string
  productLength: number
  insertStart: number
  insertEnd: number
  orientation: 'forward' | 'reverse'
  warnings: string[]
  errors: string[]
}

export interface TOPOCloneResult {
  success: boolean
  productSequence: string
  productLength: number
  insertStart: number
  insertEnd: number
  orientation: 'forward' | 'reverse'
  topoSite: string
  warnings: string[]
  errors: string[]
}

export interface GatewayResult {
  success: boolean
  productSequence: string
  productLength: number
  reactionType: 'BP' | 'LR'
  attSites: { name: string; position: number; sequence: string }[]
  warnings: string[]
  errors: string[]
}

export interface MutagenesisResult {
  success: boolean
  productSequence: string
  productLength: number
  mutationType: 'substitution' | 'insertion' | 'deletion'
  mutationPosition: number
  mutationLength: number
  originalSequence: string
  mutatedSequence: string
  primers: { forward: string; reverse: string }
  warnings: string[]
  errors: string[]
}

// ============ Golden Gate 克隆 ============

/** Type IIS 酶：识别后在识别位点外切割，产生自定义 4bp 突出 */
const TYPE_IIS_ENZYMES = {
  BsaI:  { recognition: 'GGTCTC', cutOffset: 1, overhangLen: 4 }, // 切割在识别序列下游 1bp 后，产生 4bp 5'突出
  BbsI:  { recognition: 'GAAGAC', cutOffset: 2, overhangLen: 4 },
  BsmBI: { recognition: 'CGTCTC', cutOffset: 1, overhangLen: 4 },
  SapI:  { recognition: 'GCTCTTC', cutOffset: 1, overhangLen: 3 },
}

/**
 * Golden Gate 组装
 * Type IIS 酶切产生 4bp 突出 → 多片段按顺序连接
 * @param fragments 片段列表，每个片段需包含 5'和3'的 4bp overhang
 * @param enzyme Type IIS 酶名称
 */
export function simulateGoldenGate(
  fragments: { name: string; sequence: string; fivePrimeOverhang: string; threePrimeOverhang: string }[],
  enzyme: string = 'BsaI'
): GoldenGateResult {
  log.info(`Simulating Golden Gate assembly: ${fragments.length} fragments with ${enzyme}`)
  const warnings: string[] = []
  const errors: string[] = []
  const junctions: GoldenGateResult['junctions'] = []

  if (fragments.length < 2) {
    return { success: false, productSequence: '', productLength: 0, assemblyOrder: [], junctions: [], warnings, errors: ['至少需要 2 个片段'] }
  }

  // 验证 overhang 长度
  for (const f of fragments) {
    if (f.fivePrimeOverhang.length !== 4) errors.push(`${f.name}: 5' 突出必须为 4bp (当前 ${f.fivePrimeOverhang.length}bp)`)
    if (f.threePrimeOverhang.length !== 4) errors.push(`${f.name}: 3' 突出必须为 4bp (当前 ${f.threePrimeOverhang.length}bp)`)
  }
  if (errors.length > 0) {
    return { success: false, productSequence: '', productLength: 0, assemblyOrder: [], junctions: [], warnings, errors }
  }

  // 检查连接顺序：每个片段的 3' overhang 必须与下一个片段的 5' overhang 互补
  const COMP: Record<string, string> = { a: 't', t: 'a', c: 'g', g: 'c', A: 'T', T: 'A', C: 'G', G: 'C' }
  const rc = (s: string) => s.split('').map(c => COMP[c] || c).reverse().join('')

  let product = ''
  const assemblyOrder: string[] = []

  for (let i = 0; i < fragments.length; i++) {
    const f = fragments[i]
    assemblyOrder.push(f.name)

    if (i === 0) {
      product = f.sequence
    } else {
      const prev = fragments[i - 1]
      const oh3 = prev.threePrimeOverhang.toUpperCase()
      const oh5 = f.fivePrimeOverhang.toUpperCase()
      const compatible = oh3 === rc(oh5)

      junctions.push({
        position: product.length,
        overhang: oh3,
        valid: compatible
      })

      if (!compatible) {
        errors.push(`${prev.name} 3'(${oh3}) 与 ${f.name} 5'(${oh5}) 不兼容`)
      }

      product += f.sequence
    }
  }

  // 环形检查：最后一个片段的 3' overhang 应与第一个片段的 5' overhang 兼容
  const last = fragments[fragments.length - 1]
  const first = fragments[0]
  const oh3Last = last.threePrimeOverhang.toUpperCase()
  const oh5First = first.fivePrimeOverhang.toUpperCase()
  const circularCompatible = oh3Last === rc(oh5First)
  junctions.push({
    position: product.length,
    overhang: oh3Last,
    valid: circularCompatible
  })
  if (circularCompatible) {
    warnings.push('片段可形成环状产物')
  }

  return {
    success: errors.length === 0,
    productSequence: product,
    productLength: product.length,
    assemblyOrder,
    junctions,
    warnings,
    errors
  }
}

// ============ TA 克隆 ============

/**
 * TA 克隆模拟
 * Taq 聚合酶 PCR 产物 3' 端带 A → 与 T-vector (3' 端 T 突出) 连接
 * @param insertSeq PCR 产物序列（不含 A 尾）
 * @param vectorSeq T-vector 序列（线性化，3' T 突出）
 */
export function simulateTACloning(
  insertSeq: string,
  vectorSeq: string
): TACloneResult {
  log.info(`Simulating TA cloning: insert(${insertSeq.length}bp) + vector(${vectorSeq.length}bp)`)
  const warnings: string[] = []
  const errors: string[] = []

  if (insertSeq.length < 50) errors.push('插入片段太短 (< 50bp)')
  if (vectorSeq.length < 100) errors.push('载体序列太短 (< 100bp)')
  if (errors.length > 0) {
    return { success: false, productSequence: '', productLength: 0, insertStart: 0, insertEnd: 0, orientation: 'forward', warnings, errors }
  }

  // 在插入片段 3' 端添加 A 尾
  const insertWithA = insertSeq + 'A'

  // T-vector 已在 3' 端有 T 突出，直接连接
  // 简化模型：将插入片段嵌入载体中间
  const midPoint = Math.floor(vectorSeq.length / 2)
  const vectorLeft = vectorSeq.slice(0, midPoint)
  const vectorRight = vectorSeq.slice(midPoint)

  // 正向插入
  const productFwd = vectorLeft + insertWithA + vectorRight
  // 反向插入
  const rc = (s: string) => {
    const COMP: Record<string, string> = { a: 't', t: 'a', c: 'g', g: 'c', A: 'T', T: 'A', C: 'G', G: 'C' }
    return s.split('').map(c => COMP[c] || c).reverse().join('')
  }
  const productRev = vectorLeft + rc(insertWithA) + vectorRight

  // 默认选择正向
  const orientation = 'forward'
  const product = productFwd

  if (insertSeq.length > 5000) warnings.push('大片段 TA 克隆效率较低，建议使用 Gibson Assembly')

  return {
    success: true,
    productSequence: product,
    productLength: product.length,
    insertStart: vectorLeft.length,
    insertEnd: vectorLeft.length + insertWithA.length - 1,
    orientation,
    warnings,
    errors
  }
}

// ============ TOPO 克隆 ============

/**
 * TOPO 克隆模拟
 * 拓扑异构酶 I 介导的连接（TOPO-TA 或 TOPO-Blunt）
 * @param insertSeq 插入片段序列
 * @param vectorSeq 线性化载体序列
 * @param type TA 或 Blunt
 */
export function simulateTOPOCloning(
  insertSeq: string,
  vectorSeq: string,
  type: 'TA' | 'Blunt' = 'TA'
): TOPOCloneResult {
  log.info(`Simulating TOPO cloning: insert(${insertSeq.length}bp) + vector(${vectorSeq.length}bp), type=${type}`)
  const warnings: string[] = []
  const errors: string[] = []
  const topoSite = type === 'TA' ? 'CACC' : '' // TOPO 载体含 CACC 序列

  if (insertSeq.length < 50) errors.push('插入片段太短')
  if (vectorSeq.length < 100) errors.push('载体序列太短')
  if (errors.length > 0) {
    return { success: false, productSequence: '', productLength: 0, insertStart: 0, insertEnd: 0, orientation: 'forward', topoSite, warnings, errors }
  }

  // 简化：将插入片段嵌入载体中间
  const midPoint = Math.floor(vectorSeq.length / 2)
  const insert = type === 'TA' ? insertSeq + 'A' : insertSeq
  const product = vectorSeq.slice(0, midPoint) + topoSite + insert + vectorSeq.slice(midPoint)

  if (type === 'Blunt' && insertSeq.length > 10000) warnings.push('大片段 Blunt TOPO 连接效率较低')

  return {
    success: true,
    productSequence: product,
    productLength: product.length,
    insertStart: midPoint + topoSite.length,
    insertEnd: midPoint + topoSite.length + insert.length - 1,
    orientation: 'forward',
    topoSite,
    warnings,
    errors
  }
}

// ============ Gateway 克隆 ============

/** att 位点序列 */
const ATT_SITES: Record<string, string> = {
  attB1: 'ACAAGTTTGTACAAAAAAGCTGAAC',
  attB2: 'ACCCAGCTTTCTTGTACAAAGTGGT',
  attP1: 'CAAACTTTGTTATAGAGAGTTGAAA',
  attP2: 'CCCTGTTTCTTGTACAAAGTTGGTA',
  attL1: 'ACAAGTTTGTACAAAAAAGCTGAAC',
  attL2: 'ACCCAGCTTTCTTGTACAAAGTGGT',
  attR1: 'CAAACTTTGTTATAGAGAGTTGAAA',
  attR2: 'CCCTGTTTCTTGTACAAAGTTGGTA',
}

/**
 * Gateway BP 反应：attB × attP → attL × attR
 * @param insertSeq 含 attB 位点的插入片段
 * @param donorVector 供体载体（含 attP 位点）
 */
export function simulateGatewayBP(
  insertSeq: string,
  donorVector: string
): GatewayResult {
  log.info(`Simulating Gateway BP reaction: insert(${insertSeq.length}bp) + donor vector`)
  const warnings: string[] = []
  const errors: string[] = []

  if (insertSeq.length < 50) errors.push('插入片段太短')
  if (errors.length > 0) {
    return { success: false, productSequence: '', productLength: 0, reactionType: 'BP', attSites: [], warnings, errors }
  }

  // 简化：在插入片段两侧添加 attL 位点
  const product = ATT_SITES.attL1 + insertSeq + ATT_SITES.attL2

  warnings.push('Gateway BP 反应将 attB 插入片段克隆到供体载体中，形成 Entry 克隆')

  return {
    success: true,
    productSequence: product,
    productLength: product.length,
    reactionType: 'BP',
    attSites: [
      { name: 'attL1', position: 0, sequence: ATT_SITES.attL1 },
      { name: 'attL2', position: product.length - ATT_SITES.attL2.length, sequence: ATT_SITES.attL2 }
    ],
    warnings,
    errors
  }
}

/**
 * Gateway LR 反应：attL × attR → attB × attP
 * @param entryClone Entry 克隆（含 attL 位点）
 * @param destinationVector 目的载体（含 attR 位点/ccdB）
 */
export function simulateGatewayLR(
  entryInsert: string,
  destinationVector: string
): GatewayResult {
  log.info(`Simulating Gateway LR reaction: entry insert(${entryInsert.length}bp) + destination vector`)
  const warnings: string[] = []
  const errors: string[] = []

  if (entryInsert.length < 50) errors.push('Entry 插入片段太短')
  if (errors.length > 0) {
    return { success: false, productSequence: '', productLength: 0, reactionType: 'LR', attSites: [], warnings, errors }
  }

  // 简化：LR 反应将 Entry 克隆中的插入片段转移到目的载体
  const midPoint = Math.floor(destinationVector.length / 2)
  const product = destinationVector.slice(0, midPoint) + entryInsert + destinationVector.slice(midPoint)

  warnings.push('Gateway LR 反应将 Entry 克隆中的基因转移到表达载体中')

  return {
    success: true,
    productSequence: product,
    productLength: product.length,
    reactionType: 'LR',
    attSites: [
      { name: 'attB1', position: midPoint - ATT_SITES.attB1.length, sequence: ATT_SITES.attB1 },
      { name: 'attB2', position: midPoint + entryInsert.length, sequence: ATT_SITES.attB2 }
    ],
    warnings,
    errors
  }
}

// ============ 定点诱变 (Site-Directed Mutagenesis) ============

/**
 * 定点诱变模拟
 * 基于重叠延伸 PCR 或 QuikChange 方法
 * @param templateSeq 模板序列
 * @param position 突变位置 (0-based)
 * @param mutation 突变序列（替换/插入的碱基）
 * @param type 突变类型
 * @param deleteLength 删除长度（仅 deletion 类型）
 */
export function simulateMutagenesis(
  templateSeq: string,
  position: number,
  mutation: string,
  type: 'substitution' | 'insertion' | 'deletion',
  deleteLength: number = 1
): MutagenesisResult {
  log.info(`Simulating mutagenesis: ${type} at position ${position} on ${templateSeq.length}bp template`)
  const warnings: string[] = []
  const errors: string[] = []

  if (position < 0 || position >= templateSeq.length) {
    errors.push(`突变位置 ${position} 超出模板范围 (0-${templateSeq.length - 1})`)
  }
  if (type === 'insertion' && !mutation) errors.push('插入序列不能为空')
  if (type === 'deletion' && (position + deleteLength > templateSeq.length)) {
    errors.push('删除范围超出模板')
  }
  if (errors.length > 0) {
    return {
      success: false, productSequence: '', productLength: 0, mutationType: type,
      mutationPosition: position, mutationLength: 0, originalSequence: templateSeq,
      mutatedSequence: '', primers: { forward: '', reverse: '' }, warnings, errors
    }
  }

  let product: string
  let mutLen: number
  const originalSegment = templateSeq.substring(position, position + (type === 'deletion' ? deleteLength : mutation.length))

  switch (type) {
    case 'substitution':
      product = templateSeq.slice(0, position) + mutation + templateSeq.slice(position + mutation.length)
      mutLen = mutation.length
      break
    case 'insertion':
      product = templateSeq.slice(0, position) + mutation + templateSeq.slice(position)
      mutLen = mutation.length
      break
    case 'deletion':
      product = templateSeq.slice(0, position) + templateSeq.slice(position + deleteLength)
      mutLen = deleteLength
      break
    default:
      product = templateSeq
      mutLen = 0
  }

  // 设计诱物：突变位点两侧各 15-25bp
  const primerLen = 20
  const fwdStart = Math.max(0, position - primerLen)
  const revEnd = Math.min(templateSeq.length, position + (type === 'deletion' ? deleteLength : mutation.length) + primerLen)
  const COMP: Record<string, string> = { a: 't', t: 'a', c: 'g', g: 'c', A: 'T', T: 'A', C: 'G', G: 'C' }
  const rc = (s: string) => s.split('').map(c => COMP[c] || c).reverse().join('')

  const fwdPrimer = templateSeq.slice(fwdStart, position) + (type !== 'deletion' ? mutation : '') + templateSeq.slice(position + (type === 'deletion' ? deleteLength : Math.min(mutation.length, 5)), position + (type === 'deletion' ? deleteLength : Math.min(mutation.length, 5)) + (primerLen - Math.min(primerLen, position - fwdStart)))
  const revPrimer = rc(product.slice(revEnd - primerLen, revEnd))

  // 检查
  if (type === 'substitution' && position + mutation.length > templateSeq.length) {
    warnings.push('替换序列超出模板末端，将截断')
  }
  if (product.length !== templateSeq.length && type === 'substitution') {
    warnings.push(`替换长度不一致：产物长度 ${product.length}bp (原 ${templateSeq.length}bp)`)
  }

  return {
    success: true,
    productSequence: product,
    productLength: product.length,
    mutationType: type,
    mutationPosition: position,
    mutationLength: mutLen,
    originalSequence: templateSeq,
    mutatedSequence: product,
    primers: { forward: fwdPrimer.slice(0, 40), reverse: revPrimer.slice(0, 40) },
    warnings,
    errors
  }
}
