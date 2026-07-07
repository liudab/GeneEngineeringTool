import type { Vector, GenBankFeature } from '../shared/types'

/**
 * Generate standard GenBank format text
 */
export function generateGenBank(vector: Vector, features: GenBankFeature[]): string {
  const lines: string[] = []
  const topology = vector.topology || 'circular'
  const seqLen = (vector.sequence || '').length || vector.size_bp || 0

  // LOCUS line
  const name = (vector.name || 'Unknown').slice(0, 16).padEnd(16)
  const lenStr = String(seqLen).padStart(11) + ' bp'
  const molType = 'DNA'
  const topoStr = topology === 'circular' ? 'circular' : 'linear'
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '-')
  lines.push(`LOCUS       ${name} ${lenStr}    ${molType}     ${topoStr}  UNK ${date}`)

  // DEFINITION
  lines.push(`DEFINITION  ${vector.description || vector.name || 'Unknown vector'}.`)

  // ACCESSION / VERSION
  lines.push(`ACCESSION   unknown`)
  lines.push(`VERSION     unknown`)

  // FEATURES
  if (features.length > 0) {
    lines.push('FEATURES             Location/Qualifiers')
    for (const f of features) {
      const loc = f.location || `${f.start + 1}..${f.end + 1}`
      const strandPrefix = f.strand === -1 ? 'complement(' : ''
      const strandSuffix = f.strand === -1 ? ')' : ''
      const locStr = `${strandPrefix}${loc}${strandSuffix}`
      lines.push(`     ${f.type.padEnd(16)}${locStr}`)
      // Qualifiers
      for (const [key, val] of Object.entries(f.qualifiers || {})) {
        const qVal = `/${key}="${val}"`
        // Wrap at 80 chars
        if (qVal.length <= 70) {
          lines.push(`                     ${qVal}`)
        } else {
          let remaining = qVal
          let first = true
          while (remaining.length > 0) {
            const chunk = remaining.slice(0, first ? 70 : 68)
            lines.push(`                     ${chunk}`)
            remaining = remaining.slice(first ? 70 : 68)
            first = false
          }
        }
      }
    }
  }

  // ORIGIN
  lines.push('ORIGIN')
  const seq = (vector.sequence || '').toLowerCase()
  for (let i = 0; i < seq.length; i += 60) {
    const lineNum = String(i + 1).padStart(9)
    const groups: string[] = []
    for (let j = 0; j < 60 && i + j < seq.length; j += 10) {
      groups.push(seq.slice(i + j, Math.min(i + j + 10, seq.length)))
    }
    lines.push(`${lineNum} ${groups.join(' ')}`)
  }
  lines.push('//')

  return lines.join('\n')
}

/**
 * Generate FASTA format text
 */
export function generateFasta(vector: Vector): string {
  const name = vector.name || 'Unknown'
  const desc = vector.description ? ` ${vector.description}` : ''
  const header = `>${name}${desc}`
  const seq = vector.sequence || ''
  const lines: string[] = [header]
  for (let i = 0; i < seq.length; i += 80) {
    lines.push(seq.slice(i, i + 80))
  }
  return lines.join('\n') + '\n'
}
