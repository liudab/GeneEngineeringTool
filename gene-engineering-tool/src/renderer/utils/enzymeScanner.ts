/**
 * 共享酶切位点扫描模块
 * 从 VectorEditorPage 提取，供基因编辑器、载体编辑器复用
 */

import type { RestrictionEnzyme } from '../../shared/types'

export interface EnzymeSiteInfo {
  id: number
  enzyme_name?: string
  recognition_sequence?: string
  cut_position?: number
  position: number
  is_unique: boolean
  recog_start: number
  recog_end: number
  strand: 1 | -1
  overhang_type?: string
  subtype?: string
}

/** 扫描序列中所有酶的识别位点 */
export function scanEnzymeSites(sequence: string, enzymes: RestrictionEnzyme[], isCircular = true): EnzymeSiteInfo[] {
  if (!sequence || sequence.length < 4) return []
  const seq = sequence.toLowerCase()
  const sites: EnzymeSiteInfo[] = []
  const seqLen = seq.length
  // 动态计算扩展长度：取所有酶识别序列最大长度的2倍（至少30bp）
  const maxRecogLen = enzymes.reduce((m, e) => Math.max(m, (e.recognition_sequence || '').length), 0)
  const extLen = Math.max(30, maxRecogLen * 2)
  const extSeq = isCircular ? seq.slice(-extLen) + seq + seq.slice(0, extLen) : seq
  const offset = isCircular ? extLen : 0

  // 诊断统计
  let validEnzymeCount = 0
  let skippedEnzymeCount = 0
  let cleanWarningCount = 0

  for (const enzyme of enzymes) {
    const rawRecog = (enzyme.recognition_sequence || '').toLowerCase()
    const recog = rawRecog.replace(/[^atcgnryswkmbdhv]/g, '')
    if (recog !== rawRecog) {
      cleanWarningCount++
      console.debug(`[EnzymeScanner] 序列清洗警告: ${enzyme.name} "${rawRecog}" -> "${recog}"`)
    }
    if (recog.length < 4) {
      skippedEnzymeCount++
      continue
    }
    validEnzymeCount++
    const regex = iupacToRegex(recog)
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(extSeq)) !== null) {
      let recogStart = match.index - offset
      if (recogStart < 0) recogStart += seqLen
      if (recogStart >= seqLen) recogStart -= seqLen
      const recogEnd = (recogStart + recog.length - 1) % seqLen
      const cutPos = (recogStart + (enzyme.cut_position || 0)) % seqLen
      sites.push({
        id: sites.length,
        enzyme_name: enzyme.name,
        recognition_sequence: enzyme.recognition_sequence,
        cut_position: enzyme.cut_position,
        position: cutPos,
        is_unique: false,
        recog_start: recogStart,
        recog_end: recogEnd,
        strand: 1, // 正链匹配
        overhang_type: enzyme.overhang_type,
        subtype: enzyme.subtype ?? undefined
      })
    }
    // 同时扫描反义链（reverse complement of recognition sequence）
    const revRecog = recog.split('').map(c => {
      const m: Record<string, string> = { a: 't', t: 'a', c: 'g', g: 'c', r: 'y', y: 'r', s: 's', w: 'w', k: 'm', m: 'k', b: 'v', v: 'b', d: 'h', h: 'd', n: 'n' }
      return m[c] || c
    }).reverse().join('')
    if (revRecog !== recog) { // 只有非回文序列才需要扫描反义链
      const revRegex = iupacToRegex(revRecog)
      revRegex.lastIndex = 0
      while ((match = revRegex.exec(extSeq)) !== null) {
        let recogStart = match.index - offset
        if (recogStart < 0) recogStart += seqLen
        if (recogStart >= seqLen) recogStart -= seqLen
        const recogEnd = (recogStart + revRecog.length - 1) % seqLen
        const cutPos = (recogStart + (enzyme.cut_position || 0)) % seqLen
        sites.push({
          id: sites.length,
          enzyme_name: enzyme.name,
          recognition_sequence: enzyme.recognition_sequence,
          cut_position: enzyme.cut_position,
          position: cutPos,
          is_unique: false,
          recog_start: recogStart,
          recog_end: recogEnd,
          strand: -1, // 反义链匹配
          overhang_type: enzyme.overhang_type,
          subtype: enzyme.subtype ?? undefined
        })
      }
    }
  }

  // 环形载体去重：跨越起点的位点在扩展序列中会被匹配两次（首尾各一次），
  // 需按 (enzyme_name, recogStart, strand) 去重，只保留一个物理位点
  const rawCount = sites.length
  if (isCircular) {
    const seen = new Set<string>()
    const dedupSites: EnzymeSiteInfo[] = []
    for (const s of sites) {
      const key = `${s.enzyme_name}|${s.recog_start}|${s.strand}`
      if (!seen.has(key)) {
        seen.add(key)
        dedupSites.push(s)
      }
    }
    sites.length = 0
    sites.push(...dedupSites)
  }

  // 更新唯一性（基于去重后的位点数）
  const countByName: Record<string, number> = {}
  sites.forEach(s => { countByName[s.enzyme_name || ''] = (countByName[s.enzyme_name || ''] || 0) + 1 })
  sites.forEach(s => { s.is_unique = (countByName[s.enzyme_name || ''] || 0) === 1 })

  // 重新编号
  sites.forEach((s, i) => { s.id = i })

  // 按位置排序
  sites.sort((a, b) => a.position - b.position)

  // 诊断日志
  const uniqueEnzymeCount = Object.values(countByName).filter(c => c === 1).length
  console.debug(
    `[EnzymeScanner] 扫描完成: 酶总数=${enzymes.length}, 有效酶=${validEnzymeCount}, 跳过=${skippedEnzymeCount}, ` +
    `序列清洗警告=${cleanWarningCount}, 原始匹配=${rawCount}, 去重后=${sites.length}, 唯一位点酶=${uniqueEnzymeCount}, ` +
    `扩展长度=${extLen}bp, 序列长度=${seqLen}bp, 拓扑=${isCircular ? '环形' : '线性'}`
  )

  return sites
}

/** IUPAC 简并碱基转正则 */
export function iupacToRegex(seq: string): RegExp {
  const map: Record<string, string> = {
    a: 'a', t: 't', c: 'c', g: 'g',
    r: '[ag]', y: '[ct]', s: '[gc]', w: '[at]',
    k: '[gt]', m: '[ac]', b: '[cgt]', d: '[agt]',
    h: '[act]', v: '[acg]', n: '[atcg]'
  }
  const pattern = seq.split('').map(c => map[c] || c).join('')
  return new RegExp(pattern, 'gi')
}

/** 碱基互补 */
function complement(base: string): string {
  const map: Record<string, string> = {
    a: 't', t: 'a', c: 'g', g: 'c',
    r: 'y', y: 'r', s: 's', w: 'w',
    k: 'm', m: 'k', b: 'v', v: 'b',
    d: 'h', h: 'd', n: 'n', '.': '.', '-': '-'
  }
  return map[base] || base
}

export function getComplement(seq: string): string {
  return seq.split('').map(c => complement(c.toLowerCase())).join('')
}

export function getReverseComplement(seq: string): string {
  return getComplement(seq).split('').reverse().join('')
}
