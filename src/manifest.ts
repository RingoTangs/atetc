import type { Buffer } from 'node:buffer'
import type { PakArchive } from './pak'
import { createHash } from 'node:crypto'
import {
  ENTRY_SIZE,
  FILENAME_ENCODING,
  LZSS_INITIAL_BYTE,
  LZSS_INITIAL_POSITION,
  LZSS_MAX_MATCH,
  LZSS_THRESHOLD,
  LZSS_WINDOW_SIZE,
  PAK_MAGIC,
} from './constants'
import { decompressLzss } from './lzss'

export interface PakManifestFile {
  index: number
  name: string
  originalOffset: number
  originalPackedSize: number
  originalUnpackedSize: number
  field00: number
  field10: number
  entryRawHex: string
  sha256: string
}

// Manifest 同时保存可读字段和原始二进制元数据：前者用于校验，后者用于兼容重建。
export interface PakManifestV1 {
  version: 1
  format: 'etc-pak'
  entrySize: number
  filenameEncoding: string
  header: {
    magic: number
    indexSize: number
    field08: number
    field0c: number
    rawHex: string
  }
  compression: {
    type: 'lzss'
    windowSize: number
    maxMatch: number
    threshold: number
    initialByte: number
    initialPosition: number
  }
  files: PakManifestFile[]
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function createManifest(archive: PakArchive): PakManifestV1 {
  return {
    version: 1,
    format: 'etc-pak',
    header: {
      magic: archive.header.magic,
      indexSize: archive.header.indexSize,
      field08: archive.header.field08,
      field0c: archive.header.field0c,
      rawHex: archive.header.raw.toString('hex'),
    },
    entrySize: ENTRY_SIZE,
    filenameEncoding: FILENAME_ENCODING,
    compression: {
      type: 'lzss',
      windowSize: LZSS_WINDOW_SIZE,
      maxMatch: LZSS_MAX_MATCH,
      threshold: LZSS_THRESHOLD,
      initialByte: LZSS_INITIAL_BYTE,
      initialPosition: LZSS_INITIAL_POSITION,
    },
    files: archive.entries.map((entry) => ({
      index: entry.index,
      name: entry.name,
      originalOffset: entry.dataOffset,
      originalPackedSize: entry.packedSize,
      originalUnpackedSize: entry.unpackedSize,
      field00: entry.field00,
      field10: entry.field10,
      // 保存完整 Entry，封包时只覆盖已知字段，未知字段仍使用原始字节。
      entryRawHex: entry.raw.toString('hex'),
      // SHA-256 用于记录原始解压内容，也为以后复用未修改压缩流预留依据。
      sha256: sha256(decompressLzss(entry.packedData, entry.unpackedSize)),
    })),
  }
}

export function parseManifest(value: unknown): PakManifestV1 {
  if (!value || typeof value !== 'object') throw new Error('Invalid manifest')
  const manifest = value as Partial<PakManifestV1>
  if (
    manifest.version !== 1 ||
    manifest.format !== 'etc-pak' ||
    manifest.entrySize !== ENTRY_SIZE
  )
    throw new Error('Unsupported manifest format')
  if (manifest.filenameEncoding !== FILENAME_ENCODING)
    throw new Error('Unsupported manifest filename encoding')
  if (!manifest.header || !/^[0-9a-f]{32}$/i.test(manifest.header.rawHex))
    throw new Error('Invalid manifest header')
  if (manifest.header.magic !== PAK_MAGIC)
    throw new Error('Invalid manifest magic')
  const compression = manifest.compression
  // 当前构建器只支持真实样本确认过的参数，拒绝悄悄按另一套参数封包。
  if (
    !compression ||
    compression.type !== 'lzss' ||
    compression.windowSize !== LZSS_WINDOW_SIZE ||
    compression.maxMatch !== LZSS_MAX_MATCH ||
    compression.threshold !== LZSS_THRESHOLD ||
    compression.initialByte !== LZSS_INITIAL_BYTE ||
    compression.initialPosition !== LZSS_INITIAL_POSITION
  )
    throw new Error('Unsupported manifest compression settings')
  if (!Array.isArray(manifest.files)) throw new Error('Invalid manifest files')
  const names = new Set<string>()
  for (let index = 0; index < manifest.files.length; index++) {
    const file = manifest.files[index]
    if (!file || file.index !== index || typeof file.name !== 'string')
      throw new Error(`Invalid manifest entry #${index}`)
    if (!/^[0-9a-f]{128}$/i.test(file.entryRawHex))
      throw new Error(`Invalid raw metadata for entry #${index}`)
    if (!/^[0-9a-f]{64}$/i.test(file.sha256))
      throw new Error(`Invalid SHA-256 for entry #${index}`)
    if (names.has(file.name))
      throw new Error(`Duplicate filename in manifest: ${file.name}`)
    names.add(file.name)
  }
  return manifest as PakManifestV1
}
