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
import { detectLzssProfile } from '../lzss'
import {
  buildPak,
  flattenPakEntries,
  parsePak,
  readPakEntryData,
  verifyPak,
} from '../pak'
import { failure, printIssues, ratio, success, warning, yesNo } from './output'

export interface ListOptions {
  long?: boolean
}

export interface CompareOptions {
  verbose?: boolean
}

const VERBOSE_DIFFERENCE_LIMIT = 20

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
  if (entry.payloadKind === 'none')
    return {
      name: entry.name,
      payloadKind: 'none',
      unpackedSizeOverride: entry.unpackedSize,
      ...referenceFields(entry),
    }
  const data = readPakEntryData(entry)
  return {
    name: entry.name,
    data,
    stored: entry.stored,
    lzssProfile: entry.stored
      ? undefined
      : detectLzssProfile(data, entry.packedData),
    ...referenceFields(entry),
  }
}

export function showInfo(filename: string): void {
  const archive = parsePak(readPak(filename))
  const extractableFiles = archive.files.filter(
    (entry) => entry.payloadKind !== 'none',
  )
  const zeroPayloadEntries = archive.files.length - extractableFiles.length
  const packed = extractableFiles.reduce(
    (sum, entry) => sum + entry.packedSize,
    0,
  )
  const unpacked = extractableFiles.reduce(
    (sum, entry) => sum + entry.unpackedSize,
    0,
  )
  console.log(`Magic: 0x${archive.header.magic.toString(16).padStart(8, '0')}`)
  console.log(`PAK size: ${archive.size}`)
  console.log(`Index size: ${archive.header.indexSize}`)
  console.log(`Root entries: ${archive.entries.length}`)
  console.log(`Directories: ${archive.directories.length}`)
  console.log(`File entries: ${archive.files.length}`)
  console.log(`Extractable files: ${extractableFiles.length}`)
  console.log(`Zero-payload entries: ${zeroPayloadEntries}`)
  console.log(`Entry size: ${ENTRY_SIZE}`)
  console.log(`Data start: ${archive.dataStart}`)
  console.log(`Compressed size: ${packed}`)
  console.log(`Uncompressed size: ${unpacked}`)
  console.log(`Compression ratio: ${ratio(packed, unpacked)}`)
  console.log(`Filename encoding: ${FILENAME_ENCODING}`)
  console.log('Storage: raw/store, LZSS (4096/18/2), or zero-payload')
}

function entryMode(entry: PakEntry): string {
  if (entry.type === 'directory') return 'DIR'
  if (entry.payloadKind === 'none') return 'NO-DATA'
  return entry.payloadKind!.toUpperCase()
}

function entryRatio(entry: PakEntry): string {
  if (
    entry.type === 'directory' ||
    entry.payloadKind === 'none' ||
    (entry.packedSize === 0 && entry.unpackedSize === 0)
  )
    return '-'
  return ratio(entry.packedSize, entry.unpackedSize)
}

export function listArchive(filename: string, options: ListOptions): void {
  const archive = parsePak(readPak(filename))
  const entries = flattenPakEntries(archive.entries)
  if (!options.long) {
    for (const entry of entries)
      console.log(entry.type === 'directory' ? `${entry.path}/` : entry.path)
    return
  }
  console.log('INDEX  MODE     PACKED  ORIGINAL  RATIO    NAME')
  for (const entry of entries)
    console.log(
      `${String(entry.index).padEnd(7)}${entryMode(entry).padEnd(9)}${String(entry.packedSize).padEnd(8)}${String(entry.unpackedSize).padEnd(10)}${entryRatio(entry).padEnd(9)}${entry.type === 'directory' ? `${entry.path}/` : entry.path}`,
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
      `#${entry.index} type=${entry.type} payload=${entry.type === 'directory' ? 'directory' : entry.payloadKind} field00=${hex(entry.field00)} field10=${hex(entry.field10)} offset=${entry.dataOffset} packed=${entry.packedSize} unpacked=${entry.unpackedSize} gap=${entry.dataOffset - previousEnd} path=${JSON.stringify(entry.path)} nameRaw=${entry.nameRaw.toString('hex')} dataHead=${entry.packedData.subarray(0, 16).toString('hex')}`,
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
  console.log(
    `Original files: ${original.files.filter((entry) => entry.payloadKind !== 'none').length}`,
  )
  console.log(`Original verify: ${success('PASS')}`)
  console.log(`Repack: ${success('PASS')}`)
  console.log(`Repacked verify: ${success('PASS')}`)
  console.log(
    `Roundtrip: ${result.matchedFiles}/${result.totalFiles} ${result.logicalMatch ? success('MATCH') : failure('MISMATCH')}`,
  )
  if (!result.logicalMatch) process.exitCode = 1
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(8, '0')}`
}

function printRemaining(total: number): void {
  if (total > VERBOSE_DIFFERENCE_LIMIT)
    console.log(`... ${total - VERBOSE_DIFFERENCE_LIMIT} more differences`)
}

function printVerboseComparison(result: ReturnType<typeof comparePaks>): void {
  if (result.details.entryOrder.length > 0) {
    console.log('\n[entry-order]')
    for (const difference of result.details.entryOrder.slice(
      0,
      VERBOSE_DIFFERENCE_LIMIT,
    )) {
      console.log(`index ${difference.index}`)
      console.log(`original: ${difference.original?.path ?? '<missing>'}`)
      console.log(`rebuilt : ${difference.generated?.path ?? '<missing>'}`)
    }
    printRemaining(result.details.entryOrder.length)
  }
  if (result.details.metadata.length > 0) {
    console.log('\n[metadata]')
    for (const difference of result.details.metadata.slice(
      0,
      VERBOSE_DIFFERENCE_LIMIT,
    )) {
      console.log(difference.path)
      for (const field of ['field00', 'field10'] as const) {
        const values = difference[field]
        if (!values) continue
        console.log(`  ${field}:`)
        console.log(`    original: ${hex(values.original)}`)
        console.log(`    rebuilt : ${hex(values.generated)}`)
      }
    }
    printRemaining(result.details.metadata.length)
  }
  if (result.details.sizes.length > 0) {
    console.log('\n[size]')
    for (const difference of result.details.sizes.slice(
      0,
      VERBOSE_DIFFERENCE_LIMIT,
    )) {
      console.log(difference.path)
      for (const field of ['packedSize', 'unpackedSize'] as const) {
        const values = difference[field]
        if (values.original === values.generated)
          console.log(`  ${field}: same (${values.original})`)
        else {
          console.log(`  ${field}:`)
          console.log(`    original: ${values.original}`)
          console.log(`    rebuilt : ${values.generated}`)
        }
      }
    }
    printRemaining(result.details.sizes.length)
  }
  if (result.details.offsets.length > 0) {
    console.log('\n[offset]')
    for (const difference of result.details.offsets.slice(
      0,
      VERBOSE_DIFFERENCE_LIMIT,
    )) {
      console.log(difference.path)
      console.log(`  original: ${hex(difference.original)}`)
      console.log(`  rebuilt : ${hex(difference.generated)}`)
    }
    printRemaining(result.details.offsets.length)
  }
}

export function compareArchives(
  original: string,
  generated: string,
  options: CompareOptions = {},
): void {
  const result = comparePaks(readPak(original), readPak(generated))
  console.log(
    `Logical match: ${result.logicalMatch ? success('YES') : failure('NO')}`,
  )
  console.log(
    `Structural match: ${result.structuralMatch ? success('YES') : warning('NO')}`,
  )
  console.log(
    `Binary identical: ${result.binaryIdentical ? success('YES') : warning('NO')}`,
  )
  console.log(
    `Files matched: ${result.matchedFiles === result.totalFiles ? success(`${result.matchedFiles}/${result.totalFiles}`) : failure(`${result.matchedFiles}/${result.totalFiles}`)}`,
  )
  if (result.totalZeroPayloadEntries > 0)
    console.log(
      `Zero-payload entries matched: ${result.matchedZeroPayloadEntries === result.totalZeroPayloadEntries ? success(`${result.matchedZeroPayloadEntries}/${result.totalZeroPayloadEntries}`) : failure(`${result.matchedZeroPayloadEntries}/${result.totalZeroPayloadEntries}`)}`,
    )
  if (result.differences.length > 0)
    console.warn(
      `${warning('Differences:')} ${warning(result.differences.join(', '))}`,
    )
  if (options.verbose) printVerboseComparison(result)
  if (!result.logicalMatch) process.exitCode = 1
}
