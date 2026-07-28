import type { ComponentVariant, ComponentSeqType, VectorComponentType } from '../shared/types'

const CODON_TABLE: Record<string, string> = {
  TTT:'F',TTC:'F',TTA:'L',TTG:'L',CTT:'L',CTC:'L',CTA:'L',CTG:'L',
  ATT:'I',ATC:'I',ATA:'I',ATG:'M',GTT:'V',GTC:'V',GTA:'V',GTG:'V',
  TCT:'S',TCC:'S',TCA:'S',TCG:'S',CCT:'P',CCC:'P',CCA:'P',CCG:'P',
  ACT:'T',ACC:'T',ACA:'T',ACG:'T',GCT:'A',GCC:'A',GCA:'A',GCG:'A',
  TAT:'Y',TAC:'Y',TAA:'*',TAG:'*',CAT:'H',CAC:'H',CAA:'Q',CAG:'Q',
  AAT:'N',AAC:'N',AAA:'K',AAG:'K',GAT:'D',GAC:'D',GAA:'E',GAG:'E',
  TGT:'C',TGC:'C',TGA:'*',TGG:'W',CGT:'R',CGC:'R',CGA:'R',CGG:'R',
  AGT:'S',AGC:'S',AGA:'R',AGG:'R',GGT:'G',GGC:'G',GGA:'G',GGG:'G'
}

/** 反向互补 */
export function reverseComplement(seq: string): string {
  const comp: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }
  return seq.split('').reverse().map(c => comp[c.toUpperCase()] || c).join('')
}

/** 将 DNA 按指定阅读框翻译为氨基酸 */
export function translateFrame(dna: string, frame: number): string {
  const seq = dna.toUpperCase().replace(/[^ATGC]/g, '')
  const aas: string[] = []
  for (let i = frame; i + 2 < seq.length; i += 3) {
    const codon = seq.substring(i, i + 3)
    aas.push(CODON_TABLE[codon] || 'X')
  }
  return aas.join('')
}

/** 六框翻译 */
export function sixFrameTranslation(dna: string): string[] {
  const results: string[] = []
  for (let frame = 0; frame < 3; frame++) {
    results.push(translateFrame(dna, frame))
  }
  const rc = reverseComplement(dna)
  for (let frame = 0; frame < 3; frame++) {
    results.push(translateFrame(rc, frame))
  }
  return results
}

/** 滑动窗口局部比对：在 haystack 中找与 needle 最相似的子串，允许错配 */
export function slidingWindowMatch(haystack: string, needle: string, maxMismatches: number): {
  identity: number
  pos: number
  mismatches: number
} | null {
  if (!needle || needle.length > haystack.length) return null
  const w = needle.length
  let best: { identity: number; pos: number; mismatches: number } | null = null
  for (let i = 0; i <= haystack.length - w; i++) {
    let mm = 0
    for (let j = 0; j < w; j++) {
      if (haystack[i + j] !== needle[j]) {
        mm++
        if (mm > maxMismatches) break
      }
    }
    if (mm <= maxMismatches) {
      const identity = Math.round(((w - mm) / w) * 100)
      if (!best || identity > best.identity) {
        best = { identity, pos: i, mismatches: mm }
        if (identity === 100) break
      }
    }
  }
  return best
}

/** 三类比对结果 */
export interface ComponentMatchResult {
  variantId: string
  seqType: ComponentSeqType
  matchType: 'exact' | 'partial'
  identity: number
  start: number
  end: number
  strand: 1 | -1
  querySeq: string
  targetSeq: string
}

/** 以 DNA 查询，在 DNA 序列中直接比对（DNA→DNA） */
export function matchDnaToDna(queryDna: string, targetDna: string, threshold = 90): ComponentMatchResult | null {
  if (!isValidDna(queryDna) || !isValidDna(targetDna)) return null
  const q = cleanDNA(queryDna)
  const t = cleanDNA(targetDna)
  if (!q || q.length < 10 || !t || t.length < q.length) return null

  // 完全匹配
  let pos = t.indexOf(q)
  if (pos >= 0) {
    return {
      variantId: 'ref', seqType: 'DNA', matchType: 'exact', identity: 100,
      start: pos + 1, end: pos + q.length, strand: 1,
      querySeq: q, targetSeq: q
    }
  }
  // 反向互补完全匹配
  const rc = reverseComplement(q)
  pos = t.indexOf(rc)
  if (pos >= 0) {
    return {
      variantId: 'ref', seqType: 'DNA', matchType: 'exact', identity: 100,
      start: pos + 1, end: pos + q.length, strand: -1,
      querySeq: q, targetSeq: rc
    }
  }
  // 部分匹配
  const maxMismatches = Math.floor(q.length * (1 - threshold / 100))
  const best = slidingWindowMatch(t, q, maxMismatches)
  if (best && best.identity >= threshold) {
    return {
      variantId: 'ref', seqType: 'DNA', matchType: 'partial', identity: best.identity,
      start: best.pos + 1, end: best.pos + q.length, strand: 1,
      querySeq: q, targetSeq: t.substring(best.pos, best.pos + q.length)
    }
  }
  return null
}

/** 以 DNA 查询，在氨基酸序列/蛋白序列中比对（DNA→AA）
 * 将 query DNA 翻译后，与 target AA 做滑动窗口比对
 */
export function matchDnaToAA(queryDna: string, targetAa: string, threshold = 80): ComponentMatchResult | null {
  if (!isValidDna(queryDna) || !isValidProtein(targetAa)) return null
  const q = cleanDNA(queryDna)
  if (!q || q.length < 30) return null
  const aaFrames = sixFrameTranslation(q)
  let best: ComponentMatchResult | null = null
  for (let fi = 0; fi < aaFrames.length; fi++) {
    const aa = aaFrames[fi]
    const frame = fi % 3
    const strand = fi < 3 ? 1 : -1
    const res = slidingWindowMatch(targetAa.toUpperCase().replace(/[^A-Z\*]/g, ''), aa, Math.floor(aa.length * 0.2))
    if (res && (!best || res.identity > best.identity)) {
      best = {
        variantId: 'ref', seqType: 'Protein', matchType: res.identity === 100 ? 'exact' : 'partial',
        identity: res.identity, start: res.pos + 1, end: res.pos + aa.length, strand,
        querySeq: aa, targetSeq: targetAa.substring(res.pos, res.pos + aa.length)
      }
      if (best.identity === 100) break
    }
  }
  return best && best.identity >= threshold ? best : null
}

/** 以 AA 查询，在 DNA 序列中比对（AA→DNA）
 * 将 target DNA 六框翻译后，与 query AA 比对
 */
export function matchAminoToDna(queryAa: string, targetDna: string, threshold = 80): ComponentMatchResult | null {
  if (!isValidProtein(queryAa) || !isValidDna(targetDna)) return null
  const t = cleanDNA(targetDna)
  const q = (queryAa || '').toUpperCase().replace(/[^A-Z\*]/g, '')
  if (!q || q.length < 5 || !t || t.length < q.length * 3 + 6) return null
  const frames = sixFrameTranslation(t)
  let best: ComponentMatchResult | null = null
  for (let fi = 0; fi < frames.length; fi++) {
    const aa = frames[fi]
    const strand = fi < 3 ? 1 : -1
    const res = slidingWindowMatch(aa, q, Math.floor(q.length * 0.2))
    if (res && (!best || res.identity > best.identity)) {
      const dnaStart = res.pos * 3 + (fi % 3)
      best = {
        variantId: 'ref', seqType: 'DNA', matchType: res.identity === 100 ? 'exact' : 'partial',
        identity: res.identity, start: dnaStart + 1, end: dnaStart + q.length * 3, strand,
        querySeq: q, targetSeq: t.substring(dnaStart, dnaStart + q.length * 3)
      }
      if (best.identity === 100) break
    }
  }
  return best && best.identity >= threshold ? best : null
}

function cleanDNA(seq: string): string {
  return (seq || '').toUpperCase().replace(/[^ATGC]/g, '')
}

/** 判断是否为有效的 DNA（IUPAC 碱基，不含蛋白氨基酸字符） */
export function isValidDna(seq: string): boolean {
  return /^[ATGCRYSWKMBDHVN]+$/i.test(seq || '')
}

/** 判断是否为有效的氨基酸序列（单字母，含终止符 *） */
export function isValidProtein(seq: string): boolean {
  return /^[ACDEFGHIKLMNPQRSTVWY\*]+$/i.test(seq || '')
}
