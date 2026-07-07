/**
 * 标准遗传密码子表
 */

/** 密码子 → 氨基酸映射（标准遗传密码） */
export const CODON_TABLE: Record<string, string> = {
  'TTT': 'F', 'TTC': 'F', 'TTA': 'L', 'TTG': 'L',
  'CTT': 'L', 'CTC': 'L', 'CTA': 'L', 'CTG': 'L',
  'ATT': 'I', 'ATC': 'I', 'ATA': 'I', 'ATG': 'M',
  'GTT': 'V', 'GTC': 'V', 'GTA': 'V', 'GTG': 'V',
  'TCT': 'S', 'TCC': 'S', 'TCA': 'S', 'TCG': 'S',
  'CCT': 'P', 'CCC': 'P', 'CCA': 'P', 'CCG': 'P',
  'ACT': 'T', 'ACC': 'T', 'ACA': 'T', 'ACG': 'T',
  'GCT': 'A', 'GCC': 'A', 'GCA': 'A', 'GCG': 'A',
  'TAT': 'Y', 'TAC': 'Y', 'TAA': '*', 'TAG': '*',
  'CAT': 'H', 'CAC': 'H', 'CAA': 'Q', 'CAG': 'Q',
  'AAT': 'N', 'AAC': 'N', 'AAA': 'K', 'AAG': 'K',
  'GAT': 'D', 'GAC': 'D', 'GAA': 'E', 'GAG': 'E',
  'TGT': 'C', 'TGC': 'C', 'TGA': '*', 'TGG': 'W',
  'CGT': 'R', 'CGC': 'R', 'CGA': 'R', 'CGG': 'R',
  'AGT': 'S', 'AGC': 'S', 'AGA': 'R', 'AGG': 'R',
  'GGT': 'G', 'GGC': 'G', 'GGA': 'G', 'GGG': 'G'
}

/** 氨基酸三字母代码 → 单字母 */
export const AA_THREE_TO_ONE: Record<string, string> = {
  'Ala': 'A', 'Arg': 'R', 'Asn': 'N', 'Asp': 'D', 'Cys': 'C',
  'Glu': 'E', 'Gln': 'Q', 'Gly': 'G', 'His': 'H', 'Ile': 'I',
  'Leu': 'L', 'Lys': 'K', 'Met': 'M', 'Phe': 'F', 'Pro': 'P',
  'Ser': 'S', 'Thr': 'T', 'Trp': 'W', 'Tyr': 'Y', 'Val': 'V',
  'Ter': '*', 'Stop': '*'
}

/** 氨基酸单字母 → 全名 */
export const AA_NAMES: Record<string, string> = {
  'A': 'Alanine', 'R': 'Arginine', 'N': 'Asparagine', 'D': 'Aspartic acid',
  'C': 'Cysteine', 'E': 'Glutamic acid', 'Q': 'Glutamine', 'G': 'Glycine',
  'H': 'Histidine', 'I': 'Isoleucine', 'L': 'Leucine', 'K': 'Lysine',
  'M': 'Methionine', 'F': 'Phenylalanine', 'P': 'Proline', 'S': 'Serine',
  'T': 'Threonine', 'W': 'Tryptophan', 'Y': 'Tyrosine', 'V': 'Valine',
  '*': 'Stop'
}

/**
 * 将核酸序列翻译为蛋白质序列
 * @param seq 核酸序列
 * @param frame 阅读框偏移 (0, 1, 2)
 * @returns 蛋白质序列（终止密码子为 *）
 */
export function translateSequence(seq: string, frame: number = 0): string {
  const upper = seq.toUpperCase().replace(/U/g, 'T')
  let protein = ''
  for (let i = frame; i + 2 < upper.length; i += 3) {
    const codon = upper.substring(i, i + 3)
    const aa = CODON_TABLE[codon]
    protein += aa || 'X'
  }
  return protein
}

/**
 * 反转互补
 */
export function reverseComplement(seq: string): string {
  const comp: Record<string, string> = {
    A: 'T', T: 'A', G: 'C', C: 'G',
    a: 't', t: 'a', g: 'c', c: 'g',
    R: 'Y', Y: 'R', S: 'S', W: 'W', K: 'M', M: 'K',
    B: 'V', V: 'B', D: 'H', H: 'D', N: 'N',
    U: 'A'
  }
  return seq.split('').reverse().map(c => comp[c] || c).join('')
}
