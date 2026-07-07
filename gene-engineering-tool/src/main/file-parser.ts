import type { GenBankRecord, GenBankFeature, FastaRecord } from '../shared/types'

/**
 * 解析 SnapGene .dna 二进制格式文件
 * 格式：一系列数据包，每包 = 1字节类型 + 4字节大端长度 + N字节数据
 * 关键包类型：
 *   0x00 = DNA序列（1字节标志 + ASCII碱基）
 *   0x06 = Notes XML（元数据）
 *   0x08 = 附加属性 XML（粘性末端等）
 *   0x09 = 文件头（"SnapGene" + 版本）
 *   0x0A = Features XML（特征注释）
 */
export function parseSnapGene(buffer: Buffer): GenBankRecord {
  let sequence = ''
  let featuresXml = ''
  let notesXml = ''
  let additionalPropsXml = ''

  // 解析数据包
  let offset = 0
  while (offset + 5 <= buffer.length) {
    const type = buffer[offset]
    const len = buffer.readUInt32BE(offset + 1)
    const dataStart = offset + 5
    if (dataStart + len > buffer.length) break

    const data = buffer.slice(dataStart, dataStart + len)

    switch (type) {
      case 0x00: // DNA序列
        // 第一个字节是标志位，后续为ASCII碱基
        if (len > 1) {
          sequence = data.slice(1).toString('ascii').toLowerCase()
        }
        break
      case 0x05: // 压缩序列（跳过，使用0x00的ASCII序列）
        break
      case 0x06: // Notes XML
        notesXml = data.toString('utf8')
        break
      case 0x08: // 附加属性 XML
        additionalPropsXml = data.toString('utf8')
        break
      case 0x0A: // Features XML
        featuresXml = data.toString('utf8')
        break
    }

    offset = dataStart + len
  }

  // 从Features XML解析特征
  const features = parseSnapGeneFeatures(featuresXml)

  // 从Notes XML解析元数据
  const { name, description } = parseSnapGeneNotes(notesXml)

  // 从附加属性判断拓扑结构（粘性末端=0表示环形）
  let topology: 'circular' | 'linear' = 'circular'
  if (additionalPropsXml) {
    const upStick = additionalPropsXml.match(/<UpstreamStickiness>(\d+)<\/UpstreamStickiness>/)
    const downStick = additionalPropsXml.match(/<DownstreamStickiness>(\d+)<\/DownstreamStickiness>/)
    if ((upStick && parseInt(upStick[1]) !== 0) || (downStick && parseInt(downStick[1]) !== 0)) {
      topology = 'linear'
    }
  }

  return {
    name,
    description,
    sequence,
    size: sequence.length,
    features,
    accession: '',
    version: '',
    topology
  }
}

/**
 * 从SnapGene Features XML解析特征列表
 */
function parseSnapGeneFeatures(xml: string): GenBankFeature[] {
  const features: GenBankFeature[] = []
  if (!xml) return features

  // 匹配每个 <Feature ...>...</Feature> 块
  const featureRegex = /<Feature\s+([^>]*)>([\s\S]*?)<\/Feature>/g
  let match: RegExpExecArray | null

  while ((match = featureRegex.exec(xml)) !== null) {
    const attrStr = match[1]
    const innerXml = match[2]

    // 解析属性
    const name = getAttr(attrStr, 'name') || ''
    const type = getAttr(attrStr, 'type') || 'misc_feature'
    const directionality = getAttr(attrStr, 'directionality') || '1'
    const strand: 1 | -1 = directionality === '2' ? -1 : 1

    // 解析Segment获取位置范围
    const segmentMatch = innerXml.match(/<Segment\s+([^>]*?)\/>/)
    if (!segmentMatch) continue
    const segAttr = segmentMatch[1]
    const rangeStr = getAttr(segAttr, 'range') || ''

    // 解析range "start-end"（1-based inclusive → 0-based half-open）
    const rangeMatch = rangeStr.match(/(\d+)-(\d+)/)
    if (!rangeMatch) continue
    let start = parseInt(rangeMatch[1]) - 1
    let end = parseInt(rangeMatch[2]) - 1
    if (start > end) {
      // 跨越原点的特征（如 pSa ori: 6354-407）
      // 保持原始范围，由渲染器处理
    }

    // 解析qualifiers
    const qualifiers: Record<string, string> = {}
    if (name) qualifiers['label'] = name

    // 解析 <Q name="xxx"><V .../></Q>
    const qRegex = /<Q\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/Q>/g
    let qMatch: RegExpExecArray | null
    while ((qMatch = qRegex.exec(innerXml)) !== null) {
      const qName = qMatch[1]
      const vXml = qMatch[2]

      // 提取V标签的属性值
      const textMatch = vXml.match(/text="([^"]*)"/)
      const intMatch = vXml.match(/int="([^"]*)"/)
      const boolMatch = vXml.match(/bool="([^"]*)"/)

      let value = ''
      if (textMatch) {
        value = textMatch[1]
        // 解码HTML实体
        value = value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        // 去除HTML标签
        value = value.replace(/<[^>]*>/g, '').trim()
      } else if (intMatch) {
        value = intMatch[1]
      } else if (boolMatch) {
        value = boolMatch[1]
      }

      qualifiers[qName] = value
    }

    const location = strand === -1
      ? `complement(${start + 1}..${end + 1})`
      : `${start + 1}..${end + 1}`

    features.push({ type, location, start, end, strand, qualifiers })
  }

  return features
}

/**
 * 从SnapGene Notes XML解析名称和描述
 */
function parseSnapGeneNotes(xml: string): { name: string; description: string } {
  if (!xml) return { name: '', description: '' }

  const typeMatch = xml.match(/<Type>([^<]*)<\/Type>/)
  const createdMatch = xml.match(/<Created>([^<]*)<\/Created>/)
  const authorMatch = xml.match(/<CreatedBy>([^<]*)<\/CreatedBy>/)

  const parts: string[] = []
  if (typeMatch) parts.push(`Type: ${typeMatch[1]}`)
  if (createdMatch) parts.push(`Created: ${createdMatch[1]}`)
  if (authorMatch) parts.push(`Author: ${authorMatch[1]}`)

  return { name: '', description: parts.join(', ') }
}

/** 从XML属性字符串中获取指定属性值 */
function getAttr(attrStr: string, name: string): string {
  const match = attrStr.match(new RegExp(`${name}="([^"]*)"`))
  return match ? match[1] : ''
}

/**
 * 解析 GenBank 格式文件
 */
export function parseGenBank(content: string): GenBankRecord {
  // 标准化换行符：处理 CRLF (\r\n) 和 旧 Mac (\r) 格式
  const lines = content.replace(/\r/g, '').split('\n')
  let name = ''
  let description = ''
  let accession = ''
  let version = ''
  let topology: 'linear' | 'circular' = 'linear'
  let size = 0
  const features: GenBankFeature[] = []
  let sequence = ''
  let section: 'header' | 'features' | 'sequence' = 'header'
  let currentFeature: Partial<GenBankFeature> | null = null
  let currentQualifierKey = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // LOCUS line
    if (line.startsWith('LOCUS')) {
      name = line.substring(12, 28).trim()
      const sizeMatch = line.match(/(\d+)\s*(bp|aa)/)
      if (sizeMatch) size = parseInt(sizeMatch[1])
      if (line.includes('circular')) topology = 'circular'
      else if (line.includes('linear')) topology = 'linear'
      continue
    }

    // DEFINITION
    if (line.startsWith('DEFINITION')) {
      description = line.substring(12).trim()
      continue
    }

    // ACCESSION
    if (line.startsWith('ACCESSION')) {
      accession = line.substring(12).trim()
      continue
    }

    // VERSION
    if (line.startsWith('VERSION')) {
      version = line.substring(12).trim()
      continue
    }

    // FEATURES header
    if (line.startsWith('FEATURES')) {
      section = 'features'
      continue
    }

    // ORIGIN - start of sequence
    if (line.startsWith('ORIGIN')) {
      if (currentFeature) {
        finalizeFeature(currentFeature, features)
        currentFeature = null
      }
      section = 'sequence'
      continue
    }

    // //
    if (line.startsWith('//')) {
      break
    }

    if (section === 'features') {
      // Feature key line (starts with spaces, then a key)
      const featureMatch = line.match(/^ {5}(\S+)\s+(.*)$/)
      if (featureMatch) {
        if (currentFeature) {
          finalizeFeature(currentFeature, features)
        }
        const location = featureMatch[2].trim()
        currentFeature = {
          type: featureMatch[1],
          location,
          qualifiers: {},
          ...parseLocation(location)
        }
        currentQualifierKey = ''
        continue
      }

      // Qualifier line
      const qualMatch = line.match(/^ {21}\/(\w+)(?:=(.*))?$/)
      if (qualMatch && currentFeature) {
        currentQualifierKey = qualMatch[1]
        const value = qualMatch[2] ? stripQuotes(qualMatch[2]) : ''
        currentFeature.qualifiers![currentQualifierKey] = value
        continue
      }

      // Continuation of qualifier value
      if (line.match(/^ {21}\S/) && currentFeature && currentQualifierKey) {
        const continuation = stripQuotes(line.substring(21).trim())
        currentFeature.qualifiers![currentQualifierKey] += continuation
        continue
      }
    }

    if (section === 'sequence') {
      // Sequence lines: "    1 agatct..."
      const seqMatch = line.match(/^\s*\d+\s+(.*)$/)
      if (seqMatch) {
        sequence += seqMatch[1].replace(/\s/g, '').toLowerCase()
      }
    }
  }

  if (currentFeature) {
    finalizeFeature(currentFeature, features)
  }

  return {
    name,
    description,
    sequence,
    size: size || sequence.length,
    features,
    accession,
    version,
    topology
  }
}

function parseLocation(location: string): { start: number; end: number; strand: 1 | -1 } {
  let strand: 1 | -1 = 1
  let loc = location

  if (loc.startsWith('complement(')) {
    strand = -1
    loc = loc.replace('complement(', '').replace(/\)$/, '')
  }

  if (loc.startsWith('join(')) {
    loc = loc.replace('join(', '').replace(/\)$/, '')
    // Use first segment start and last segment end
    const parts = loc.split(',')
    const first = parts[0].replace(/[<>]/g, '')
    const last = parts[parts.length - 1].replace(/[<>]/g, '')
    const startMatch = first.match(/(\d+)/)
    const endParts = last.match(/(\d+)\.\.(\d+)/) || last.match(/(\d+)/)
    return {
      start: startMatch ? parseInt(startMatch[1]) - 1 : 0,
      end: endParts ? parseInt(endParts[endParts.length - 1]) - 1 : 0,
      strand
    }
  }

  loc = loc.replace(/[<>]/g, '')
  const rangeMatch = loc.match(/(\d+)\.\.(\d+)/)
  if (rangeMatch) {
    return {
      start: parseInt(rangeMatch[1]) - 1,
      end: parseInt(rangeMatch[2]) - 1,
      strand
    }
  }

  const singleMatch = loc.match(/(\d+)/)
  if (singleMatch) {
    const pos = parseInt(singleMatch[1]) - 1
    return { start: pos, end: pos, strand }
  }

  return { start: 0, end: 0, strand: 1 }
}

function finalizeFeature(partial: Partial<GenBankFeature>, features: GenBankFeature[]): void {
  if (partial.type && partial.start !== undefined && partial.end !== undefined) {
    features.push({
      type: partial.type,
      location: partial.location || '',
      start: partial.start,
      end: partial.end,
      strand: partial.strand || 1,
      qualifiers: partial.qualifiers || {}
    })
  }
}

function stripQuotes(s: string): string {
  s = s.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * 解析 FASTA 格式文件
 */
export function parseFasta(content: string): FastaRecord[] {
  const records: FastaRecord[] = []
  const lines = content.replace(/\r/g, '').split('\n')
  let currentId = ''
  let currentDesc = ''
  let currentSeq = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('>')) {
      if (currentId || currentSeq) {
        records.push({
          id: currentId,
          description: currentDesc,
          sequence: currentSeq
        })
      }
      const header = trimmed.substring(1).trim()
      const spaceIdx = header.indexOf(' ')
      if (spaceIdx === -1) {
        currentId = header
        currentDesc = ''
      } else {
        currentId = header.substring(0, spaceIdx)
        currentDesc = header.substring(spaceIdx + 1)
      }
      currentSeq = ''
    } else {
      currentSeq += trimmed.replace(/\s/g, '')
    }
  }

  if (currentId || currentSeq) {
    records.push({
      id: currentId,
      description: currentDesc,
      sequence: currentSeq
    })
  }

  return records
}
