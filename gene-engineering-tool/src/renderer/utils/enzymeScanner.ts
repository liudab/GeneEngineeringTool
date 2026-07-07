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
}

/** 扫描序列中所有酶的识别位点 */
export function scanEnzymeSites(sequence: string, enzymes: RestrictionEnzyme[], isCircular = true): EnzymeSiteInfo[] {
  if (!sequence || sequence.length < 4) return []
  const seq = sequence.toLowerCase()
  const sites: EnzymeSiteInfo[] = []
  const seqLen = seq.length
  // 为环形载体扩展序列（首尾各加30bp）
  const extSeq = isCircular ? seq.slice(-30) + seq + seq.slice(0, 30) : seq
  const offset = isCircular ? 30 : 0

  for (const enzyme of enzymes) {
    const recog = (enzyme.recognition_sequence || '').toLowerCase().replace(/[^atcgnryswkmbdhv]/g, '')
    if (recog.length < 4) continue
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
        strand: 1 // 正链匹配
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
          strand: -1 // 反义链匹配
        })
      }
    }
  }

  // 更新唯一性
  const countByName: Record<string, number> = {}
  sites.forEach(s => { countByName[s.enzyme_name || ''] = (countByName[s.enzyme_name || ''] || 0) + 1 })
  sites.forEach(s => { s.is_unique = (countByName[s.enzyme_name || ''] || 0) === 1 })

  // 按位置排序
  sites.sort((a, b) => a.position - b.position)
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
