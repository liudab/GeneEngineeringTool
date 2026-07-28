/**
 * ClustalW 多序列比对引擎
 * 实现渐进比对策略：
 * 1. 所有序列两两比对 → 计算距离矩阵
 * 2. 构建引导树 (UPGMA/NJ)
 * 3. 按引导树顺序逐步排列
 */

import type { AlignmentParams, AlignmentResult } from './types'
import { DEFAULT_NUCLEOTIDE_PARAMS, DEFAULT_PROTEIN_PARAMS } from './types'
import { needlemanWunsch } from './needlemanWunsch'
import { getScore } from './scoring'
import { computeDistanceMatrix, buildUPGMATree, buildNJTree, type TreeNode } from './phylogeneticTree'
import { createLogger } from '../../utils/logger'

const log = createLogger('ClustalW')

// ============ 类型定义 ============

export interface MSAInput {
  name: string
  sequence: string
}

export interface MSAOutput {
  /** 比对后的序列（含 gap） */
  alignedSequences: { name: string; sequence: string }[]
  /** 一致性序列 */
  consensus: string
  /** 保守性评分（每列） */
  conservation: number[]
  /** 引导树 */
  guideTree: TreeNode
  /** 距离矩阵 */
  distanceMatrix: number[][]
  /** 比对顺序（引导树的遍历顺序） */
  mergeOrder: string[]
  /** 全局统计 */
  stats: {
    totalLength: number
    meanIdentity: number
    gapRatio: number
  }
}

export type TreeMethod = 'upgma' | 'nj'

// ============ ClustalW 主函数 ============

/**
 * ClustalW 多序列比对
 * @param inputs 输入序列列表
 * @param isProtein 是否为蛋白质序列
 * @param params 可选参数覆盖
 * @param treeMethod 引导树构建方法
 * @param onProgress 可选进度回调 (percent: 0-100, message: 阶段描述)
 */
export function clustalW(
  inputs: MSAInput[],
  isProtein: boolean = false,
  params?: Partial<AlignmentParams>,
  treeMethod: TreeMethod = 'upgma',
  onProgress?: (percent: number, message: string) => void
): MSAOutput {
  log.info(`Starting ClustalW alignment: ${inputs.length} sequences, isProtein=${isProtein}, treeMethod=${treeMethod}`)
  if (inputs.length < 2) {
    throw new Error('MSA 需要至少 2 条序列')
  }

  const defaults = isProtein ? DEFAULT_PROTEIN_PARAMS : DEFAULT_NUCLEOTIDE_PARAMS
  const fullParams: AlignmentParams = { ...defaults, ...params }

  // Step 1: 两两比对，计算距离矩阵
  onProgress?.(5, '开始两两比对...')
  const seqs = inputs.map(s => ({ name: s.name, seq: s.sequence.toUpperCase() }))
  const pairwiseResults: AlignmentResult[][] = Array.from({ length: seqs.length }, () => [])
  const distSeqs = seqs.map(s => ({ name: s.name, seq: s.seq }))
  const dm = computeDistanceMatrix(distSeqs)

  // 记录两两比对的 identity
  for (let i = 0; i < seqs.length; i++) {
    for (let j = i + 1; j < seqs.length; j++) {
      const result = needlemanWunsch(seqs[i].seq, seqs[j].seq, fullParams, isProtein)
      pairwiseResults[i][j] = result
      pairwiseResults[j][i] = result
    }
  }

  // Step 2: 构建引导树
  onProgress?.(35, `两两比对完成，构建引导树 (${treeMethod.toUpperCase()})...`)
  log.debug(`Pairwise alignment complete, building guide tree (${treeMethod})`)
  const guideTree = treeMethod === 'nj' ? buildNJTree(dm) : buildUPGMATree(dm)

  // Step 3: 渐进比对
  onProgress?.(50, '渐进比对中...')
  const mergeOrder: string[] = []
  const alignedProfile = progressiveAlign(guideTree, seqs, pairwiseResults, fullParams, isProtein, mergeOrder)
  // 展平为每个原始序列一条字符串
  const flatProfile: string[] = alignedProfile.map(arr => arr[0])

  onProgress?.(75, '计算一致性与保守性...')
  log.debug(`Progressive alignment complete, computing consensus & conservation`)
  // Step 4: 计算一致性和保守性
  const consensus = computeConsensus(alignedProfile, isProtein)
  const conservation = computeConservation(alignedProfile, isProtein)

  // 统计
  const totalLength = flatProfile[0].length
  let totalGaps = 0
  for (const seq of flatProfile) {
    for (const c of seq) { if (c === '-') totalGaps++ }
  }
  const gapRatio = totalLength > 0 ? totalGaps / (totalLength * flatProfile.length) : 0

  // 平均一致性
  let sumIdentity = 0, pairCount = 0
  for (let i = 0; i < seqs.length; i++) {
    for (let j = i + 1; j < seqs.length; j++) {
      if (pairwiseResults[i][j]) {
        sumIdentity += pairwiseResults[i][j].identity
        pairCount++
      }
    }
  }
  const meanIdentity = pairCount > 0 ? sumIdentity / pairCount : 0

  onProgress?.(100, '比对完成')
  log.info(`ClustalW alignment complete: totalLength=${totalLength}, meanIdentity=${meanIdentity}, gapRatio=${gapRatio}`)
  return {
    alignedSequences: seqs.map((s, i) => ({ name: s.name, sequence: flatProfile[i] })),
    consensus,
    conservation,
    guideTree,
    distanceMatrix: dm.distances,
    mergeOrder,
    stats: { totalLength, meanIdentity: Math.round(meanIdentity * 100) / 100, gapRatio: Math.round(gapRatio * 10000) / 100 }
  }
}

// ============ 渐进比对核心 ============

/**
 * 按引导树顺序渐进比对
 * Profile = 一组已经比对好的序列
 */
function progressiveAlign(
  tree: TreeNode,
  originalSeqs: { name: string; seq: string }[],
  pairwiseResults: AlignmentResult[][],
  params: AlignmentParams,
  isProtein: boolean,
  mergeOrder: string[]
): string[][] {
  const leafIndex: Record<string, number> = {}
  originalSeqs.forEach((s, i) => { leafIndex[s.name] = i })

  // 递归遍历引导树，每个节点返回一个 profile
  function traverse(node: TreeNode): { indices: number[]; profile: string[][] } {
    if (!node.children || node.children.length === 0) {
      // 叶节点
      const idx = leafIndex[node.label!]
      if (idx === undefined) {
        throw new Error(`Leaf not found in tree: ${node.label}`)
      }
      return { indices: [idx], profile: [[originalSeqs[idx].seq]] }
    }

    // 递归子节点
    const childResults = node.children.map(c => traverse(c))

    if (childResults.length === 1) return childResults[0]

    // 合并两个 profile
    const left = childResults[0]
    const right = childResults.slice(1).reduce((acc, cur) => mergeProfiles(acc, cur, params, isProtein, mergeOrder, originalSeqs), childResults[1] || left)

    if (childResults.length === 2) {
      const merged = mergeProfiles(left, right, params, isProtein, mergeOrder, originalSeqs)
      return merged
    }

    // 多个子节点逐步合并
    let acc = left
    for (let i = 1; i < childResults.length; i++) {
      acc = mergeProfiles(acc, childResults[i], params, isProtein, mergeOrder, originalSeqs)
    }
    return acc
  }

  const final = traverse(tree)
  return final.profile
}

/**
 * 合并两个 profile（多序列对齐）
 * 核心操作：选取两个 profile 中最具代表性的序列做 NW 比对，
 * 然后根据比对结果在两个 profile 的所有序列中插入 gap
 */
function mergeProfiles(
  left: { indices: number[]; profile: string[][] },
  right: { indices: number[]; profile: string[][] },
  params: AlignmentParams,
  isProtein: boolean,
  mergeOrder: string[],
  originalSeqs: { name: string; seq: string }[]
): { indices: number[]; profile: string[][] } {
  // 选取代表序列：第一个 profile 的第一条和第二个 profile 的第一条
  // （ClustalW 实际使用 profile-based scoring，这里简化为 representative）
  const leftRep = left.profile[0][0]
  const rightRep = right.profile[0][0]

  // NW 比对代表序列
  const nwResult = needlemanWunsch(leftRep, rightRep, params, isProtein)
  const aligned1 = nwResult.alignedSeq1
  const aligned2 = nwResult.alignedSeq2

  // 构建 gap 映射
  const leftGaps = buildGapMap(aligned1)   // 在 aligned1 中哪些位置插入了 gap
  const rightGaps = buildGapMap(aligned2) // 在 aligned2 中哪些位置插入了 gap

  // 在 left profile 的每条序列中，对应 right 插入 gap 的位置也插入 gap
  const newLeftProfile = left.profile.map(seqArr => seqArr.map(seq => insertGapsAt(seq, rightGaps)))
  const newRightProfile = right.profile.map(seqArr => seqArr.map(seq => insertGapsAt(seq, leftGaps)))

  // 合并
  const indices = [...left.indices, ...right.indices]
  const profile = [...newLeftProfile, ...newRightProfile]

  // 记录合并顺序
  const leftName = originalSeqs[left.indices[0]].name
  const rightName = originalSeqs[right.indices[0]].name
  mergeOrder.push(`${leftName} + ${rightName}`)

  return { indices, profile }
}

/**
 * 构建 gap 位置映射
 * 返回在原序列中每个 gap 插入位置的列表
 * gap 位置 = 在去 gap 序列中的插入点
 */
function buildGapMap(aligned: string): number[] {
  const gapPositions: number[] = []
  let pos = 0 // 去 gap 后的位置
  for (let i = 0; i < aligned.length; i++) {
    if (aligned[i] === '-') {
      gapPositions.push(pos)
    } else {
      pos++
    }
  }
  return gapPositions
}

/**
 * 在序列的指定位置插入 gap
 */
function insertGapsAt(seq: string, gapPositions: number[]): string {
  if (gapPositions.length === 0) return seq

  const chars = seq.split('')
  // 从后向前插入，避免位置偏移
  const sortedGaps = [...gapPositions].sort((a, b) => b - a)
  for (const pos of sortedGaps) {
    chars.splice(pos, 0, '-')
  }
  return chars.join('')
}

// ============ 一致性和保守性 ============

/**
 * 计算一致性序列
 */
function computeConsensus(profile: string[][], isProtein: boolean): string {
  if (profile.length === 0) return ''
  const len = profile[0].length
  const consensus: string[] = []

  for (let col = 0; col < len; col++) {
    const counts: Record<string, number> = {}
    let total = 0
    for (const seq of profile) {
      const c = seq[col]?.toUpperCase() || '-'
      if (c !== '-') {
        counts[c] = (counts[c] || 0) + 1
        total++
      }
    }

    if (total === 0) {
      consensus.push('-')
    } else {
      // 选最多的字符
      let best = '-'
      let bestCount = 0
      for (const [c, n] of Object.entries(counts)) {
        if (n > bestCount) { bestCount = n; best = c }
      }
      consensus.push(best)
    }
  }

  return consensus.join('')
}

/**
 * 计算每列的保守性评分 (0-1)
 * 1 = 完全保守，0 = 无保守
 */
function computeConservation(profile: string[][], isProtein: boolean): number[] {
  if (profile.length === 0) return []
  const len = profile[0].length
  const n = profile.length
  const scores: number[] = []

  for (let col = 0; col < len; col++) {
    const colChars: string[] = []
    for (const seq of profile) {
      colChars.push(seq[col]?.toUpperCase() || '-')
    }

    // 计算非 gap 比例
    const nonGap = colChars.filter(c => c !== '-')
    const nonGapRatio = nonGap.length / n

    if (nonGap.length === 0) {
      scores.push(0)
      continue
    }

    // 计算一致性比例
    const counts: Record<string, number> = {}
    for (const c of nonGap) counts[c] = (counts[c] || 0) + 1
    const maxCount = Math.max(...Object.values(counts))
    const identity = maxCount / nonGap.length

    // 保守性 = 一致性 × 非gap比例
    scores.push(Math.round(identity * nonGapRatio * 100) / 100)
  }

  return scores
}

// ============ 导出 ============

/**
 * 导出 MSA 结果为 Clustal 格式
 */
export function exportMSAToClustal(output: MSAOutput): string {
  log.info(`Exporting MSA to Clustal format: ${output.alignedSequences.length} sequences`)
  const lines: string[] = ['CLUSTAL W multiple sequence alignment', '']
  const BLOCK = 60
  const nameWidth = Math.max(...output.alignedSequences.map(s => s.name.length)) + 4
  const len = output.stats.totalLength

  for (let start = 0; start < len; start += BLOCK) {
    const end = Math.min(start + BLOCK, len)
    for (const seq of output.alignedSequences) {
      const chunk = seq.sequence.substring(start, end)
      lines.push(seq.name.padEnd(nameWidth) + chunk)
    }
    // consensus line
    const consChunk = output.consensus.substring(start, end)
    const conservation = output.conservation.slice(start, end)
    const consLine = conservation.map(v => v >= 0.9 ? '*' : v >= 0.7 ? ':' : v >= 0.5 ? '.' : ' ').join('')
    lines.push(' '.repeat(nameWidth) + consLine)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 导出 MSA 结果为 FASTA 格式
 */
export function exportMSAToFasta(output: MSAOutput): string {
  log.info(`Exporting MSA to FASTA format: ${output.alignedSequences.length} sequences`)
  const lines: string[] = []
  for (const seq of output.alignedSequences) {
    lines.push(`>${seq.name}`)
    // 每行 80 字符
    for (let i = 0; i < seq.sequence.length; i += 80) {
      lines.push(seq.sequence.substring(i, i + 80))
    }
  }
  return lines.join('\n')
}
