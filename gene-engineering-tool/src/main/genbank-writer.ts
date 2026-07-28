import type { Vector, GenBankFeature } from '../shared/types'

/** 构建载体自定义元数据注释字符串 */
function buildMetadataComments(vector: Vector): string[] {
  const comments: string[] = []
  if (vector.antibiotic_resistance) comments.push(`COMMENT     antibiotic_resistance: ${vector.antibiotic_resistance}`)
  if (vector.copy_number) comments.push(`COMMENT     copy_number: ${vector.copy_number}`)
  if (vector.purpose) comments.push(`COMMENT     purpose: ${vector.purpose}`)
  if (vector.host_type) comments.push(`COMMENT     host_type: ${vector.host_type}`)
  if (vector.promoter_type) comments.push(`COMMENT     promoter_type: ${vector.promoter_type}`)
  if (vector.is_recombinant) comments.push(`COMMENT     is_recombinant: true`)
  return comments
}

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

  // COMMENT — 自定义元数据
  const metaComments = buildMetadataComments(vector)
  for (const c of metaComments) lines.push(c)

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
  const parts: string[] = []
  if (vector.description) parts.push(vector.description)
  if (vector.topology) parts.push(`topology=${vector.topology}`)
  if (vector.antibiotic_resistance) parts.push(`resistance=${vector.antibiotic_resistance}`)
  if (vector.copy_number) parts.push(`copy_number=${vector.copy_number}`)
  if (vector.purpose) parts.push(`purpose=${vector.purpose}`)
  if (vector.host_type) parts.push(`host=${vector.host_type}`)
  const meta = parts.length > 0 ? ` ${parts.join(' | ')}` : ''
  const header = `>${name}${meta}`
  const seq = vector.sequence || ''
  const lines: string[] = [header]
  for (let i = 0; i < seq.length; i += 80) {
    lines.push(seq.slice(i, i + 80))
  }
  return lines.join('\n') + '\n'
}

/**
 * Generate external .dna binary format
 * 格式: 多个 segment，每个 [1 byte type][4 bytes big-endian length][data]
 */
export function generateDnaFormat(vector: Vector, features: GenBankFeature[]): Buffer {
  const segments: Buffer[] = []

  // --- Segment 0x06: Notes XML ---
  const notesParts: string[] = []
  notesParts.push('<Notes>')
  notesParts.push(`<Type name="${escXml(vector.type || 'plasmid')}"/>`)
  if (vector.name) notesParts.push(`<CustomName><V text="${escXml(vector.name)}"/></CustomName>`)
  if (vector.description) notesParts.push(`<Description><V text="${escXml(vector.description)}"/></Description>`)
  if (vector.antibiotic_resistance) notesParts.push(`<AntibioticResistance><V text="${escXml(vector.antibiotic_resistance)}"/></AntibioticResistance>`)
  if (vector.copy_number) notesParts.push(`<CopyNumber><V text="${escXml(vector.copy_number)}"/></CopyNumber>`)
  if (vector.purpose) notesParts.push(`<Purpose><V text="${escXml(vector.purpose)}"/></Purpose>`)
  if (vector.host_type) notesParts.push(`<HostType><V text="${escXml(vector.host_type)}"/></HostType>`)
  if (vector.promoter_type) notesParts.push(`<PromoterType><V text="${escXml(vector.promoter_type)}"/></PromoterType>`)
  notesParts.push(`<Created>${new Date().toISOString()}</Created>`)
  notesParts.push('</Notes>')
  segments.push(buildSegment(0x06, Buffer.from(notesParts.join(''), 'utf8')))

  // --- Segment 0x08: Additional Properties XML (topology) ---
  const isLinear = vector.topology === 'linear'
  const addPropsXml = '<TopologicalFeatures>' +
    `<UpstreamStickiness>${isLinear ? 1 : 0}</UpstreamStickiness>` +
    `<DownstreamStickiness>${isLinear ? 1 : 0}</DownstreamStickiness>` +
    '</TopologicalFeatures>'
  segments.push(buildSegment(0x08, Buffer.from(addPropsXml, 'utf8')))

  // --- Segment 0x0A: Features XML ---
  if (features.length > 0) {
    const fxml = buildDnaFormatFeaturesXml(features)
    segments.push(buildSegment(0x0A, Buffer.from(fxml, 'utf8')))
  }

  // --- Segment 0x00: DNA sequence (1 byte flag + ASCII) ---
  const seq = (vector.sequence || '').toLowerCase().replace(/[^atcgn]/g, 'n')
  const seqBuf = Buffer.alloc(1 + seq.length)
  seqBuf[0] = 0x00 // flag byte
  Buffer.from(seq, 'ascii').copy(seqBuf, 1)
  segments.push(buildSegment(0x00, seqBuf))

  return Buffer.concat(segments)
}

/** 构建外部 .dna segment: [type:1][length:4 BE][data] */
function buildSegment(type: number, data: Buffer): Buffer {
  const buf = Buffer.alloc(5 + data.length)
  buf[0] = type
  buf.writeUInt32BE(data.length, 1)
  data.copy(buf, 5)
  return buf
}

/** XML 转义 */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 构建外部 .dna Features XML */
function buildDnaFormatFeaturesXml(features: GenBankFeature[]): string {
  const parts: string[] = ['<Features>']
  for (const f of features) {
    const name = f.qualifiers?.label || f.type
    const dir = f.strand === -1 ? 2 : 1
    const start1 = f.start + 1 // 1-based
    const end1 = f.end + 1
    const range = f.start <= f.end ? `${start1}-${end1}` : `${start1}-${end1}`
    parts.push(`<Feature name="${escXml(name)}" type="${escXml(f.type)}" directionality="${dir}">`)
    parts.push(`  <Segment range="${range}"/>`)
    // Qualifiers as <Q>
    for (const [key, val] of Object.entries(f.qualifiers || {})) {
      if (key === 'label') continue
      parts.push(`  <Q name="${escXml(key)}"><V text="${escXml(val)}"/></Q>`)
    }
    parts.push('</Feature>')
  }
  parts.push('</Features>')
  return parts.join('')
}
