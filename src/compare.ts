import type { Buffer } from 'node:buffer'
import type { PakEntry } from './pak'
import { flattenPakEntries, parsePak, readPakEntryData } from './pak'

export interface EntryDescription {
  path: string
  type: PakEntry['type']
}

export interface EntryOrderDifference {
  index: number
  original?: EntryDescription
  generated?: EntryDescription
}

export interface ValueDifference<T> {
  original: T
  generated: T
}

export interface EntryMetadataDifference {
  path: string
  field00?: ValueDifference<number>
  field10?: ValueDifference<number>
}

export interface EntrySizeDifference {
  path: string
  packedSize: ValueDifference<number>
  unpackedSize: ValueDifference<number>
}

export interface EntryOffsetDifference {
  path: string
  original: number
  generated: number
}

export interface PakComparisonDetails {
  entryOrder: EntryOrderDifference[]
  metadata: EntryMetadataDifference[]
  sizes: EntrySizeDifference[]
  offsets: EntryOffsetDifference[]
}

export interface PakComparisonResult {
  logicalMatch: boolean
  structuralMatch: boolean
  binaryIdentical: boolean
  matchedFiles: number
  totalFiles: number
  differences: string[]
  details: PakComparisonDetails
}

function entriesByPath(entries: readonly PakEntry[]): {
  entries: Map<string, PakEntry>
  duplicate: boolean
} {
  const result = new Map<string, PakEntry>()
  let duplicate = false
  for (const entry of entries) {
    if (result.has(entry.path)) duplicate = true
    result.set(entry.path, entry)
  }
  return { entries: result, duplicate }
}

function sameKeys(
  left: ReadonlyMap<string, unknown>,
  right: ReadonlyMap<string, unknown>,
): boolean {
  return (
    left.size === right.size && [...left.keys()].every((key) => right.has(key))
  )
}

function orderedUnionPaths(
  original: readonly PakEntry[],
  generated: readonly PakEntry[],
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of [...original, ...generated]) {
    if (seen.has(entry.path)) continue
    seen.add(entry.path)
    result.push(entry.path)
  }
  return result
}

function describeEntry(entry: PakEntry): EntryDescription {
  return { path: entry.path, type: entry.type }
}

export function comparePaks(
  originalBuffer: Buffer,
  generatedBuffer: Buffer,
): PakComparisonResult {
  const original = parsePak(originalBuffer)
  const generated = parsePak(generatedBuffer)
  const differences = new Set<string>()
  if (!original.header.raw.equals(generated.header.raw))
    differences.add('header differs')

  const originalEntries = flattenPakEntries(original.entries)
  const generatedEntries = flattenPakEntries(generated.entries)
  if (originalEntries.length !== generatedEntries.length)
    differences.add('entry count differs')

  const entryOrder: EntryOrderDifference[] = []
  const totalEntries = Math.max(originalEntries.length, generatedEntries.length)
  for (let index = 0; index < totalEntries; index++) {
    const left = originalEntries[index]
    const right = generatedEntries[index]
    if (left?.path === right?.path && left?.type === right?.type) continue
    entryOrder.push({
      index,
      original: left && describeEntry(left),
      generated: right && describeEntry(right),
    })
  }
  if (entryOrder.length > 0) differences.add('entry order differs')

  const originalAll = entriesByPath(originalEntries)
  const generatedAll = entriesByPath(generatedEntries)
  const metadata: EntryMetadataDifference[] = []
  const sizes: EntrySizeDifference[] = []
  const offsets: EntryOffsetDifference[] = []
  for (const entryPath of orderedUnionPaths(
    originalEntries,
    generatedEntries,
  )) {
    const left = originalAll.entries.get(entryPath)
    const right = generatedAll.entries.get(entryPath)
    if (!left || !right || left.type !== right.type) continue

    const metadataDifference: EntryMetadataDifference = { path: entryPath }
    if (left.field00 !== right.field00)
      metadataDifference.field00 = {
        original: left.field00,
        generated: right.field00,
      }
    if (left.field10 !== right.field10)
      metadataDifference.field10 = {
        original: left.field10,
        generated: right.field10,
      }
    if (metadataDifference.field00 || metadataDifference.field10)
      metadata.push(metadataDifference)

    if (
      left.packedSize !== right.packedSize ||
      left.unpackedSize !== right.unpackedSize
    )
      sizes.push({
        path: entryPath,
        packedSize: {
          original: left.packedSize,
          generated: right.packedSize,
        },
        unpackedSize: {
          original: left.unpackedSize,
          generated: right.unpackedSize,
        },
      })
    if (left.dataOffset !== right.dataOffset)
      offsets.push({
        path: entryPath,
        original: left.dataOffset,
        generated: right.dataOffset,
      })
  }
  if (metadata.length > 0) differences.add('entry metadata differs')
  if (offsets.length > 0) differences.add('offset differs')
  if (sizes.length > 0) differences.add('entry size differs')

  const originalDirectories = entriesByPath(original.directories)
  const generatedDirectories = entriesByPath(generated.directories)
  const directoryPathsMatch =
    !originalDirectories.duplicate &&
    !generatedDirectories.duplicate &&
    sameKeys(originalDirectories.entries, generatedDirectories.entries)
  if (!directoryPathsMatch) differences.add('directory paths differ')

  const originalFiles = entriesByPath(original.files)
  const generatedFiles = entriesByPath(generated.files)
  const filePathsMatch =
    !originalFiles.duplicate &&
    !generatedFiles.duplicate &&
    sameKeys(originalFiles.entries, generatedFiles.entries)
  if (!filePathsMatch) differences.add('file paths differ')

  let matchedFiles = 0
  for (const [entryPath, left] of originalFiles.entries) {
    const right = generatedFiles.entries.get(entryPath)
    if (!right) continue
    if (!left.packedData.equals(right.packedData))
      differences.add('compressed stream differs')
    if (readPakEntryData(left).equals(readPakEntryData(right))) matchedFiles++
    else differences.add('unpacked content differs')
  }

  const originalGaps = gaps(original)
  const generatedGaps = gaps(generated)
  if (
    originalGaps.length !== generatedGaps.length ||
    originalGaps.some((gap, index) => gap !== generatedGaps[index])
  )
    differences.add('padding differs')

  const totalFiles = Math.max(original.files.length, generated.files.length)
  const pathsStructurallyMatch =
    !originalAll.duplicate &&
    !generatedAll.duplicate &&
    sameKeys(originalAll.entries, generatedAll.entries)
  return {
    logicalMatch:
      directoryPathsMatch &&
      filePathsMatch &&
      matchedFiles === totalFiles &&
      original.files.length === generated.files.length,
    structuralMatch:
      pathsStructurallyMatch &&
      entryOrder.length === 0 &&
      metadata.length === 0 &&
      offsets.length === 0 &&
      sizes.length === 0,
    binaryIdentical: originalBuffer.equals(generatedBuffer),
    matchedFiles,
    totalFiles,
    differences: [...differences],
    details: { entryOrder, metadata, sizes, offsets },
  }
}

function gaps(archive: ReturnType<typeof parsePak>): number[] {
  const entries = flattenPakEntries(archive.entries)
  return entries.map((entry, index) => {
    const previousEnd =
      index === 0
        ? archive.dataStart
        : entries[index - 1]!.dataOffset + entries[index - 1]!.packedSize
    return entry.dataOffset - previousEnd
  })
}
