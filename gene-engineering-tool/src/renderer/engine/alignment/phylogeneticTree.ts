/**
 * 系统发育树构建引擎
 * 支持 UPGMA 和 Neighbor-Joining (NJ) 两种方法
 * 基于距离矩阵构建树形结构
 */

// ============ 类型定义 ============

/** 树节点 */
export interface TreeNode {
  /** 叶节点标签（仅叶节点有值） */
  label?: string
  /** 分支长度（到父节点的距离） */
  branchLength: number
  /** 子节点列表 */
  children?: TreeNode[]
  /** 内部节点 ID */
  id?: number
}

/** 距离矩阵 */
export interface DistanceMatrix {
  labels: string[]
  distances: number[][]
}

// ============ 距离计算 ============

/**
 * 从多序列比对结果计算距离矩阵
 * 使用 p-distance（不一致比例）
 */
export function computeDistanceMatrix(sequences: { name: string; seq: string }[]): DistanceMatrix {
  const n = sequences.length
  const labels = sequences.map(s => s.name)
  const distances: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = pDistance(sequences[i].seq, sequences[j].seq)
      distances[i][j] = d
      distances[j][i] = d
    }
  }

  return { labels, distances }
}

/** p-distance: 不一致位点比例（忽略 gap-only 列） */
function pDistance(s1: string, s2: string): number {
  const len = Math.min(s1.length, s2.length)
  let diff = 0
  let valid = 0
  for (let i = 0; i < len; i++) {
    if (s1[i] === '-' && s2[i] === '-') continue
    valid++
    if (s1[i].toUpperCase() !== s2[i].toUpperCase()) diff++
  }
  return valid > 0 ? diff / valid : 0
}

// ============ UPGMA ============

/**
 * UPGMA 层次聚类构建系统发育树
 * 假设等速进化（ultrametric），最简单的聚类方法
 */
export function buildUPGMATree(dm: DistanceMatrix): TreeNode {
  const n = dm.labels.length
  if (n === 0) return { branchLength: 0, label: '' }
  if (n === 1) return { label: dm.labels[0], branchLength: 0 }

  // 活跃节点列表
  interface Cluster {
    node: TreeNode
    size: number
    idx: number // 距离矩阵中的原始索引
  }

  // 复制距离矩阵
  const D: number[][] = dm.distances.map(r => [...r])
  const clusters: Cluster[] = dm.labels.map((label, i) => ({
    node: { label, branchLength: 0 },
    size: 1,
    idx: i
  }))

  let nextId = 0

  while (clusters.length > 1) {
    // 找到最小距离对
    let minD = Infinity
    let mi = 0, mj = 1
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = D[clusters[i].idx][clusters[j].idx]
        if (d < minD) { minD = d; mi = i; mj = j }
      }
    }

    const ci = clusters[mi]
    const cj = clusters[mj]
    const halfD = minD / 2

    ci.node.branchLength = halfD - getHeight(ci.node)
    cj.node.branchLength = halfD - getHeight(cj.node)

    // 合并
    const newNode: TreeNode = {
      id: nextId++,
      branchLength: 0,
      children: [ci.node, cj.node]
    }

    // 更新距离矩阵（扩展）
    const newIdx = D.length
    const newRow: number[] = new Array(newIdx + 1).fill(0)
    for (const c of clusters) {
      if (c === ci || c === cj) continue
      const ni = ci.size, nj = cj.size
      const avgD = (D[ci.idx][c.idx] * ni + D[cj.idx][c.idx] * nj) / (ni + nj)
      newRow[c.idx] = avgD
      D[c.idx] = [...D[c.idx], avgD]
    }
    newRow.push(0)
    D.push(newRow)

    const mergedSize = ci.size + cj.size
    clusters.splice(mj, 1)
    clusters.splice(mi, 1)
    clusters.push({ node: newNode, size: mergedSize, idx: newIdx })
  }

  return clusters[0].node
}

// ============ Neighbor-Joining ============

/**
 * Neighbor-Joining (NJ) 构建系统发育树
 * 不假设等速进化，能产生更准确的拓扑
 */
export function buildNJTree(dm: DistanceMatrix): TreeNode {
  const n = dm.labels.length
  if (n === 0) return { branchLength: 0, label: '' }
  if (n === 1) return { label: dm.labels[0], branchLength: 0 }
  if (n === 2) {
    const half = dm.distances[0][1] / 2
    return {
      branchLength: 0,
      id: 0,
      children: [
        { label: dm.labels[0], branchLength: half },
        { label: dm.labels[1], branchLength: half }
      ]
    }
  }

  // 工作数据结构
  interface NJNode {
    node: TreeNode
    alive: boolean
  }

  const D: number[][] = dm.distances.map(r => [...r])
  let nodes: NJNode[] = dm.labels.map((label, i) => ({
    node: { label, branchLength: 0 },
    alive: true
  }))

  // 扩展距离矩阵
  const maxN = 2 * n // NJ 最多 n-2 次合并
  for (let i = 0; i < D.length; i++) {
    while (D[i].length < maxN) D[i].push(0)
  }
  while (D.length < maxN) D.push(new Array(maxN).fill(0))

  let nextNodeId = n // 新节点索引从 n 开始
  let activeIndices = nodes.map((_, i) => i)

  for (let step = 0; step < n - 2; step++) {
    const active = activeIndices.filter(i => nodes[i].alive)
    const r = active.length

    // 计算 r(i) = sum of D[i][j] for all active j
    const rSum: Record<number, number> = {}
    for (const i of active) {
      let s = 0
      for (const j of active) { if (j !== i) s += D[i][j] }
      rSum[i] = s
    }

    // 找最小 Q(i,j) = (r-2)*D[i][j] - rSum[i] - rSum[j]
    let minQ = Infinity
    let mi = active[0], mj = active[1]
    for (let a = 0; a < active.length; a++) {
      for (let b = a + 1; b < active.length; b++) {
        const i = active[a], j = active[b]
        const q = (r - 2) * D[i][j] - rSum[i] - rSum[j]
        if (q < minQ) { minQ = q; mi = i; mj = j }
      }
    }

    // 计算分支长度
    const dmi_mj = D[mi][mj]
    const delta = r > 2 ? (rSum[mi] - rSum[mj]) / (r - 2) : 0
    const li = Math.max(0, (dmi_mj + delta) / 2)
    const lj = Math.max(0, dmi_mj - li)

    nodes[mi].node.branchLength = li
    nodes[mj].node.branchLength = lj

    // 创建新节点
    const newNode: TreeNode = {
      id: nextNodeId,
      branchLength: 0,
      children: [nodes[mi].node, nodes[mj].node]
    }

    // 计算新节点到其他活跃节点的距离
    const newIdx = nextNodeId
    for (const k of active) {
      if (k === mi || k === mj) continue
      const d = (D[mi][k] + D[mj][k] - dmi_mj) / 2
      D[newIdx][k] = Math.max(0, d)
      D[k][newIdx] = D[newIdx][k]
    }

    // 标记 mi, mj 为不活跃，添加新节点
    nodes[mi].alive = false
    nodes[mj].alive = false
    nodes.push({ node: newNode, alive: true })
    activeIndices = activeIndices.filter(i => i !== mi && i !== mj)
    activeIndices.push(newIdx)
    nextNodeId++
  }

  // 最后合并剩余的两个节点
  const remaining = activeIndices.filter(i => nodes[i].alive)
  if (remaining.length === 2) {
    const [a, b] = remaining
    const half = D[a][b] / 2
    nodes[a].node.branchLength = half
    nodes[b].node.branchLength = half
    return {
      branchLength: 0,
      id: nextNodeId,
      children: [nodes[a].node, nodes[b].node]
    }
  }

  // fallback
  return remaining.length === 1 ? nodes[remaining[0]].node : nodes[0].node
}

// ============ 辅助函数 ============

/** 获取节点高度（从叶到该节点的最长路径） */
function getHeight(node: TreeNode): number {
  if (!node.children || node.children.length === 0) return 0
  return Math.max(...node.children.map(c => c.branchLength + getHeight(c)))
}

/**
 * 将树转换为 Newick 格式字符串
 */
export function treeToNewick(node: TreeNode): string {
  if (!node.children || node.children.length === 0) {
    const label = node.label ? node.label.replace(/[,:;()\s]/g, '_') : ''
    return `${label}:${node.branchLength.toFixed(5)}`
  }
  const childStrs = node.children.map(c => treeToNewick(c))
  return `(${childStrs.join(',')}):${node.branchLength.toFixed(5)}`
}

/**
 * 获取树的所有叶标签
 */
export function getLeafLabels(node: TreeNode): string[] {
  if (!node.children || node.children.length === 0) {
    return node.label ? [node.label] : []
  }
  return node.children.flatMap(c => getLeafLabels(c))
}

/**
 * 获取树的扁平化结构（用于渲染）
 */
export interface FlatTreeNode {
  id: number
  label?: string
  x: number
  y: number
  parentId?: number
  branchLength: number
  isLeaf: boolean
}

export function flattenTree(node: TreeNode): FlatTreeNode[] {
  const result: FlatTreeNode[] = []
  let idCounter = 0

  function visit(n: TreeNode, parentId: number | undefined, parentX: number, y: number) {
    const myId = idCounter++
    const x = parentX + n.branchLength

    if (!n.children || n.children.length === 0) {
      result.push({ id: myId, label: n.label, x, y, parentId, branchLength: n.branchLength, isLeaf: true })
    } else {
      result.push({ id: myId, x, y, parentId, branchLength: n.branchLength, isLeaf: false })
      const childCount = n.children.length
      for (let i = 0; i < childCount; i++) {
        const childY = y + (i - (childCount - 1) / 2) * 1.5
        visit(n.children[i], myId, x, childY)
      }
    }
  }

  visit(node, undefined, 0, 0)
  return result
}
