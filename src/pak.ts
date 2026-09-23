import { Buffer } from 'node:buffer'
import iconv from 'iconv-lite'
import {
  ENTRY_SIZE,
  FILENAME_ENCODING,
  FILENAME_OFFSET,
  FILENAME_SIZE,
  HEADER_SIZE,
  PAK_MAGIC,
} from './constants'
import { compressLzss, decompressLzss } from './lzss'

export interface PakHeader {
  magic: number
  indexSize: number
  field08: number
  field0c: number
  raw: Buffer
}

// 每个索引项固定为 64 字节。field00 与 field10 的真实语义尚未确认，
// 因此解析和重建时始终保留其原值，而不是假设它们一定为 0。
export interface PakEntry {
  index: number
  field00: number
  dataOffset: number
  packedSize: number
  unpackedSize: number
  field10: number
  name: string
  nameRaw: Buffer
  raw: Buffer
  packedData: Buffer
}
export interface PakArchive {
  header: PakHeader
  entries: PakEntry[]
  dataStart: number
  size: number
}
export interface PakBuildEntry {
  name: string
  data: Buffer
  rawEntry: Buffer
}
export interface PakBuildInput {
  rawHeader: Buffer
  entries: readonly PakBuildEntry[]
}
export interface VerificationIssue {
  entryIndex?: number
  filename?: string
  offset?: number
  packedSize?: number
  unpackedSize?: number
  error: string
}
export interface PakVerificationResult {
  valid: boolean
  archive?: PakArchive
  issues: VerificationIssue[]
}

function checkedEnd(
  offset: number,
  size: number,
  limit: number,
  label: string,
): number {
  // 同时防止越界和 offset + size 超出 JavaScript 安全整数范围。
  const end = offset + size
  if (!Number.isSafeInteger(end) || offset < 0 || size < 0 || end > limit)
    throw new Error(`${label} is out of range`)
  return end
}

function decodeFilename(
  rawField: Buffer,
  index: number,
): { name: string; raw: Buffer } {
  const zero = rawField.indexOf(0)
  const raw = Buffer.from(
    rawField.subarray(0, zero < 0 ? rawField.length : zero),
  )
  if (raw.length === 0) throw new Error(`Entry #${index} has an empty filename`)
  const name = iconv.decode(raw, FILENAME_ENCODING)
  // iconv-lite 默认可能用替换字符容忍坏数据，重新编码比较可将其变成严格校验。
  if (
    name.includes('\uFFFD') ||
    !iconv.encode(name, FILENAME_ENCODING).equals(raw)
  )
    throw new Error(
      `Entry #${index} has an invalid ${FILENAME_ENCODING} filename`,
    )
  return { name, raw }
}

export function encodeFilename(name: string): Buffer {
  if (name.includes('\0')) throw new Error('Filename contains NUL')
  const encoded = iconv.encode(name, FILENAME_ENCODING)
  if (iconv.decode(encoded, FILENAME_ENCODING) !== name)
    throw new Error(
      `Filename cannot be encoded as ${FILENAME_ENCODING}: ${name}`,
    )
  if (encoded.length === 0) throw new Error('Filename must not be empty')
  if (encoded.length > FILENAME_SIZE)
    throw new Error(`Filename exceeds ${FILENAME_SIZE} bytes: ${name}`)
  return encoded
}

/** 从完整 PAK Buffer 解析头部、索引和各条目的压缩数据切片。 */
export function parsePak(buffer: Buffer): PakArchive {
  if (buffer.length < HEADER_SIZE)
    throw new Error('PAK is smaller than its header')
  const magic = buffer.readUInt32LE(0)
  if (magic !== PAK_MAGIC)
    throw new Error(`Invalid PAK magic: 0x${magic.toString(16)}`)
  const indexSize = buffer.readUInt32LE(4)
  if (indexSize % ENTRY_SIZE !== 0)
    throw new Error(`Invalid index size: ${indexSize}`)
  const dataStart = checkedEnd(
    HEADER_SIZE,
    indexSize,
    buffer.length,
    'PAK index',
  )
  const header: PakHeader = {
    magic,
    indexSize,
    field08: buffer.readUInt32LE(8),
    field0c: buffer.readUInt32LE(12),
    raw: Buffer.from(buffer.subarray(0, HEADER_SIZE)),
  }
  const entries: PakEntry[] = []
  for (let index = 0; index < indexSize / ENTRY_SIZE; index++) {
    // dataOffset 是相对于整个 PAK 文件的绝对偏移，而不是相对数据区的偏移。
    const offset = HEADER_SIZE + index * ENTRY_SIZE
    const raw = Buffer.from(buffer.subarray(offset, offset + ENTRY_SIZE))
    const dataOffset = raw.readUInt32LE(4)
    const packedSize = raw.readUInt32LE(8)
    const unpackedSize = raw.readUInt32LE(12)
    const dataEnd = checkedEnd(
      dataOffset,
      packedSize,
      buffer.length,
      `Entry #${index} data`,
    )
    if (dataOffset < dataStart)
      throw new Error(
        `Entry #${index} has an invalid data offset: ${dataOffset}`,
      )
    const decoded = decodeFilename(raw.subarray(FILENAME_OFFSET), index)
    entries.push({
      index,
      field00: raw.readUInt32LE(0),
      dataOffset,
      packedSize,
      unpackedSize,
      field10: raw.readUInt32LE(16),
      name: decoded.name,
      nameRaw: decoded.raw,
      raw,
      packedData: Buffer.from(buffer.subarray(dataOffset, dataEnd)),
    })
  }
  return { header, entries, dataStart, size: buffer.length }
}

/** 验证结构、文件名、数据区间以及每个 LZSS 流能否完整解压。 */
export function verifyPak(buffer: Buffer): PakVerificationResult {
  let archive: PakArchive
  try {
    archive = parsePak(buffer)
  } catch (error) {
    return {
      valid: false,
      issues: [
        { error: error instanceof Error ? error.message : String(error) },
      ],
    }
  }
  const issues: VerificationIssue[] = []
  const names = new Set<string>()
  const intervals: Array<{ start: number; end: number; entry: PakEntry }> = []
  for (const entry of archive.entries) {
    const context = {
      entryIndex: entry.index,
      filename: entry.name,
      offset: entry.dataOffset,
      packedSize: entry.packedSize,
      unpackedSize: entry.unpackedSize,
    }
    if (names.has(entry.name))
      issues.push({ ...context, error: 'Duplicate filename' })
    names.add(entry.name)
    try {
      decompressLzss(entry.packedData, entry.unpackedSize)
    } catch (error) {
      issues.push({
        ...context,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    intervals.push({
      start: entry.dataOffset,
      end: entry.dataOffset + entry.packedSize,
      entry,
    })
  }
  intervals.sort((a, b) => a.start - b.start)
  // 按实际数据偏移排序后检查交叠，不要求索引项必须按 offset 排列。
  for (let index = 1; index < intervals.length; index++) {
    if (intervals[index]!.start < intervals[index - 1]!.end) {
      const entry = intervals[index]!.entry
      issues.push({
        entryIndex: entry.index,
        filename: entry.name,
        error: 'Compressed data overlaps another entry',
      })
    }
  }
  return { valid: issues.length === 0, archive, issues }
}

/** 使用原始 Header/Entry 作为模板重新构建 PAK，保留所有未知元数据。 */
export function buildPak(input: PakBuildInput): Buffer {
  if (input.rawHeader.length !== HEADER_SIZE)
    throw new Error(`Header must be ${HEADER_SIZE} bytes`)
  const indexSize = input.entries.length * ENTRY_SIZE
  const compressed = input.entries.map((entry) => compressLzss(entry.data))
  const totalSize =
    HEADER_SIZE +
    indexSize +
    compressed.reduce((sum, item) => sum + item.length, 0)
  if (totalSize > 0xffffffff) throw new Error('PAK exceeds uint32 size limits')
  const output = Buffer.alloc(totalSize)
  // 先复制原始 Header，再只更新已经确认含义的 magic 和 indexSize。
  input.rawHeader.copy(output)
  output.writeUInt32LE(PAK_MAGIC, 0)
  output.writeUInt32LE(indexSize, 4)
  let dataOffset = HEADER_SIZE + indexSize
  input.entries.forEach((entry, index) => {
    if (entry.rawEntry.length !== ENTRY_SIZE)
      throw new Error(`Entry #${index} metadata must be ${ENTRY_SIZE} bytes`)
    const raw = Buffer.from(entry.rawEntry)
    const encodedName = encodeFilename(entry.name)
    raw.writeUInt32LE(dataOffset, 4)
    raw.writeUInt32LE(compressed[index]!.length, 8)
    raw.writeUInt32LE(entry.data.length, 12)
    const originalNameField = raw.subarray(FILENAME_OFFSET)
    const zero = originalNameField.indexOf(0)
    const originalName = originalNameField.subarray(
      0,
      zero < 0 ? originalNameField.length : zero,
    )
    // 名称未改变时保留完整的 44 字节字段，包括 NUL 后可能存在的未知填充字节。
    if (!originalName.equals(encodedName)) {
      raw.fill(0, FILENAME_OFFSET)
      encodedName.copy(raw, FILENAME_OFFSET)
    }
    raw.copy(output, HEADER_SIZE + index * ENTRY_SIZE)
    compressed[index]!.copy(output, dataOffset)
    dataOffset += compressed[index]!.length
  })
  // 构建结果必须能够被同一套严格解析器重新验证，避免输出部分损坏的 PAK。
  const verification = verifyPak(output)
  if (!verification.valid)
    throw new Error(
      `Generated PAK is invalid: ${verification.issues[0]?.error ?? 'unknown error'}`,
    )
  return output
}
