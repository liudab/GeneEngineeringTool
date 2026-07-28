/**
 * @module utils/zip-utils
 * @description
 * 简易 ZIP 打包/解包工具 — 仅使用 Node.js 内置模块（zlib, fs, path）。
 * 用于物种插件 .plugin 文件的导出和导入。
 *
 * ZIP 格式参考：PKZIP APPNOTE
 * - 本地文件头 (0x04034b50) + 文件数据
 * - 中央目录 (0x02014b50) + 每个文件条目
 * - 中央目录结束标记 (0x06054b50)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs'
import { deflateRawSync, inflateRawSync } from 'zlib'
import path from 'path'

// ============ ZIP 打包 ============

/** CRC-32 计算（ZIP 必需） */
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF
  const table = getCRC32Table()
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF]
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

let crc32Table: Uint32Array | null = null
function getCRC32Table(): Uint32Array {
  if (crc32Table) return crc32Table
  crc32Table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    crc32Table[i] = c >>> 0
  }
  return crc32Table
}

/** DOS 时间格式（用于 ZIP 头） */
function toDosDateTime(date: Date): { time: number; date: number } {
  const time = ((date.getHours() & 0x1F) << 11) |
    ((date.getMinutes() & 0x3F) << 5) |
    ((date.getSeconds() >> 1) & 0x1F)
  const dosDate = (((date.getFullYear() - 1980) & 0x7F) << 9) |
    (((date.getMonth() + 1) & 0x0F) << 5) |
    (date.getDate() & 0x1F)
  return { time: time & 0xFFFF, date: dosDate & 0xFFFF }
}

interface ZipEntry {
  name: string
  data: Buffer
  compressedData: Buffer
  crc: number
  isDirectory: boolean
  dosTime: number
  dosDate: number
}

/** 递归收集目录下所有文件 */
function collectFiles(dir: string, basePath: string = ''): { relativePath: string; absolutePath: string; isDirectory: boolean }[] {
  const result: { relativePath: string; absolutePath: string; isDirectory: boolean }[] = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const absPath = path.join(dir, entry)
    const relPath = basePath ? `${basePath}/${entry}` : entry
    const stat = statSync(absPath)
    if (stat.isDirectory()) {
      result.push({ relativePath: relPath + '/', absolutePath: absPath, isDirectory: true })
      result.push(...collectFiles(absPath, relPath))
    } else {
      result.push({ relativePath: relPath, absolutePath: absPath, isDirectory: false })
    }
  }
  return result
}

/**
 * 将目录打包为 ZIP 格式的 Buffer
 * @param sourceDir 源目录路径
 * @param innerDirName ZIP 内的顶层目录名（如 "species-水稻"）
 */
export function zipDirectory(sourceDir: string, innerDirName: string): Buffer {
  const files = collectFiles(sourceDir)
  const entries: ZipEntry[] = []

  for (const file of files) {
    const zipPath = `${innerDirName}/${file.relativePath}`
    const now = new Date()
    const { time: dosTime, date: dosDate } = toDosDateTime(now)

    if (file.isDirectory) {
      entries.push({
        name: zipPath,
        data: Buffer.alloc(0),
        compressedData: Buffer.alloc(0),
        crc: 0,
        isDirectory: true,
        dosTime,
        dosDate,
      })
    } else {
      const data = readFileSync(file.absolutePath)
      const compressed = deflateRawSync(data)
      entries.push({
        name: zipPath,
        data,
        compressedData: compressed,
        crc: crc32(data),
        isDirectory: false,
        dosTime,
        dosDate,
      })
    }
  }

  // 构建 ZIP 文件
  const localHeaders: Buffer[] = []
  const centralHeaders: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf-8')
    const useStored = entry.isDirectory || entry.compressedData.length >= entry.data.length
    const finalData = useStored ? entry.data : entry.compressedData
    const method = useStored ? 0 : 8 // 0=store, 8=deflate

    // Local file header (30 bytes + name + data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)  // signature
    localHeader.writeUInt16LE(20, 4)            // version needed (2.0)
    localHeader.writeUInt16LE(0, 6)             // flags
    localHeader.writeUInt16LE(method, 8)        // compression method
    localHeader.writeUInt16LE(entry.dosTime, 10) // last mod time
    localHeader.writeUInt16LE(entry.dosDate, 12) // last mod date
    localHeader.writeUInt32LE(entry.crc, 14)    // CRC-32
    localHeader.writeUInt32LE(finalData.length, 18) // compressed size
    localHeader.writeUInt32LE(entry.data.length, 22) // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26) // name length
    localHeader.writeUInt16LE(0, 28)            // extra field length

    const localBlock = Buffer.concat([localHeader, nameBuffer, finalData])
    localHeaders.push(localBlock)

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)  // signature
    centralHeader.writeUInt16LE(20, 4)           // version made by
    centralHeader.writeUInt16LE(20, 6)           // version needed
    centralHeader.writeUInt16LE(0, 8)            // flags
    centralHeader.writeUInt16LE(method, 10)      // compression method
    centralHeader.writeUInt16LE(entry.dosTime, 12)
    centralHeader.writeUInt16LE(entry.dosDate, 14)
    centralHeader.writeUInt32LE(entry.crc, 16)
    centralHeader.writeUInt32LE(finalData.length, 20) // compressed size
    centralHeader.writeUInt32LE(entry.data.length, 24) // uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28) // name length
    centralHeader.writeUInt16LE(0, 30)           // extra field length
    centralHeader.writeUInt16LE(0, 32)           // comment length
    centralHeader.writeUInt16LE(0, 34)           // disk number start
    centralHeader.writeUInt16LE(0, 36)           // internal file attributes
    centralHeader.writeUInt32LE(entry.isDirectory ? 0x10 : 0, 38) // external attributes
    centralHeader.writeUInt32LE(offset, 42)      // relative offset of local header

    centralHeaders.push(Buffer.concat([centralHeader, nameBuffer]))

    offset += localBlock.length
  }

  // End of central directory record
  const centralDirOffset = offset
  let centralDirSize = 0
  for (const ch of centralHeaders) centralDirSize += ch.length

  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)        // signature
  endRecord.writeUInt16LE(0, 4)                  // disk number
  endRecord.writeUInt16LE(0, 6)                  // disk with central dir
  endRecord.writeUInt16LE(entries.length, 8)     // entries on this disk
  endRecord.writeUInt16LE(entries.length, 10)    // total entries
  endRecord.writeUInt32LE(centralDirSize, 12)    // central dir size
  endRecord.writeUInt32LE(centralDirOffset, 16)  // central dir offset
  endRecord.writeUInt16LE(0, 20)                 // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endRecord])
}

// ============ ZIP 解包 ============

/**
 * 从 ZIP Buffer 解压到目标目录
 * @param zipBuffer ZIP 文件内容
 * @param targetDir 解压目标目录
 */
export function unzipToDirectory(zipBuffer: Buffer, targetDir: string): void {
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })

  let offset = 0

  while (offset < zipBuffer.length - 4) {
    const signature = zipBuffer.readUInt32LE(offset)

    if (signature !== 0x04034b50) break // Not a local file header

    const method = zipBuffer.readUInt16LE(offset + 8)
    const compressedSize = zipBuffer.readUInt32LE(offset + 18)
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 22)
    const nameLength = zipBuffer.readUInt16LE(offset + 26)
    const extraLength = zipBuffer.readUInt16LE(offset + 28)
    const name = zipBuffer.slice(offset + 30, offset + 30 + nameLength).toString('utf-8')

    const dataStart = offset + 30 + nameLength + extraLength
    const compressedData = zipBuffer.slice(dataStart, dataStart + compressedSize)

    const targetPath = path.join(targetDir, name)

    if (name.endsWith('/')) {
      // Directory
      if (!existsSync(targetPath)) mkdirSync(targetPath, { recursive: true })
    } else {
      // File
      const parentDir = path.dirname(targetPath)
      if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true })

      let fileData: Buffer
      if (method === 0) {
        // Stored (no compression)
        fileData = compressedData
      } else if (method === 8) {
        // Deflated
        fileData = inflateRawSync(compressedData)
      } else {
        throw new Error(`Unsupported compression method: ${method} for file: ${name}`)
      }

      if (fileData.length !== uncompressedSize) {
        // Size mismatch, but write anyway
        console.warn(`[zip-utils] Size mismatch for ${name}: expected ${uncompressedSize}, got ${fileData.length}`)
      }

      writeFileSync(targetPath, fileData)
    }

    offset = dataStart + compressedSize
  }
}
