import type { Buffer } from 'node:buffer'
import { decompressLzss } from './lzss'
import { flattenPakEntries, parsePak } from './pak'

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
  const originalEntries = flattenPakEntries(original.entries)
  const generatedEntries = flattenPakEntries(generated.entries)
  if (originalEntries.length !== generatedEntries.length)
    differences.add('entry count differs')
  let matchedFiles = 0
  let structureMatches = originalEntries.length === generatedEntries.length
  // 逻辑一致要求目录结构、条目顺序、完整路径和文件内容一致；压缩字节可以不同。
  const totalEntries = Math.max(originalEntries.length, generatedEntries.length)
  const totalFiles = Math.max(original.files.length, generated.files.length)
  for (let index = 0; index < totalEntries; index++) {
    const left = originalEntries[index]
    const right = generatedEntries[index]
    if (!left || !right) continue
    if (left.path !== right.path || left.type !== right.type) {
      differences.add('entry order or filename differs')
      structureMatches = false
    }
    if (left.dataOffset !== right.dataOffset) differences.add('offset differs')
    if (left.field00 !== right.field00 || left.field10 !== right.field10)
      differences.add('entry metadata differs')
    if (left.type === 'file' && right.type === 'file') {
      if (!left.packedData.equals(right.packedData))
        differences.add('compressed stream differs')
      const leftData = decompressLzss(left.packedData, left.unpackedSize)
      const rightData = decompressLzss(right.packedData, right.unpackedSize)
      if (left.path === right.path && leftData.equals(rightData)) matchedFiles++
      else differences.add('unpacked content differs')
    }
  }
  const originalGaps = gaps(original)
  const generatedGaps = gaps(generated)
  // 单独比较相邻数据块间距，区分 padding 差异和压缩算法导致的 offset 差异。
  if (
    originalGaps.length !== generatedGaps.length ||
    originalGaps.some((gap, index) => gap !== generatedGaps[index])
  )
    differences.add('padding differs')
  return {
    logicalMatch:
      matchedFiles === totalFiles &&
      original.files.length === generated.files.length &&
      structureMatches,
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
