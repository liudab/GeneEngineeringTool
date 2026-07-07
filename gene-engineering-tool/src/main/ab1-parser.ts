/**
 * AB1 (ABIF) 文件解析器
 * Applied Biosystems 测序仪原始数据格式
 * 解析峰图 trace 数据用于色谱图(chromatogram)显示
 *
 * ABIF 格式参考：
 *   - 文件头: 4字节 "ABIF" + 2字节 version + 28字节 root directory entry = 34字节
 *   - 目录入口 (28字节) — 实际字段布局（经实测验证）：
 *     offset+0:  tagName     (4 bytes, ascii)
 *     offset+4:  tagNumber   (int32 BE)   ← 注意：实际为4字节，非标准文档中的2字节
 *     offset+8:  elementType (1 byte)     ← 数据类型标识
 *     offset+9:  elementSize (3 bytes BE) ← 元素大小（24位）
 *     offset+12: numElements (int32 BE)
 *     offset+16: dataSize   (int32 BE)
 *     offset+20: dataHandle  (int32 BE) — 当 dataSize<=4 时内联存储数据，否则为文件偏移量
 *     offset+24: reserved    (4 bytes, 忽略)
 *
 *   重要: 当 dataSize <= 4 时，数据直接存储在 dataHandle 的 4 字节中（大端对齐），
 *         而不是通过 dataHandle 指向的外部偏移。
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
  /** 数据在文件中的偏移（dataSize > 4 时有效） */
  dataOffset: number
  /** 内联数据（dataSize <= 4 时有效） */
  inlineData: Buffer
}

const DIR_ENTRY_SIZE = 28

/**
 * 从 3 字节大端整数读取 elementSize
 */
function readInt24BE(buffer: Buffer, offset: number): number {
  return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2]
}

/**
 * 解析 ABIF 文件
 */
export function parseAb1(buffer: Buffer): Ab1TraceData {
  if (buffer.length < 34) {
    throw new Error(`文件太小 (${buffer.length} bytes)，不是有效的 AB1 文件`)
  }

  // 验证 magic bytes
  const magic = buffer.toString('ascii', 0, 4)
  if (magic !== 'ABIF') {
    throw new Error(`Magic bytes 为 "${magic}"，不是有效的 AB1/ABIF 文件`)
  }

  const version = buffer.readInt16BE(4)
  console.log(`[AB1] File version: ${version}, size: ${buffer.length} bytes`)

  // 读取根目录入口 (offset 6, 28 bytes)
  const rootEntry = readDirectoryEntry(buffer, 6)
  console.log(`[AB1] Root entry: tag="${rootEntry.tagName}", num=${rootEntry.tagNumber}, type=${rootEntry.elementType}, elemSize=${rootEntry.elementSize}, numElem=${rootEntry.numElements}, dataSize=${rootEntry.dataSize}, offset=${rootEntry.dataOffset}`)

  // 根目录验证（更宽松）
  if (rootEntry.numElements <= 0) {
    throw new Error(`ABIF 根目录条目数为 ${rootEntry.numElements}`)
  }
  if (rootEntry.numElements > 10000) {
    throw new Error(`ABIF 根目录条目数过多 (${rootEntry.numElements})`)
  }
  if (rootEntry.dataOffset < 0 || rootEntry.dataOffset >= buffer.length) {
    throw new Error(`ABIF 根目录数据偏移无效 (${rootEntry.dataOffset}, 文件大小 ${buffer.length})`)
  }

  // 解析所有目录条目
  const directory = new Map<string, AbifDirectoryEntry>()

  for (let i = 0; i < rootEntry.numElements; i++) {
    const entryOffset = rootEntry.dataOffset + i * DIR_ENTRY_SIZE
    if (entryOffset + DIR_ENTRY_SIZE > buffer.length) {
      console.log(`[AB1] Directory entry ${i} out of bounds at offset ${entryOffset}, stopping`)
      break
    }
    const entry = readDirectoryEntry(buffer, entryOffset)
    if (!entry.tagName || entry.tagName.length === 0) continue

    const key = `${entry.tagName}.${entry.tagNumber}`
    directory.set(key, entry)
  }

  console.log(`[AB1] Parsed ${directory.size} directory entries`)

  // 打印所有目录条目（调试用）
  const allKeys = Array.from(directory.keys()).sort()
  for (const key of allKeys) {
    const e = directory.get(key)!
    const inline = e.dataSize <= 4 ? ' [inline]' : ''
    console.log(`[AB1]   ${key}: type=${e.elementType}, elemSize=${e.elementSize}, numElem=${e.numElements}, dataSize=${e.dataSize}, offset=${e.dataOffset}${inline}`)
  }

  // 提取序列 (PBAS.2 或 PBAS.1)
  const sequence = readStringTag(buffer, directory, 'PBAS', 2) || readStringTag(buffer, directory, 'PBAS', 1) || ''

  // 提取峰位置 (PLOC.2 或 PLOC.1)
  let peakPositions = readShortArrayTag(buffer, directory, 'PLOC', 2)
  if (peakPositions.length === 0) {
    peakPositions = readShortArrayTag(buffer, directory, 'PLOC', 1)
  }

  // 提取质量值 (PQV.2 → PQV.1 → PCON.2 → PCON.1)
  let qualityValues = readByteArrayTag(buffer, directory, 'PQV', 2)
  if (qualityValues.length === 0) qualityValues = readByteArrayTag(buffer, directory, 'PQV', 1)
  if (qualityValues.length === 0) qualityValues = readByteArrayTag(buffer, directory, 'PCON', 2)
  if (qualityValues.length === 0) qualityValues = readByteArrayTag(buffer, directory, 'PCON', 1)

  // 提取样本名称 (SMPL.1)
  const sampleName = readStringTag(buffer, directory, 'SMPL', 1) || ''

  // 提取运行信息
  const runInfo = readStringTag(buffer, directory, 'RUNT', 1) || ''

  // 确定通道到碱基的映射 (FWO_ 标签)
  const baseMapping = getBaseMapping(directory, buffer)
  console.log(`[AB1] Base mapping (filter wheel order): ${baseMapping.join(',')}`)

  // 自动检测 trace 通道编号
  // 常见: DATA.9-12 (ABI 3130/3730), DATA.1-4, DATA.105-108, DATA.205-208
  const traceChannels = detectTraceChannels(directory)
  console.log(`[AB1] Detected trace channels: [${traceChannels.join(', ')}]`)

  // 提取 trace 数据
  const traces: { A: number[]; C: number[]; G: number[]; T: number[] } = { A: [], C: [], G: [], T: [] }
  const channelData: number[][] = []

  for (const chNum of traceChannels) {
    const data = readTraceData(buffer, directory, chNum)
    channelData.push(data)
    console.log(`[AB1] DATA.${chNum}: ${data.length} data points`)
  }

  // 将通道数据映射到碱基
  for (let i = 0; i < 4 && i < channelData.length; i++) {
    const base = baseMapping[i] as 'A' | 'C' | 'G' | 'T'
    if (base) traces[base] = channelData[i] || []
  }

  const dataPoints = Math.max(traces.A.length, traces.C.length, traces.G.length, traces.T.length)

  console.log(`[AB1] Result: seq=${sequence.length}bp, peaks=${peakPositions.length}, traces=${dataPoints}pts, quality=${qualityValues.length}`)

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

/**
 * 读取 28 字节目录入口
 */
function readDirectoryEntry(buffer: Buffer, offset: number): AbifDirectoryEntry {
  const empty: AbifDirectoryEntry = {
    tagName: '', tagNumber: 0, elementType: 0, elementSize: 0,
    numElements: 0, dataSize: 0, dataOffset: 0, inlineData: Buffer.alloc(0)
  }
  if (offset + DIR_ENTRY_SIZE > buffer.length) return empty

  const tagName = buffer.toString('ascii', offset, offset + 4).replace(/\0/g, '').trim()
  // tagNumber: 4字节 int32BE (实测验证，非标准文档中的2字节)
  const tagNumber = buffer.readInt32BE(offset + 4)
  // elementType: 1字节
  const elementType = buffer[offset + 8]
  // elementSize: 3字节大端
  const elementSize = readInt24BE(buffer, offset + 9)
  const numElements = buffer.readInt32BE(offset + 12)
  const dataSize = buffer.readInt32BE(offset + 16)

  // dataHandle 在 offset+20，4 字节
  // 当 dataSize <= 4 时，数据内联存储在 handle 的 4 字节中（大端对齐）
  // 当 dataSize > 4 时，handle 是数据在文件中的偏移量
  let dataOffset = 0
  let inlineData = Buffer.alloc(0)

  if (dataSize <= 4 && dataSize > 0) {
    // 内联数据：从 handle 位置读取
    const handleStart = offset + 20
    const handleEnd = Math.min(handleStart + dataSize, buffer.length)
    inlineData = buffer.subarray(handleStart, handleEnd)
    dataOffset = -1 // 标记为内联
  } else {
    dataOffset = buffer.readInt32BE(offset + 20)
  }

  return {
    tagName,
    tagNumber,
    elementType,
    elementSize,
    numElements,
    dataSize,
    dataOffset,
    inlineData
  }
}

/**
 * 读取目录条目的数据
 */
function readTagData(buffer: Buffer, entry: AbifDirectoryEntry): Buffer {
  if (entry.dataSize <= 0) return Buffer.alloc(0)

  // 内联数据
  if (entry.dataSize <= 4) {
    return entry.inlineData
  }

  // 外部偏移数据
  if (entry.dataOffset < 0 || entry.dataOffset >= buffer.length) return Buffer.alloc(0)
  const end = Math.min(entry.dataOffset + entry.dataSize, buffer.length)
  return buffer.subarray(entry.dataOffset, end)
}

function readStringTag(buffer: Buffer, directory: Map<string, AbifDirectoryEntry>, name: string, num: number): string {
  const key = `${name}.${num}`
  const entry = directory.get(key)
  if (!entry) return ''
  const data = readTagData(buffer, entry)
  if (data.length === 0) return ''
  // Pascal string: 第一个字节是长度（elementType=19 或 bytesPerElement > 1 时尝试）
  if (entry.elementType === 19 && data.length > 1) {
    const pascalLen = data[0]
    return data.subarray(1, Math.min(1 + pascalLen, data.length)).toString('ascii').replace(/\0/g, '').trim()
  }
  // 普通字符串：直接读取
  return data.toString('ascii').replace(/\0/g, '').trim()
}

function readShortArrayTag(buffer: Buffer, directory: Map<string, AbifDirectoryEntry>, name: string, num: number): number[] {
  const key = `${name}.${num}`
  const entry = directory.get(key)
  if (!entry) return []
  const data = readTagData(buffer, entry)
  const result: number[] = []
  // PLOC 等峰位置数据通常为 int16 (short) 数组
  // 如果 dataSize 是 numElements * 2，则为 short; 如果 * 4，则为 int32
  if (entry.numElements > 0 && entry.dataSize > 0) {
    const bytesPerElement = Math.round(entry.dataSize / entry.numElements)
    if (bytesPerElement === 4) {
      // int32 数组
      for (let i = 0; i + 3 < data.length; i += 4) {
        result.push(data.readInt32BE(i))
      }
      return result
    }
  }
  // 默认 short (2 bytes)
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
  // 检查 bytesPerElement 判断是否为 short 数组
  if (entry.numElements > 0 && entry.dataSize > 0) {
    const bytesPerElement = Math.round(entry.dataSize / entry.numElements)
    if (bytesPerElement === 2) {
      const result: number[] = []
      for (let i = 0; i + 1 < data.length; i += 2) {
        result.push(data.readUInt16BE(i))
      }
      return result
    }
  }
  return Array.from(data)
}

/**
 * 读取 trace 通道数据
 * trace 数据始终为 int16 BE 数组
 */
function readTraceData(buffer: Buffer, directory: Map<string, AbifDirectoryEntry>, channelNum: number): number[] {
  const key = `DATA.${channelNum}`
  const entry = directory.get(key)
  if (!entry) return []

  const data = readTagData(buffer, entry)
  if (data.length === 0) return []

  const result: number[] = []

  // trace 数据始终为 int16 BE
  for (let i = 0; i + 1 < data.length; i += 2) {
    result.push(data.readInt16BE(i))
  }

  return result
}

/**
 * 自动检测 trace 数据通道编号
 * 查找所有 DATA.* 条目中 numElements 最大的 4 个（trace 数据通常元素数最多）
 */
function detectTraceChannels(directory: Map<string, AbifDirectoryEntry>): number[] {
  const dataEntries: { num: number; numElements: number; dataSize: number }[] = []

  for (const [key, entry] of directory) {
    if (key.startsWith('DATA.')) {
      const num = entry.tagNumber
      // 排除已知的非 trace 通道（DATA.1 通常是原始信号，DATA.100+ 是分析后数据等）
      dataEntries.push({ num, numElements: entry.numElements, dataSize: entry.dataSize })
    }
  }

  // 按 numElements 降序排列，取前 4 个最大的
  dataEntries.sort((a, b) => b.numElements - a.numElements)

  if (dataEntries.length >= 4) {
    // 取最大的 4 个通道，按编号升序排列
    const top4 = dataEntries.slice(0, 4).map(e => e.num)
    top4.sort((a, b) => a - b)
    return top4
  }

  // 回退到常见通道编号
  const commonSets = [
    [9, 10, 11, 12],   // ABI 3130/3730
    [1, 2, 3, 4],      // 部分旧型号
    [105, 106, 107, 108], // ABI 3500
    [205, 206, 207, 208], // ABI 3500 alternate
  ]

  for (const set of commonSets) {
    const count = set.filter(ch => directory.has(`DATA.${ch}`)).length
    if (count === 4) return set
  }

  // 最终回退
  return [9, 10, 11, 12]
}

/**
 * 确定通道到碱基的映射
 * 基于 FWO_ 标签 (Filter Wheel Order) 或 SpIn 标签
 */
function getBaseMapping(directory: Map<string, AbifDirectoryEntry>, buffer: Buffer): string[] {
  // 尝试读取 FWO_.1 (dye set 的碱基顺序)
  const fwoEntry = directory.get('FWO_.1')
  if (fwoEntry) {
    const data = readTagData(buffer, fwoEntry)
    const order = data.toString('ascii').replace(/\0/g, '').trim()
    if (order.length >= 4) {
      return order.substring(0, 4).split('')
    }
  }

  // 尝试 SpIn.1 (Spectral Calibration)
  const spinEntry = directory.get('SpIn.1')
  if (spinEntry) {
    const data = readTagData(buffer, spinEntry)
    const text = data.toString('ascii').replace(/\0/g, '').trim()
    // SpIn 可能包含染料名称，如 "5-FAM, JOE, TAMRA, ROX"
    const bases = text.match(/[ACGT]/g)
    if (bases && bases.length >= 4) {
      return bases.slice(0, 4)
    }
  }

  // 默认顺序基于常见 ABI 3730 配置 (BigDye v3.1)
  // 通道 9=G(yellow), 10=A(green), 11=T(red), 12=C(blue)
  // FWO_ 通常为 GATC → 通道 9=G, 10=A, 11=T, 12=C
  return ['G', 'A', 'T', 'C']
}
