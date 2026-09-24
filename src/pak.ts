import type { LzssProfile } from './lzss'
import { Buffer } from 'node:buffer'
import iconv from 'iconv-lite'
import {
  ENTRY_FLAG_STORED,
  ENTRY_KIND_DIRECTORY,
  ENTRY_KIND_FILE,
  ENTRY_KIND_MASK,
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

// 每个索引项固定为 64 字节。field00 是条目种类和存储 flag 组成的 bitfield；
// field10 在多个真实样本中表现为 Unix timestamp，但语义尚未完全确认，
// 因此 reference 重建时必须继续保留原值。
export interface PakEntry {
  index: number
  entryOffset: number
  type: 'file' | 'directory'
  stored: boolean
  path: string
  depth: number
  field00: number
  dataOffset: number
  packedSize: number
  unpackedSize: number
  field10: number
  name: string
  nameRaw: Buffer
  raw: Buffer
  packedData: Buffer
  children?: PakEntry[]
}
export interface PakArchive {
  header: PakHeader
  entries: PakEntry[]
  files: PakEntry[]
  directories: PakEntry[]
  entryCount: number
  dataStart: number
  size: number
}
export interface PakBuildEntry {
  name: string
  data?: Buffer
  children?: readonly PakBuildEntry[]
  field00?: number
  field10?: number
  stored?: boolean
  lzssProfile?: LzssProfile
  packedData?: Buffer
  filenameField?: Buffer
}
export interface PakBuildInput {
  entries: readonly PakBuildEntry[]
  field08?: number
  field0c?: number
}
export interface VerificationIssue {
  entryIndex?: number
  filename?: string
  offset?: number
  packedSize?: number
  unpackedSize?: number
  field00?: number
  error: string
}
export interface PakVerificationResult {
  valid: boolean
  archive?: PakArchive
  issues: VerificationIssue[]
}

/** 按归档的深度优先顺序展开目录树。 */
export function flattenPakEntries(entries: readonly PakEntry[]): PakEntry[] {
  const flattened: PakEntry[] = []
  const visit = (items: readonly PakEntry[]): void => {
    for (const entry of items) {
      flattened.push(entry)
      if (entry.children) visit(entry.children)
    }
  }
  visit(entries)
  return flattened
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

function filenameSortKey(name: string): Buffer {
  // 原打包器按 ASCII 大小写不敏感方式比较，并将下划线排在字母之后。
  // 用 “{” 作为下划线的排序权重，可以精确复现全部真实样本的顺序。
  const normalized = name.replace(/[A-Z_]/g, (character) =>
    character === '_' ? '{' : character.toLowerCase(),
  )
  return iconv.encode(normalized, FILENAME_ENCODING)
}

/** 按真实 PAK 打包器使用的文件名规则进行比较。 */
export function comparePakFilenames(left: string, right: string): number {
  const leftRaw = encodeFilename(left)
  const rightRaw = encodeFilename(right)
  const primary = Buffer.compare(filenameSortKey(left), filenameSortKey(right))
  return primary === 0 ? Buffer.compare(leftRaw, rightRaw) : primary
}

function decodeEntryKind(
  field00: number,
  index: number,
  entryPath: string,
): { type: 'file' | 'directory'; stored: boolean } {
  const stored = field00 >>> 31 === 1
  const kind = field00 & ENTRY_KIND_MASK
  if (kind !== ENTRY_KIND_FILE && kind !== ENTRY_KIND_DIRECTORY)
    throw new Error(
      `Entry #${index} (${entryPath}) has unsupported field00=0x${field00.toString(16).padStart(8, '0')}`,
    )
  if (kind === ENTRY_KIND_DIRECTORY && stored)
    throw new Error(
      `Entry #${index} (${entryPath}) cannot be a stored directory (field00=0x${field00.toString(16).padStart(8, '0')})`,
    )
  return {
    type: kind === ENTRY_KIND_DIRECTORY ? 'directory' : 'file',
    stored,
  }
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
  const indexRanges: Array<{ start: number; end: number }> = [
    { start: HEADER_SIZE, end: dataStart },
  ]
  let decodedIndex = 0
  const parseBlock = (
    blockOffset: number,
    blockSize: number,
    parentPath: string,
    depth: number,
  ): PakEntry[] => {
    if (depth > 256) throw new Error('Directory nesting exceeds 256 levels')
    const blockEnd = checkedEnd(
      blockOffset,
      blockSize,
      buffer.length,
      `Directory index at ${blockOffset}`,
    )
    if (blockSize % ENTRY_SIZE !== 0)
      throw new Error(`Invalid directory index size: ${blockSize}`)
    if (blockSize > 0 && blockOffset < dataStart && blockOffset !== HEADER_SIZE)
      throw new Error(
        `Directory index at ${blockOffset} overlaps the header index`,
      )
    if (blockOffset !== HEADER_SIZE && blockSize > 0) {
      if (
        indexRanges.some(
          (range) => blockOffset < range.end && blockEnd > range.start,
        )
      )
        throw new Error(
          `Directory index at ${blockOffset} overlaps another index`,
        )
      indexRanges.push({ start: blockOffset, end: blockEnd })
    }

    const entries: PakEntry[] = []
    for (
      let localIndex = 0;
      localIndex < blockSize / ENTRY_SIZE;
      localIndex++
    ) {
      const entryOffset = blockOffset + localIndex * ENTRY_SIZE
      const raw = Buffer.from(
        buffer.subarray(entryOffset, entryOffset + ENTRY_SIZE),
      )
      const field00 = raw.readUInt32LE(0)
      const dataOffset = raw.readUInt32LE(4)
      const packedSize = raw.readUInt32LE(8)
      const unpackedSize = raw.readUInt32LE(12)
      const currentIndex = decodedIndex++
      const decoded = decodeFilename(
        raw.subarray(FILENAME_OFFSET),
        currentIndex,
      )
      const entryPath = parentPath
        ? `${parentPath}/${decoded.name}`
        : decoded.name
      const entryKind = decodeEntryKind(field00, currentIndex, entryPath)
      const dataEnd = checkedEnd(
        dataOffset,
        packedSize,
        buffer.length,
        `Entry #${currentIndex} data`,
      )
      if (dataOffset < dataStart)
        throw new Error(
          `Entry #${currentIndex} has an invalid data offset: ${dataOffset}`,
        )
      const entry: PakEntry = {
        index: currentIndex,
        entryOffset,
        type: entryKind.type,
        stored: entryKind.stored,
        path: entryPath,
        depth,
        field00,
        dataOffset,
        packedSize,
        unpackedSize,
        field10: raw.readUInt32LE(16),
        name: decoded.name,
        nameRaw: decoded.raw,
        raw,
        packedData: Buffer.from(buffer.subarray(dataOffset, dataEnd)),
      }
      if (entry.type === 'directory') {
        if (packedSize !== unpackedSize || packedSize % ENTRY_SIZE !== 0)
          throw new Error(
            `Directory entry #${currentIndex} has an invalid index size`,
          )
        entry.children = parseBlock(
          dataOffset,
          packedSize,
          entryPath,
          depth + 1,
        )
      }
      entries.push(entry)
    }
    return entries
  }

  const entries = parseBlock(HEADER_SIZE, indexSize, '', 0)
  const flattened = flattenPakEntries(entries)
  // 解析子表后重新按实际深度优先顺序编号，供 list、错误信息和 compare 使用。
  flattened.forEach((entry, index) => (entry.index = index))
  const files = flattened.filter((entry) => entry.type === 'file')
  const directories = flattened.filter((entry) => entry.type === 'directory')
  return {
    header,
    entries,
    files,
    directories,
    entryCount: flattened.length,
    dataStart,
    size: buffer.length,
  }
}

/** 读取文件条目的逻辑内容，统一处理 raw/store 与 LZSS payload。 */
export function readPakEntryData(entry: PakEntry): Buffer {
  if (entry.type !== 'file')
    throw new Error(`Cannot read directory entry as file: ${entry.path}`)
  if (entry.stored) {
    if (entry.packedSize !== entry.unpackedSize)
      throw new Error(
        `Stored entry has different packed/unpacked size: ${entry.path}`,
      )
    return Buffer.from(entry.packedData)
  }
  return decompressLzss(entry.packedData, entry.unpackedSize)
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
  for (const entry of flattenPakEntries(archive.entries)) {
    const context = {
      entryIndex: entry.index,
      filename: entry.path,
      offset: entry.dataOffset,
      packedSize: entry.packedSize,
      unpackedSize: entry.unpackedSize,
      field00: entry.field00,
    }
    if (names.has(entry.path))
      issues.push({ ...context, error: 'Duplicate filename' })
    names.add(entry.path)
    if (entry.type === 'file') {
      try {
        readPakEntryData(entry)
      } catch (error) {
        issues.push({
          ...context,
          error: error instanceof Error ? error.message : String(error),
        })
      }
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

function writeUint32(
  buffer: Buffer,
  value: number,
  offset: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error(`${label} must be a uint32`)
  buffer.writeUInt32LE(value, offset)
}

/** 根据文件内容构建 PAK；未提供的未知字段按已确认样本值 0 写入。 */
export function buildPak(input: PakBuildInput): Buffer {
  interface PreparedEntry {
    source: PakBuildEntry
    type: 'file' | 'directory'
    stored: boolean
    payload?: Buffer
    children?: PreparedEntry[]
  }

  let preparedIndex = 0
  const prepare = (entry: PakBuildEntry): PreparedEntry => {
    const index = preparedIndex++
    const isDirectory = entry.children !== undefined
    if (isDirectory) {
      if (entry.data !== undefined || entry.packedData !== undefined)
        throw new Error(`Directory entry #${index} must not contain file data`)
      if (entry.stored)
        throw new Error(`Directory entry #${index} cannot be stored`)
      if (entry.field00 !== undefined && entry.field00 !== ENTRY_KIND_DIRECTORY)
        throw new Error(`Directory entry #${index} must use field00=1`)
      return {
        source: entry,
        type: 'directory',
        stored: false,
        children: entry.children!.map(prepare),
      }
    }
    if (entry.data === undefined)
      throw new Error(`File entry #${index} is missing data`)

    let requestedStored = entry.stored
    if (entry.field00 !== undefined) {
      const decoded = decodeEntryKind(entry.field00, index, entry.name)
      if (decoded.type !== 'file')
        throw new Error(`File entry #${index} must use a file field00`)
      if (requestedStored !== undefined && requestedStored !== decoded.stored)
        throw new Error(
          `File entry #${index} has conflicting stored and field00 values`,
        )
      requestedStored = decoded.stored
    }
    // packedData 既有 API 表示预压缩流；没有显式模式时继续按 compressed 解释。
    if (entry.packedData !== undefined && requestedStored === undefined)
      requestedStored = false

    let compressed: Buffer | undefined
    if (
      entry.packedData === undefined &&
      (requestedStored === undefined || requestedStored === false)
    )
      compressed = compressLzss(entry.data, entry.lzssProfile)
    const stored = requestedStored ?? compressed!.length >= entry.data.length
    if (stored && entry.lzssProfile !== undefined)
      throw new Error(`Stored entry #${index} must not specify an LZSS profile`)

    let payload: Buffer
    if (entry.packedData !== undefined) {
      if (stored) {
        if (!entry.packedData.equals(entry.data))
          throw new Error(
            `Entry #${index} stored payload does not match its contents`,
          )
      } else {
        let unpacked: Buffer
        try {
          unpacked = decompressLzss(entry.packedData, entry.data.length)
        } catch (error) {
          throw new Error(
            `Entry #${index} has invalid precompressed data: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        if (!unpacked.equals(entry.data))
          throw new Error(
            `Entry #${index} precompressed data does not match its contents`,
          )
      }
      payload = Buffer.from(entry.packedData)
    } else payload = stored ? Buffer.from(entry.data) : compressed!
    return { source: entry, type: 'file', stored, payload }
  }

  const prepared = input.entries.map(prepare)
  const indexSize = prepared.length * ENTRY_SIZE
  const serializedSize = (entries: readonly PreparedEntry[]): number =>
    entries.length * ENTRY_SIZE +
    entries.reduce(
      (sum, entry) =>
        sum +
        (entry.type === 'directory'
          ? serializedSize(entry.children!)
          : entry.payload!.length),
      0,
    )
  const totalSize = HEADER_SIZE + serializedSize(prepared)
  if (totalSize > 0xffffffff) throw new Error('PAK exceeds uint32 size limits')
  const output = Buffer.alloc(totalSize)
  writeUint32(output, PAK_MAGIC, 0, 'magic')
  writeUint32(output, indexSize, 4, 'indexSize')
  writeUint32(output, input.field08 ?? 0, 8, 'field08')
  writeUint32(output, input.field0c ?? 0, 12, 'field0c')
  let writtenIndex = 0
  const writeBlock = (
    entries: readonly PreparedEntry[],
    blockOffset: number,
  ): number => {
    let dataOffset = blockOffset + entries.length * ENTRY_SIZE
    entries.forEach((preparedEntry, localIndex) => {
      const index = writtenIndex++
      const entry = preparedEntry.source
      const raw = Buffer.alloc(ENTRY_SIZE)
      const encodedName = encodeFilename(entry.name)
      const isDirectory = preparedEntry.type === 'directory'
      const packedSize = isDirectory
        ? preparedEntry.children!.length * ENTRY_SIZE
        : preparedEntry.payload!.length
      const unpackedSize = isDirectory ? packedSize : entry.data!.length
      const field00 = isDirectory
        ? ENTRY_KIND_DIRECTORY
        : preparedEntry.stored
          ? ENTRY_FLAG_STORED + ENTRY_KIND_FILE
          : ENTRY_KIND_FILE
      writeUint32(raw, field00, 0, `Entry #${index} field00`)
      writeUint32(raw, dataOffset, 4, `Entry #${index} dataOffset`)
      writeUint32(raw, packedSize, 8, `Entry #${index} packedSize`)
      writeUint32(raw, unpackedSize, 12, `Entry #${index} unpackedSize`)
      writeUint32(raw, entry.field10 ?? 0, 16, `Entry #${index} field10`)
      if (entry.filenameField) {
        if (entry.filenameField.length !== FILENAME_SIZE)
          throw new Error(
            `Entry #${index} filename field must be ${FILENAME_SIZE} bytes`,
          )
        const zero = entry.filenameField.indexOf(0)
        const rawName = entry.filenameField.subarray(
          0,
          zero < 0 ? FILENAME_SIZE : zero,
        )
        if (!rawName.equals(encodedName))
          throw new Error(
            `Entry #${index} filename field does not match its name`,
          )
        entry.filenameField.copy(raw, FILENAME_OFFSET)
      } else encodedName.copy(raw, FILENAME_OFFSET)
      raw.copy(output, blockOffset + localIndex * ENTRY_SIZE)
      if (isDirectory)
        dataOffset = writeBlock(preparedEntry.children!, dataOffset)
      else {
        preparedEntry.payload!.copy(output, dataOffset)
        dataOffset += preparedEntry.payload!.length
      }
    })
    return dataOffset
  }
  writeBlock(prepared, HEADER_SIZE)
  // 构建结果必须能够被同一套严格解析器重新验证，避免输出部分损坏的 PAK。
  const verification = verifyPak(output)
  if (!verification.valid)
    throw new Error(
      `Generated PAK is invalid: ${verification.issues[0]?.error ?? 'unknown error'}`,
    )
  return output
}
