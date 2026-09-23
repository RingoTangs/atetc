import type { Buffer } from 'node:buffer'
import { decompressLzss } from './lzss'
import { parsePak } from './pak'

export interface PakComparisonResult {
  logicalMatch: boolean
  binaryIdentical: boolean
  matchedFiles: number
  totalFiles: number
  differences: string[]
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
  if (original.entries.length !== generated.entries.length)
    differences.add('entry count differs')
  let matchedFiles = 0
  const totalFiles = Math.max(original.entries.length, generated.entries.length)
  for (let index = 0; index < totalFiles; index++) {
    const left = original.entries[index]
    const right = generated.entries[index]
    if (!left || !right) continue
    if (left.name !== right.name)
      differences.add('entry order or filename differs')
    if (left.dataOffset !== right.dataOffset) differences.add('offset differs')
    if (left.field00 !== right.field00 || left.field10 !== right.field10)
      differences.add('entry metadata differs')
    if (!left.packedData.equals(right.packedData))
      differences.add('compressed stream differs')
    const leftData = decompressLzss(left.packedData, left.unpackedSize)
    const rightData = decompressLzss(right.packedData, right.unpackedSize)
    if (left.name === right.name && leftData.equals(rightData)) matchedFiles++
    else differences.add('unpacked content differs')
  }
  const originalGaps = gaps(original)
  const generatedGaps = gaps(generated)
  if (
    originalGaps.length !== generatedGaps.length ||
    originalGaps.some((gap, index) => gap !== generatedGaps[index])
  )
    differences.add('padding differs')
  return {
    logicalMatch:
      matchedFiles === totalFiles &&
      original.entries.length === generated.entries.length,
    binaryIdentical: originalBuffer.equals(generatedBuffer),
    matchedFiles,
    totalFiles,
    differences: [...differences],
  }
}

function gaps(archive: ReturnType<typeof parsePak>): number[] {
  return archive.entries.map((entry, index) => {
    const previousEnd =
      index === 0
        ? archive.dataStart
        : archive.entries[index - 1]!.dataOffset +
          archive.entries[index - 1]!.packedSize
    return entry.dataOffset - previousEnd
  })
}
