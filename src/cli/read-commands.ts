import type { Buffer } from 'node:buffer'
import type { PakBuildEntry, PakEntry } from '../pak'
import fs from 'node:fs'
import process from 'node:process'
import { comparePaks } from '../compare'
import {
  ENTRY_SIZE,
  FILENAME_ENCODING,
  FILENAME_OFFSET,
  HEADER_SIZE,
} from '../constants'
import { decompressLzss } from '../lzss'
import { buildPak, flattenPakEntries, parsePak, verifyPak } from '../pak'
import { failure, printIssues, ratio, success, warning, yesNo } from './output'

export interface ListOptions {
  long?: boolean
}

function readPak(filename: string): Buffer {
  return fs.readFileSync(filename)
}

function referenceFields(
  entry: PakEntry,
): Pick<PakBuildEntry, 'field00' | 'field10' | 'filenameField'> {
  return {
    field00: entry.field00,
    field10: entry.field10,
    filenameField: entry.raw.subarray(FILENAME_OFFSET),
  }
}

function rebuildEntry(entry: PakEntry): PakBuildEntry {
  if (entry.type === 'directory')
    return {
      name: entry.name,
      children: entry.children!.map(rebuildEntry),
      ...referenceFields(entry),
    }
  return {
    name: entry.name,
    data: decompressLzss(entry.packedData, entry.unpackedSize),
    ...referenceFields(entry),
  }
}

export function showInfo(filename: string): void {
  const archive = parsePak(readPak(filename))
  const packed = archive.files.reduce((sum, entry) => sum + entry.packedSize, 0)
  const unpacked = archive.files.reduce(
    (sum, entry) => sum + entry.unpackedSize,
    0,
  )
  console.log(`Magic: 0x${archive.header.magic.toString(16).padStart(8, '0')}`)
  console.log(`PAK size: ${archive.size}`)
  console.log(`Index size: ${archive.header.indexSize}`)
  console.log(`Root entries: ${archive.entries.length}`)
  console.log(`Directories: ${archive.directories.length}`)
  console.log(`Files: ${archive.files.length}`)
  console.log(`Entry size: ${ENTRY_SIZE}`)
  console.log(`Data start: ${archive.dataStart}`)
  console.log(`Compressed size: ${packed}`)
  console.log(`Uncompressed size: ${unpacked}`)
  console.log(`Compression ratio: ${ratio(packed, unpacked)}`)
  console.log(`Filename encoding: ${FILENAME_ENCODING}`)
  console.log('Compression algorithm: LZSS (4096/18/2)')
}

export function listArchive(filename: string, options: ListOptions): void {
  const archive = parsePak(readPak(filename))
  const entries = flattenPakEntries(archive.entries)
  if (!options.long) {
    for (const entry of entries)
      console.log(entry.type === 'directory' ? `${entry.path}/` : entry.path)
    return
  }
  console.log('INDEX  PACKED  ORIGINAL  RATIO    NAME')
  for (const entry of entries)
    console.log(
      `${String(entry.index).padEnd(7)}${String(entry.packedSize).padEnd(8)}${String(entry.unpackedSize).padEnd(10)}${ratio(entry.packedSize, entry.unpackedSize).padEnd(9)}${entry.type === 'directory' ? `${entry.path}/` : entry.path}`,
    )
}

export function inspectArchive(filename: string): void {
  const archive = parsePak(readPak(filename))
  const entries = flattenPakEntries(archive.entries)
  console.log(`Header hex: ${archive.header.raw.toString('hex')}`)
  console.log(
    `Header uint32: ${[archive.header.magic, archive.header.indexSize, archive.header.field08, archive.header.field0c].join(', ')}`,
  )
  console.log(
    `Root index: ${HEADER_SIZE}..${archive.dataStart} (${archive.entries.length} x ${ENTRY_SIZE})`,
  )
  console.log(
    `Entry type values: ${[...new Set(entries.map((entry) => entry.field00))].join(', ')}`,
  )
  console.log(
    `Unknown +0x10 values: ${[...new Set(entries.map((entry) => entry.field10))].join(', ')}`,
  )
  const alignments = [2, 4, 8, 16, 512, 2048]
  console.log(
    `Aligned offsets: ${alignments.map((alignment) => `${alignment}=${entries.filter((entry) => entry.dataOffset % alignment === 0).length}/${entries.length}`).join(', ')}`,
  )
  const gaps = entries.map((entry, index) => {
    const previousEnd =
      index === 0
        ? archive.dataStart
        : entries[index - 1]!.dataOffset + entries[index - 1]!.packedSize
    return entry.dataOffset - previousEnd
  })
  console.log(
    `Offsets monotonic: ${yesNo(entries.every((entry, index) => index === 0 || entry.dataOffset >= entries[index - 1]!.dataOffset))}`,
  )
  console.log(`Gap values: ${[...new Set(gaps)].join(', ')}`)
  console.log('Entries (first/last):')
  const selected =
    entries.length <= 6
      ? entries
      : [...entries.slice(0, 3), ...entries.slice(-3)]
  for (const entry of selected) {
    const previousEnd =
      entry.index === 0
        ? archive.dataStart
        : entries[entry.index - 1]!.dataOffset +
          entries[entry.index - 1]!.packedSize
    console.log(
      `#${entry.index} type=${entry.type} offset=${entry.dataOffset} packed=${entry.packedSize} unpacked=${entry.unpackedSize} gap=${entry.dataOffset - previousEnd} path=${JSON.stringify(entry.path)} nameRaw=${entry.nameRaw.toString('hex')} dataHead=${entry.packedData.subarray(0, 16).toString('hex')}`,
    )
  }
}

export function verifyArchive(filename: string): void {
  if (!printIssues(readPak(filename))) process.exitCode = 1
}

export function testRoundtrip(filename: string): void {
  const originalBuffer = readPak(filename)
  const verification = verifyPak(originalBuffer)
  if (!verification.valid)
    throw new Error(
      `Original verification failed: ${verification.issues[0]?.error}`,
    )
  const original = verification.archive!
  // 全流程在内存中执行，比较的是重建前后逐条目解压内容，而非压缩流本身。
  const rebuilt = buildPak({
    field08: original.header.field08,
    field0c: original.header.field0c,
    entries: original.entries.map(rebuildEntry),
  })
  const result = comparePaks(originalBuffer, rebuilt)
  console.log(`Original files: ${original.files.length}`)
  console.log(`Original verify: ${success('PASS')}`)
  console.log(`Repack: ${success('PASS')}`)
  console.log(`Repacked verify: ${success('PASS')}`)
  console.log(
    `Roundtrip: ${result.matchedFiles}/${result.totalFiles} ${result.logicalMatch ? success('MATCH') : failure('MISMATCH')}`,
  )
  if (!result.logicalMatch) process.exitCode = 1
}

export function compareArchives(original: string, generated: string): void {
  const result = comparePaks(readPak(original), readPak(generated))
  console.log(
    `Logical match: ${result.logicalMatch ? success('YES') : failure('NO')}`,
  )
  console.log(
    `Binary identical: ${result.binaryIdentical ? success('YES') : warning('NO')}`,
  )
  console.log(
    `Files matched: ${result.matchedFiles === result.totalFiles ? success(`${result.matchedFiles}/${result.totalFiles}`) : failure(`${result.matchedFiles}/${result.totalFiles}`)}`,
  )
  if (result.differences.length > 0)
    console.warn(
      `${warning('Differences:')} ${warning(result.differences.join(', '))}`,
    )
  if (!result.logicalMatch) process.exitCode = 1
}
