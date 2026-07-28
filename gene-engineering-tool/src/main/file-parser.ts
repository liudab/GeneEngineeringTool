import type { GenBankRecord, GenBankFeature, FastaRecord } from '../shared/types'
import { createLogger } from './logger'

const log = createLogger('FileParser')

/**
 * 解析外部 .dna 二进制格式文件
 * 格式：一系列数据包，每包 = 1字节类型 + 4字节大端长度 + N字节数据
 * 关键包类型：
 *   0x00 = DNA序列（1字节标志 + ASCII碱基）
 *   0x06 = Notes XML（元数据）
 *   0x08 = 附加属性 XML（粘性末端等）
 *   0x09 = 文件头（"external" + 版本）
 *   0x0A = Features XML（特征注释）
 */
export function parseDnaFormat(buffer: Buffer): GenBankRecord {
  log.info(`Parsing external .dna format: ${buffer.length} bytes`)
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
  const features = parseDnaFormatFeatures(featuresXml)

  // 从Notes XML解析元数据
  const { name, description } = parseDnaFormatNotes(notesXml)

  // 从附加属性判断拓扑结构（粘性末端=0表示环形）
  let topology: 'circular' | 'linear' = 'circular'
  if (additionalPropsXml) {
    const upStick = additionalPropsXml.match(/<UpstreamStickiness>(\d+)<\/UpstreamStickiness>/)
    const downStick = additionalPropsXml.match(/<DownstreamStickiness>(\d+)<\/DownstreamStickiness>/)
    if ((upStick && parseInt(upStick[1]) !== 0) || (downStick && parseInt(downStick[1]) !== 0)) {
      topology = 'linear'
    }
  }

  const result = {
    name,
    description,
    sequence,
    size: sequence.length,
    features,
    accession: '',
    version: '',
    topology
  }
  log.info(`External .dna format parse complete: seq=${sequence.length}bp, features=${features.length}, topology=${topology}`)
  return result
}

/**
 * 从外部 .dna Features XML解析特征列表
 */
function parseDnaFormatFeatures(xml: string): GenBankFeature[] {
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
 * 从外部 .dna Notes XML解析名称和描述
 */
function parseDnaFormatNotes(xml: string): { name: string; description: string } {
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
  log.info(`GenBank parsing: ${content.length} chars`)
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

      // Continuation of feature location (multi-line join() etc.)
      // 当行以 21 空格开头、不以 / 开头、且当前无活动限定符键时，说明是 location 续行
      if (line.match(/^ {21}\S/) && currentFeature && !currentQualifierKey) {
        const locCont = line.substring(21).trim()
        currentFeature.location = (currentFeature.location || '') + locCont
        // 重新解析完整 location 的坐标
        const reparsed = parseLocation(currentFeature.location)
        currentFeature.start = reparsed.start
        currentFeature.end = reparsed.end
        currentFeature.strand = reparsed.strand
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

  // 从 mRNA/CDS 的 join() 位置推断 exon 和 intron 特征
  inferExonIntronFeatures(features)

  log.info(`GenBank parse complete: seq=${sequence.length}bp, features=${features.length}, name=${name}`)
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

/**
 * 从 mRNA/CDS 特征的 join() 位置推断 exon 和 intron 特征
 * NCBI RefSeq GenBank 文件通常不包含显式的 exon/intron 特征，
 * 而是将外显子段编码在 mRNA 的 join(start..end, start..end, ...) 中。
 * 此函数自动从 join() 解析出各个外显子段，并将它们之间的间隔标注为内含子。
 */
export function inferExonIntronFeatures(features: GenBankFeature[]): void {
  // 检查是否已有显式 exon/intron 特征
  const hasExon = features.some(f => f.type === 'exon')
  const hasIntron = features.some(f => f.type === 'intron')
  if (hasExon && hasIntron) return

  const newFeatures: GenBankFeature[] = []

  // 优先使用 mRNA，如果存在 mRNA join() 则仅使用 mRNA（CDS exon 是 mRNA exon 的子集）
  const hasMrnaJoin = features.some(f => f.type === 'mRNA' && f.location.includes('join('))
  const sourceFeatures = hasMrnaJoin
    ? features.filter(f => f.type === 'mRNA' && f.location.includes('join('))
    : features.filter(f => f.type === 'CDS' && f.location.includes('join('))

  // 记录已生成的 exon 位置，避免重复
  const generatedExons = new Set<string>()

  for (const feat of sourceFeatures) {
    const segments = parseJoinSegments(feat.location)
    if (segments.length < 2) continue

    const geneName = feat.qualifiers.gene || feat.qualifiers.label || ''

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const key = `${seg.start}-${seg.end}`

      if (!hasExon && !generatedExons.has(key)) {
        generatedExons.add(key)
        const exonQualifiers: Record<string, string> = { gene: geneName }
        if (feat.qualifiers.product) exonQualifiers.product = feat.qualifiers.product
        if (feat.qualifiers.transcript_id) exonQualifiers.transcript_id = feat.qualifiers.transcript_id
        exonQualifiers.note = `Exon ${i + 1} of ${segments.length}`

        newFeatures.push({
          type: 'exon',
          location: feat.strand === -1
            ? `complement(${seg.start + 1}..${seg.end + 1})`
            : `${seg.start + 1}..${seg.end + 1}`,
          start: seg.start,
          end: seg.end,
          strand: feat.strand,
          qualifiers: exonQualifiers
        })
      }

      // 生成 intron（当前段与下一段之间的间隔）
      if (!hasIntron && i < segments.length - 1) {
        const intronStart = seg.end + 1
        const intronEnd = segments[i + 1].start - 1
        if (intronEnd > intronStart) {
          const intronQualifiers: Record<string, string> = { gene: geneName }
          if (feat.qualifiers.product) intronQualifiers.product = feat.qualifiers.product
          intronQualifiers.note = `Intron ${i + 1} of ${segments.length - 1}`

          newFeatures.push({
            type: 'intron',
            location: feat.strand === -1
              ? `complement(${intronStart + 1}..${intronEnd + 1})`
              : `${intronStart + 1}..${intronEnd + 1}`,
            start: intronStart,
            end: intronEnd,
            strand: feat.strand,
            qualifiers: intronQualifiers
          })
        }
      }
    }
  }

  // 将推断的特征添加到列表
  if (newFeatures.length > 0) {
    features.push(...newFeatures)
    log.info(`Inferred ${newFeatures.filter(f => f.type === 'exon').length} exons and ${newFeatures.filter(f => f.type === 'intron').length} introns from join() features`)
  }
}

/**
 * 解析 join() 位置字符串中的各个片段
 * 输入: "complement(join(4001..4725,5561..5904,6073..6391))"
 * 输出: [{start: 4000, end: 4724}, {start: 5560, end: 5903}, {start: 6072, end: 6390}]  (0-based)
 */
function parseJoinSegments(location: string): { start: number; end: number }[] {
  let loc = location

  // 去除 complement() 包装
  if (loc.startsWith('complement(')) {
    loc = loc.replace('complement(', '').replace(/\)$/, '')
  }

  // 去除 join() 包装
  if (loc.startsWith('join(')) {
    loc = loc.replace('join(', '').replace(/\)$/, '')
  }

  const parts = loc.split(',')
  const segments: { start: number; end: number }[] = []

  for (const part of parts) {
    const cleaned = part.trim().replace(/[<>]/g, '')
    const rangeMatch = cleaned.match(/(\d+)\.\.(\d+)/)
    if (rangeMatch) {
      segments.push({
        start: parseInt(rangeMatch[1]) - 1,  // 1-based → 0-based
        end: parseInt(rangeMatch[2]) - 1
      })
    } else {
      const singleMatch = cleaned.match(/(\d+)/)
      if (singleMatch) {
        const pos = parseInt(singleMatch[1]) - 1
        segments.push({ start: pos, end: pos })
      }
    }
  }

  // 按 start 升序排列
  segments.sort((a, b) => a.start - b.start)
  return segments
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
  log.info(`FASTA parsing: ${content.length} chars`)
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

  log.info(`FASTA parse complete: ${records.length} records${records.length > 0 ? `, total ${records.reduce((s, r) => s + r.sequence.length, 0)}bp` : ''}`)
  return records
}

/**
 * 解析 EMBL 格式文件
 * 规格书: optimization-spec.md §1.1 EMBL格式支持, 基因工程软件优化规格说明书.md §3.1
 *
 * EMBL 格式关键字:
 *   ID = 标识行 (名称/拓扑/长度)
 *   AC = 登录号
 *   DE = 描述
 *   KW = 关键词
 *   OS = 生物体
 *   FT = 特征表
 *   SQ = 序列起始
 *   // = 记录结束
 */
export function parseEMBL(content: string): GenBankRecord {
  log.info(`EMBL parsing: ${content.length} chars`)
  const lines = content.replace(/\r/g, '').split('\n')

  let name = ''
  let description = ''
  let accession = ''
  let sequence = ''
  let topology: 'circular' | 'linear' = 'linear'
  const features: GenBankFeature[] = []

  let inSequence = false
  let currentFeature: Partial<GenBankFeature> | null = null
  let currentQualifier = ''
  let currentQualValue = ''

  const flushQualifier = () => {
    if (currentFeature && currentQualifier && currentQualValue) {
      if (!currentFeature.qualifiers) currentFeature.qualifiers = {}
      currentFeature.qualifiers[currentQualifier] = currentQualValue.replace(/^"|"$/g, '')
    }
    currentQualifier = ''
    currentQualValue = ''
  }

  const flushFeature = () => {
    flushQualifier()
    if (currentFeature && currentFeature.type) {
      features.push({
        type: currentFeature.type,
        location: currentFeature.location || '',
        start: currentFeature.start ?? 0,
        end: currentFeature.end ?? 0,
        strand: currentFeature.strand ?? 1,
        qualifiers: currentFeature.qualifiers || {},
        label: currentFeature.qualifiers?.['gene'] || currentFeature.qualifiers?.['product'] || currentFeature.qualifiers?.['label'] || currentFeature.type
      } as GenBankFeature)
    }
    currentFeature = null
  }

  for (const line of lines) {
    if (inSequence) {
      // SQ 行之后的序列行: 空格分隔的碱基 + 末尾数字
      if (line.startsWith('//')) break
      // 提取碱基: 去除空格和末尾数字
      const seqLine = line.replace(/\s/g, '').replace(/\d+$/, '')
      sequence += seqLine.toLowerCase()
      continue
    }

    if (line.startsWith('ID   ')) {
      // ID   name; SV 1; circular; DNA; STD; UNC; 5000 BP.
      const parts = line.substring(5).trim().split(';').map(s => s.trim())
      name = parts[0] || ''
      for (const p of parts) {
        if (p.toLowerCase().includes('circular')) topology = 'circular'
        if (p.toLowerCase().includes('linear')) topology = 'linear'
      }
    } else if (line.startsWith('AC   ')) {
      accession = line.substring(5).trim().replace(/;$/, '')
    } else if (line.startsWith('DE   ')) {
      description += (description ? ' ' : '') + line.substring(5).trim()
    } else if (line.startsWith('SQ   ')) {
      inSequence = true
    } else if (line.startsWith('FT   ')) {
      const ftContent = line.substring(5)
      // 新特征: FT   feature_type    location
      const featureMatch = ftContent.match(/^(\S+)\s+(.*)$/)
      if (featureMatch && !ftContent.startsWith('/')) {
        flushFeature()
        const type = featureMatch[1]
        const locStr = featureMatch[2].trim()
        const { start, end, strand } = parseEMBLLocation(locStr)
        currentFeature = { type, start, end, strand, qualifiers: {} }
      } else if (ftContent.startsWith('/')) {
        // 限定符: /qualifier="value" or /qualifier
        flushQualifier()
        const qualContent = ftContent.substring(1).trim()
        const eqIdx = qualContent.indexOf('=')
        if (eqIdx !== -1) {
          currentQualifier = qualContent.substring(0, eqIdx)
          currentQualValue = qualContent.substring(eqIdx + 1)
        } else {
          currentQualifier = qualContent
          currentQualValue = 'true'
        }
      } else if (currentQualifier) {
        // 续行
        currentQualValue += ftContent.trim()
      }
    }
  }

  flushFeature()

  const result: GenBankRecord = {
    name,
    description,
    sequence: sequence.toLowerCase(),
    size: sequence.length,
    features,
    accession,
    version: '',
    topology
  }

  log.info(`EMBL parse complete: seq=${sequence.length}bp, features=${features.length}, topology=${topology}`)
  return result
}

/** 解析 EMBL 位置格式: 123..456, complement(123..456), join(123..456,789..999) */
function parseEMBLLocation(loc: string): { start: number; end: number; strand: 1 | -1 } {
  let strand: 1 | -1 = 1
  let inner = loc

  if (loc.startsWith('complement(')) {
    strand = -1
    inner = loc.slice(11, -1)
  }
  // 取第一个区间
  const rangeMatch = inner.match(/(\d+)\.\.(\d+)/)
  if (rangeMatch) {
    return { start: parseInt(rangeMatch[1]) - 1, end: parseInt(rangeMatch[2]) - 1, strand }
  }
  // 单碱基
  const num = parseInt(inner)
  if (!isNaN(num)) return { start: num - 1, end: num - 1, strand }
  return { start: 0, end: 0, strand }
}

/** 导出序列为 EMBL 格式 */
export function exportEMBL(record: GenBankRecord): string {
  const lines: string[] = []
  const topology = record.topology || 'linear'
  lines.push(`ID   ${record.name || 'Unnamed'}; SV 1; ${topology}; DNA; STD; UNC; ${record.sequence.length} BP.`)
  lines.push('XX')
  if (record.accession) {
    lines.push(`AC   ${record.accession};`)
    lines.push('XX')
  }
  if (record.description) {
    lines.push(`DE   ${record.description}`)
    lines.push('XX')
  }
  // 特征表
  if (record.features && record.features.length > 0) {
    lines.push('FH   Key             Location/Qualifiers')
    lines.push('FH')
    for (const f of record.features) {
      const strand = f.strand === -1 ? 'complement(' : ''
      const close = f.strand === -1 ? ')' : ''
      const loc = `${strand}${f.start + 1}..${f.end + 1}${close}`
      lines.push(`FT   ${f.type.padEnd(16)}${loc}`)
      if (f.qualifiers) {
        for (const [key, val] of Object.entries(f.qualifiers)) {
          lines.push(`FT                   /${key}="${val}"`)
        }
      }
    }
    lines.push('XX')
  }
  // 序列
  const seq = record.sequence.toLowerCase()
  lines.push(`SQ   Sequence ${seq.length} BP; ${countBases(seq, 'a')} A; ${countBases(seq, 'c')} C; ${countBases(seq, 'g')} G; ${countBases(seq, 't')} T; ${seq.length - countBases(seq, 'a') - countBases(seq, 'c') - countBases(seq, 'g') - countBases(seq, 't')} other;`)
  for (let i = 0; i < seq.length; i += 60) {
    const chunk = seq.slice(i, i + 60)
    const groups = chunk.match(/.{1,10}/g) || []
    const formatted = groups.join(' ')
    lines.push(`     ${formatted.padEnd(66)}${i + chunk.length}`)
  }
  lines.push('//')
  return lines.join('\n')
}

function countBases(seq: string, base: string): number {
  let count = 0
  for (const c of seq) if (c === base) count++
  return count
}
