/**
 * AB1 (ABIF) 文件解析器
 * Applied Biosystems 测序仪原始数据格式
 * 解析峰图 trace 数据用于色谱图(chromatogram)显示
 */

export interface Ab1TraceData {
  /** 碱基序列 (base-called) */
  sequence: string
  /** 峰位置 (碱基序号对应的数据点索引) */
  peakPositions: number[]
  /** 四个通道的 trace 数据 */
  traces: {
    A: number[]
    C: number[]
    G: number[]
    T: number[]
  }
  /** 数据点总数 */
  dataPoints: number
  /** 样本名称 */
  sampleName: string
  /** 运行信息 */
  runInfo: string
  /** 碱基质量值 */
  qualityValues: number[]
}

interface AbifDirectoryEntry {
  tagName: string
  tagNumber: number
  elementType: number
  elementSize: number
  numElements: number
  dataSize: number
  dataOffset: number
}

/**
 * 解析 ABIF 文件
 */
export function parseAb1(buffer: Buffer): Ab1TraceData {
  // 验证 magic bytes
  const magic = buffer.toString('ascii', 0, 4)
  if (magic !== 'ABIF') {
    throw new Error('不是有效的 AB1/ABIF 文件')
  }

  // 读取文件头
  const version = buffer.readInt16BE(4)

  // 读取根目录入口 (offset 6)
  const rootEntry = readDirectoryEntry(buffer, 6)

  // 验证根目录入口合理性
  if (rootEntry.numElements <= 0 || rootEntry.numElements > 1000 ||
      rootEntry.dataOffset < 0 || rootEntry.dataOffset >= buffer.length) {
    throw new Error('ABIF 文件目录结构异常')
  }

  // 解析目录
  const directory = new Map<string, AbifDirectoryEntry>()
  const dirEntrySize = 28 // 每个目录入口 28 字节

  for (let i = 0; i < rootEntry.numElements; i++) {
    const entryOffset = rootEntry.dataOffset + i * dirEntrySize
    // 边界检查：确保目录入口在文件范围内
    if (entryOffset + dirEntrySize > buffer.length) break
    const entry = readDirectoryEntry(buffer, entryOffset)
    // 验证数据偏移合理性
    if (entry.dataOffset >= 0 && entry.dataOffset < buffer.length) {
      const key = `${entry.tagName}.${entry.tagNumber}`
      directory.set(key, entry)
    }
  }

  // 提取序列 (PBAS.2)
  const sequence = readStringTag(buffer, directory, 'PBAS', 2) || ''

  // 提取峰位置 (PLOC.1)
  const peakPositions = readShortArrayTag(buffer, directory, 'PLOC', 1)

  // 提取质量值 (PQV.1 或 PCON.1)
  let qualityValues = readByteArrayTag(buffer, directory, 'PQV', 1)
  if (qualityValues.length === 0) {
    qualityValues = readByteArrayTag(buffer, directory, 'PCON', 1)
  }

  // 提取样本名称 (SMPL.1)
  const sampleName = readStringTag(buffer, directory, 'SMPL', 1) || ''

  // 提取运行信息
  const runInfo = readStringTag(buffer, directory, 'RUNT', 1) || ''

  // 确定通道到碱基的映射
  const baseMapping = getBaseMapping(directory, buffer)

  // 提取 trace 数据
  // 通常 DATA.9-12 是 4 个通道的 trace 数据
  const traces: { A: number[]; C: number[]; G: number[]; T: number[] } = {
    A: [],
    C: [],
    G: [],
    T: []
  }

  // 尝试读取通道数据
  // 常见通道编号: 9,10,11,12 或 1,2,3,4
  const channelNumbers = [9, 10, 11, 12]
  const channelData: number[][] = []

  for (const chNum of channelNumbers) {
    const data = readTraceData(buffer, directory, chNum)
    channelData.push(data)
  }

  // 如果通道 9-12 没有数据，尝试 1-4
  if (channelData.every(d => d.length === 0)) {
    const altChannels = [1, 2, 3, 4]
    for (const chNum of altChannels) {
      const data = readTraceData(buffer, directory, chNum)
      channelData.push(data)
    }
  }

  // 将通道数据映射到碱基
  const baseOrder = baseMapping // e.g. ['C', 'A', 'T', 'G']
  for (let i = 0; i < 4; i++) {
    const base = baseOrder[i] as 'A' | 'C' | 'G' | 'T'
    traces[base] = channelData[i] || []
  }

  // 计算数据点数
  const dataPoints = Math.max(
    traces.A.length,
    traces.C.length,
    traces.G.length,
    traces.T.length
  )

  return {
    sequence,
    peakPositions,
    traces,
    dataPoints,
    sampleName,
    runInfo,
    qualityValues
  }
}

function readDirectoryEntry(buffer: Buffer, offset: number): AbifDirectoryEntry {
  // 边界检查：目录入口需要至少 22 字节
  if (offset + 22 > buffer.length) {
    return { tagName: '', tagNumber: 0, elementType: 0, elementSize: 0, numElements: 0, dataSize: 0, dataOffset: 0 }
  }
  const tagName = buffer.toString('ascii', offset, offset + 4)
  const tagNumber = buffer.readInt16BE(offset + 4)
  const elementType = buffer.readInt16BE(offset + 6)
  const elementSize = buffer.readInt16BE(offset + 8)
  const numElements = buffer.readInt32BE(offset + 10)
  const dataSize = buffer.readInt32BE(offset + 14)
  const dataOffset = buffer.readInt32BE(offset + 18)
  // 还有 2 字节的数据头标识 (offset+22) 和 4 字节保留 (offset+24)

  return {
    tagName: tagName.replace(/\0/g, '').trim(),
    tagNumber,
    elementType,
    elementSize,
    numElements,
    dataSize,
    dataOffset
  }
}

function readTagData(buffer: Buffer, entry: AbifDirectoryEntry): Buffer {
  if (entry.dataSize <= 0 || entry.dataOffset < 0) return Buffer.alloc(0)
  // 边界检查：确保数据范围在文件内
  const end = Math.min(entry.dataOffset + entry.dataSize, buffer.length)
  const start = Math.min(entry.dataOffset, buffer.length)
  return buffer.subarray(start, end)
}

function readStringTag(buffer: Buffer, directory: Map<string, AbifDirectoryEntry>, name: string, num: number): string {
  const key = `${name}.${num}`
  const entry = directory.get(key)
  if (!entry) return ''
  const data = readTagData(buffer, entry)
  return data.toString('ascii').replace(/\0/g, '').trim()
}

function readShortArrayTag(buffer: Buffer, directory: Map<string, AbifDirectoryEntry>, name: string, num: number): number[] {
  const key = `${name}.${num}`
  const entry = directory.get(key)
  if (!entry) return []
  const data = readTagData(buffer, entry)
  const result: number[] = []
  for (let i = 0; i + 1 < data.length; i += 2) {
    result.push(data.readUInt16BE(i))
  }
  return result
}

function readByteArrayTag(buffer: Buffer, directory: Map<string, AbifDirectoryEntry>, name: string, num: number): number[] {
  const key = `${name}.${num}`
  const entry = directory.get(key)
  if (!entry) return []
  const data = readTagData(buffer, entry)
  return Array.from(data)
}

function readTraceData(buffer: Buffer, directory: Map<string, AbifDirectoryEntry>, channelNum: number): number[] {
  const key = `DATA.${channelNum}`
  const entry = directory.get(key)
  if (!entry) return []

  const data = readTagData(buffer, entry)
  const result: number[] = []

  // 根据元素类型读取
  // elementType 2 = short (2 bytes), 4 = long (4 bytes), 1 = byte
  if (entry.elementType === 2) {
    // short array
    for (let i = 0; i + 1 < data.length; i += 2) {
      result.push(data.readInt16BE(i))
    }
  } else if (entry.elementType === 4) {
    // long array
    for (let i = 0; i + 3 < data.length; i += 4) {
      result.push(data.readInt32BE(i))
    }
  } else if (entry.elementType === 1) {
    // byte array
    for (let i = 0; i < data.length; i++) {
      result.push(data[i])
    }
  } else {
    // 默认尝试 short
    for (let i = 0; i + 1 < data.length; i += 2) {
      result.push(data.readInt16BE(i))
    }
  }

  return result
}

/**
 * 确定通道到碱基的映射
 * 基于 FWO_ 标签 (Filter Wheel Order) 或 SpIn 标签
 * 默认映射: BigDye Terminator 常用顺序
 */
function getBaseMapping(directory: Map<string, AbifDirectoryEntry>, buffer: Buffer): string[] {
  // 尝试读取 FWO_ 标签 (dye set 的碱基顺序)
  const fwoEntry = directory.get('FWO_.1')
  if (fwoEntry) {
    const data = readTagData(buffer, fwoEntry)
    const order = data.toString('ascii').replace(/\0/g, '').trim()
    if (order.length === 4) {
      return order.split('')
    }
  }

  // 尝试从 DataChannel 标签获取
  // 默认顺序基于常见 ABI 3730 配置
  // 通道 9=C(blue), 10=A(green), 11=T(red), 12=G(black/yellow)
  return ['C', 'A', 'T', 'G']
}
