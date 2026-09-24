import type { Buffer } from 'node:buffer'
import type { PakEntry } from './pak'
import { flattenPakEntries, parsePak, readPakEntryData } from './pak'

export interface PakComparisonResult {
  logicalMatch: boolean
  structuralMatch: boolean
  binaryIdentical: boolean
  matchedFiles: number
  totalFiles: number
  differences: string[]
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

  let orderMatches = originalEntries.length === generatedEntries.length
  let metadataMatches = orderMatches
  let offsetMatches = orderMatches
  let sizeMatches = orderMatches
  const totalEntries = Math.max(originalEntries.length, generatedEntries.length)
  for (let index = 0; index < totalEntries; index++) {
    const left = originalEntries[index]
    const right = generatedEntries[index]
    if (!left || !right) continue
    if (left.path !== right.path || left.type !== right.type)
      orderMatches = false
    if (left.field00 !== right.field00 || left.field10 !== right.field10)
      metadataMatches = false
    if (left.dataOffset !== right.dataOffset) offsetMatches = false
    if (
      left.packedSize !== right.packedSize ||
      left.unpackedSize !== right.unpackedSize
    )
      sizeMatches = false
  }
  if (!orderMatches) differences.add('entry order differs')
  if (!metadataMatches) differences.add('entry metadata differs')
  if (!offsetMatches) differences.add('offset differs')
  if (!sizeMatches) differences.add('entry size differs')

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
  return {
    logicalMatch:
      directoryPathsMatch &&
      filePathsMatch &&
      matchedFiles === totalFiles &&
      original.files.length === generated.files.length,
    structuralMatch:
      orderMatches && metadataMatches && offsetMatches && sizeMatches,
    binaryIdentical: originalBuffer.equals(generatedBuffer),
    matchedFiles,
    totalFiles,
    differences: [...differences],
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
