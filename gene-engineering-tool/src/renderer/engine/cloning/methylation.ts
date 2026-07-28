/**
 * 甲基化标注引擎 — Dam/Dcm/CpG 甲基化敏感性分析
 * 规格书: optimization-spec.md §3.2 甲基化敏感性, 基因工程软件优化规格说明书.md §3.5
 *
 * Dam: GATC → 甲基化 A (N6-甲基腺嘌呤)
 * Dcm: CCWGG (W=A/T) → 甲基化第二个 C (5-甲基胞嘧啶)
 * CpG: CG 二核苷酸 → 真核生物常见甲基化位点
 */

export type MethylationType = 'Dam' | 'Dcm' | 'CpG'

export interface MethylationSite {
  position: number       // 序列中的位置 (0-based)
  type: MethylationType
  context: string        // 上下文序列（前后各5bp）
  methylatedBase: number // 被甲基化的碱基位置
}

export interface MethylationBlockResult {
  /** 该酶切位点是否被甲基化阻断 */
  blocked: boolean
  /** 阻断类型 */
  blockType: MethylationType | null
  /** 甲基化位点距酶切位点的距离 */
  distance: number
  /** 说明 */
  description: string
}

// Dam 识别序列: GATC
const DAM_RE = /GATC/gi
// Dcm 识别序列: CCAGG 或 CCTGG (CCWGG, W=A/T)
const DCM_RE = /CC[AT]GG/gi
// CpG
const CPG_RE = /CG/gi

/** 查找序列中所有甲基化位点 */
export function findMethylationSites(sequence: string): MethylationSite[] {
  const seq = sequence.toUpperCase()
  const sites: MethylationSite[] = []

  // Dam
  let m: RegExpExecArray | null
  DAM_RE.lastIndex = 0
  while ((m = DAM_RE.exec(seq)) !== null) {
    sites.push({
      position: m.index,
      type: 'Dam',
      context: getContext(seq, m.index, 4, 5),
      methylatedBase: m.index + 1 // A 在 GATC 中是第2个碱基
    })
  }

  // Dcm
  DCM_RE.lastIndex = 0
  while ((m = DCM_RE.exec(seq)) !== null) {
    sites.push({
      position: m.index,
      type: 'Dcm',
      context: getContext(seq, m.index, 5, 5),
      methylatedBase: m.index + 1 // 第二个 C
    })
  }

  // CpG
  CPG_RE.lastIndex = 0
  while ((m = CPG_RE.exec(seq)) !== null) {
    sites.push({
      position: m.index,
      type: 'CpG',
      context: getContext(seq, m.index, 2, 5),
      methylatedBase: m.index + 1 // G 位
    })
  }

  return sites.sort((a, b) => a.position - b.position)
}

/** 检查酶切位点是否被甲基化阻断 */
export function checkMethylationBlock(
  enzymeRecognition: string,
  enzymeCutPos: number,
  sitePosition: number,
  sequence: string,
  methylationSites: MethylationSite[]
): MethylationBlockResult {
  const rec = enzymeRecognition.toUpperCase()
  const recLen = rec.length

  // 检查每个甲基化位点是否与酶切位点重叠
  for (const metSite of methylationSites) {
    // 甲基化位点在酶切识别区域内或紧邻
    const metPos = metSite.methylatedBase
    const enzymeStart = sitePosition
    const enzymeEnd = sitePosition + recLen

    if (metPos >= enzymeStart - 2 && metPos <= enzymeEnd + 2) {
      const distance = Math.min(
        Math.abs(metPos - enzymeStart),
        Math.abs(metPos - enzymeEnd)
      )

      // Dam 阻断: GATC 中的 A 甲基化会影响部分酶（如 BclI, ClaI 等）
      if (metSite.type === 'Dam') {
        return {
          blocked: true,
          blockType: 'Dam',
          distance,
          description: `${metSite.type} 甲基化 (GATC @${metSite.position + 1}) 可能阻断 ${enzymeRecognition} 酶切`
        }
      }

      // Dcm 阻断
      if (metSite.type === 'Dcm') {
        return {
          blocked: true,
          blockType: 'Dcm',
          distance,
          description: `${metSite.type} 甲基化 (CCWGG @${metSite.position + 1}) 可能阻断 ${enzymeRecognition} 酶切`
        }
      }

      // CpG 一般不直接阻断酶切，但标记
      if (metSite.type === 'CpG' && distance <= 1) {
        return {
          blocked: false,
          blockType: 'CpG',
          distance,
          description: `CpG 甲基化位点靠近酶切位点 (${distance}bp)，可能影响效率`
        }
      }
    }
  }

  return { blocked: false, blockType: null, distance: -1, description: '未检测到甲基化阻断' }
}

/** 为序列生成甲基化标注注释（用于在 SequenceEditor 中显示） */
export function annotateMethylation(sequence: string): {
  damSites: number[]
  dcmSites: number[]
  cpgSites: number[]
  summary: string
} {
  const sites = findMethylationSites(sequence)
  const damSites = sites.filter(s => s.type === 'Dam').map(s => s.position)
  const dcmSites = sites.filter(s => s.type === 'Dcm').map(s => s.position)
  const cpgSites = sites.filter(s => s.type === 'CpG').map(s => s.position)

  const summary = `甲基化位点: Dam=${damSites.length} Dcm=${dcmSites.length} CpG=${cpgSites.length}`

  return { damSites, dcmSites, cpgSites, summary }
}

/** 受甲基化影响的常见酶列表 */
export const METHYLATION_SENSITIVE_ENZYMES: Record<string, { dam: boolean; dcm: boolean; description: string }> = {
  'BclI':    { dam: true,  dcm: false, description: 'Dam 甲基化阻断 (TGATCA)' },
  'ClaI':    { dam: true,  dcm: false, description: 'Dam 甲基化阻断 (ATCGAT) — 当 GATC 重叠时' },
  'MboI':    { dam: true,  dcm: false, description: 'Dam 甲基化完全阻断 (GATC)' },
  'TaqI':    { dam: false, dcm: true,  description: 'Dcm 甲基化可能阻断 (TCGA)' },
  'EcoRII':  { dam: false, dcm: true,  description: 'Dcm 甲基化阻断 (CCWGG)' },
  'Sau3AI':  { dam: true,  dcm: false, description: 'Dam 甲基化部分阻断 (GATC)' },
  'XbaI':    { dam: true,  dcm: false, description: 'Dam 重叠时可能阻断 (TCTAGA)' },
  'NdeI':    { dam: false, dcm: false, description: '一般不受甲基化影响' },
  'DpnI':    { dam: true,  dcm: false, description: '特异性切割 Dam 甲基化 DNA (GATC)' },
}

// ============ 工具函数 ============

function getContext(seq: string, pos: number, matchLen: number, flankLen: number): string {
  const start = Math.max(0, pos - flankLen)
  const end = Math.min(seq.length, pos + matchLen + flankLen)
  const before = seq.slice(start, pos).toLowerCase()
  const match = seq.slice(pos, pos + matchLen).toUpperCase()
  const after = seq.slice(pos + matchLen, end).toLowerCase()
  return `${before}[${match}]${after}`
}
