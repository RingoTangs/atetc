import type { PakArchive, PakEntry, PakPayloadKind } from './pak'
import { ENTRY_SIZE, FILENAME_OFFSET, HEADER_SIZE } from './constants'
import { detectLzssProfile } from './lzss'
import {
  compareFallbackPakNames,
  flattenPakEntries,
  readPakEntryData,
} from './pak'

export type PakArchiveKind = 'etc' | 'library' | 'other' | 'unknown'
export type Field10Class = 'zero' | 'timestampLike' | 'nonTimestampLike'

export interface CountRatio {
  count: number
  percentage: number
}

export interface Field10Counts {
  zero: number
  timestampLike: number
  nonTimestampLike: number
}

export interface PakAnalysisOptions {
  archive?: string
  anomalyLimit?: number
}

export interface PakAnalysis {
  schemaVersion: 1
  archive: string | null
  archiveKind: PakArchiveKind
  header: {
    fileSize: number
    magic: number
    magicHex: string
    headerSize: number
    indexSize: number
    field08: number
    field0c: number
    rootEntryCount: number
    totalEntryCount: number
    fileCount: number
    directoryCount: number
    dataStart: number
  }
  entryStats: {
    total: number
    files: number
    directories: number
    maximumDepth: number
    depthCounts: Array<{ depth: number; count: number }>
  }
  field00Stats: Field00Analysis[]
  field10Stats: Field10Analysis
  payloadStats: {
    totalFiles: number
    lzss: CountRatio
    stored: CountRatio
    none: CountRatio
  }
  lzssProfiles: {
    total: number
    asktao17: CountRatio
    okumura18: CountRatio
    unknown: CountRatio
    mixedKnownProfiles: boolean
  }
  orderingStats: OrderingAnalysis
  layoutStats: LayoutAnalysis
  directoryStats: DirectoryAnalysis
  filenameStats: FilenameAnalysis
  zeroPayloadEntries: ZeroPayloadAnalysis[]
}

export interface Field00Analysis {
  value: number
  hex: string
  count: number
  files: number
  directories: number
  storedCount: number
  payloadKinds: Record<'lzss' | 'stored' | 'none' | 'directory', number>
}

export interface Field10Analysis {
  timestampRange: {
    minimum: number
    maximum: number
    minimumIso: string
    maximumIso: string
  }
  counts: Field10Counts & {
    total: number
    nonzero: number
    timestampLikePercentageOfAll: number
    timestampLikePercentageOfNonzero: number
  }
  distinctCount: number
  distinctValues: number[]
  minimumNonzero: number | null
  maximumNonzero: number | null
  earliestTimestampLike: TimestampValue | null
  latestTimestampLike: TimestampValue | null
  yearCounts: Array<{ year: number; count: number }>
  byEntryType: Record<'file' | 'directory', Field10Counts>
  byPayloadKind: Record<'lzss' | 'stored' | 'none' | 'directory', Field10Counts>
  nonTimestampLikeExamples: Array<{
    archive?: string
    path: string
    value: number
    hex: string
  }>
}

export interface TimestampValue {
  value: number
  iso: string
}

export interface OrderingAnalysis {
  blockCount: number
  matchingBlocks: number
  nonmatchingBlocks: number
  matchingPercentage: number
  examples: Array<{
    archive?: string
    directoryPath: string
    actualFirstNames: string[]
    fallbackFirstNames: string[]
  }>
}

export interface LayoutAnalysis {
  nonzeroRegionCount: number
  continuousRegionCount: number
  positiveGapCount: number
  overlapCount: number
  totalPaddingBytes: number
  trailingBytes: number
  gapDistribution: Array<{ bytes: number; count: number }>
  offsetAlignments: Array<{
    alignment: number
    alignedEntries: number
    totalEntries: number
    percentage: number
  }>
  directoryFileTransitions: number
  paddingExamples: Array<{
    archive?: string
    path: string
    offset: number
    bytes: number
  }>
}

export interface DirectoryAnalysis {
  count: number
  maximumDepth: number
  depthCounts: Array<{ depth: number; count: number }>
  childCountMinimum: number | null
  childCountMaximum: number | null
  childCountAverage: number
  childCountDistribution: Array<{ childCount: number; count: number }>
  equalPackedUnpackedCount: number
  childSizeInvariantCount: number
  firstChildOffsetMatchCount: number
  sequentialChildEntriesCount: number
}

export interface FilenameAnalysis {
  fieldWidthCounts: Array<{ bytes: number; count: number }>
  maximumByteLength: number
  maximumCharacterLength: number
  longestByteNames: Array<{ path: string; name: string; bytes: number }>
  longestCharacterNames: Array<{
    path: string
    name: string
    characters: number
  }>
  nonAsciiCount: number
  multibyteCount: number
  missingNulTerminatorCount: number
  nonzeroPaddingCount: number
  nonzeroPaddingExamples: Array<{
    archive?: string
    path: string
    filenameFieldHex: string
  }>
}

export interface ZeroPayloadAnalysis {
  path: string
  field00: number
  field00Hex: string
  dataOffset: number
  packedSize: number
  unpackedSize: number
  field10: number
  field10Hex: string
}

export interface PakAnalysisSummary {
  schemaVersion: 1
  archiveCount: number
  archives: string[]
  totals: { entries: number; files: number; directories: number }
  headerFields: {
    field08: Array<{ value: number; archives: string[] }>
    field0c: Array<{ value: number; archives: string[] }>
  }
  field00Stats: Field00Analysis[]
  field10Stats: Field10Analysis & {
    byArchiveKind: Record<PakArchiveKind, Field10Counts>
  }
  payloadStats: PakAnalysis['payloadStats']
  lzssProfiles: PakAnalysis['lzssProfiles'] & {
    mixedProfileArchives: string[]
    archivesByProfile: {
      asktao17: string[]
      okumura18: string[]
      unknown: string[]
    }
  }
  orderingStats: OrderingAnalysis
  layoutStats: LayoutAnalysis
  directoryStats: DirectoryAnalysis
  filenameStats: FilenameAnalysis
  zeroPayloadEntries: Array<ZeroPayloadAnalysis & { archive: string }>
}

const TIMESTAMP_MINIMUM = Date.UTC(2000, 0, 1) / 1000
const TIMESTAMP_MAXIMUM = Date.UTC(2035, 11, 31, 23, 59, 59) / 1000
const ALIGNMENTS = [2, 4, 8, 16, 32, 64, 512, 4096] as const
const DEFAULT_ANOMALY_LIMIT = 10
const NAME_PREVIEW_LIMIT = 8

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : Number(((count / total) * 100).toFixed(2))
}

function countRatio(count: number, total: number): CountRatio {
  return { count, percentage: percentage(count, total) }
}

function hex32(value: number): string {
  return `0x${value.toString(16).padStart(8, '0')}`
}

function emptyField10Counts(): Field10Counts {
  return { zero: 0, timestampLike: 0, nonTimestampLike: 0 }
}

function classifyField10(value: number): Field10Class {
  if (value === 0) return 'zero'
  if (value >= TIMESTAMP_MINIMUM && value <= TIMESTAMP_MAXIMUM)
    return 'timestampLike'
  return 'nonTimestampLike'
}

function archiveKind(label: string | undefined): PakArchiveKind {
  if (!label) return 'unknown'
  const filename = label.split(/[\\/]/).at(-1)!.toLowerCase()
  if (filename === 'etc.pak') return 'etc'
  if (/^lib_.*32\.pak$/.test(filename)) return 'library'
  return 'other'
}

function increment(map: Map<number, number>, value: number): void {
  map.set(value, (map.get(value) ?? 0) + 1)
}

function numberCounts(
  map: ReadonlyMap<number, number>,
  key: string,
): Array<Record<string, number>> {
  return [...map]
    .sort(([left], [right]) => left - right)
    .map(([value, count]) => ({
      [key]: value,
      count,
    }))
}

function field10Analysis(
  entries: readonly PakEntry[],
  anomalyLimit: number,
): Field10Analysis {
  const counts = emptyField10Counts()
  const distinct = new Set<number>()
  const years = new Map<number, number>()
  const byEntryType = {
    file: emptyField10Counts(),
    directory: emptyField10Counts(),
  }
  const byPayloadKind = {
    lzss: emptyField10Counts(),
    stored: emptyField10Counts(),
    none: emptyField10Counts(),
    directory: emptyField10Counts(),
  }
  const examples: Field10Analysis['nonTimestampLikeExamples'] = []
  let minimumNonzero: number | null = null
  let maximumNonzero: number | null = null
  let earliest: number | null = null
  let latest: number | null = null
  for (const entry of entries) {
    const classification = classifyField10(entry.field10)
    counts[classification]++
    distinct.add(entry.field10)
    byEntryType[entry.type][classification]++
    const payloadKind =
      entry.type === 'directory' ? 'directory' : entry.payloadKind!
    byPayloadKind[payloadKind][classification]++
    if (entry.field10 !== 0) {
      minimumNonzero =
        minimumNonzero === null
          ? entry.field10
          : Math.min(minimumNonzero, entry.field10)
      maximumNonzero =
        maximumNonzero === null
          ? entry.field10
          : Math.max(maximumNonzero, entry.field10)
    }
    if (classification === 'timestampLike') {
      earliest =
        earliest === null ? entry.field10 : Math.min(earliest, entry.field10)
      latest = latest === null ? entry.field10 : Math.max(latest, entry.field10)
      increment(years, new Date(entry.field10 * 1000).getUTCFullYear())
    } else if (
      classification === 'nonTimestampLike' &&
      examples.length < anomalyLimit
    )
      examples.push({
        path: entry.path,
        value: entry.field10,
        hex: hex32(entry.field10),
      })
  }
  const nonzero = counts.timestampLike + counts.nonTimestampLike
  return {
    timestampRange: {
      minimum: TIMESTAMP_MINIMUM,
      maximum: TIMESTAMP_MAXIMUM,
      minimumIso: new Date(TIMESTAMP_MINIMUM * 1000).toISOString(),
      maximumIso: new Date(TIMESTAMP_MAXIMUM * 1000).toISOString(),
    },
    counts: {
      ...counts,
      total: entries.length,
      nonzero,
      timestampLikePercentageOfAll: percentage(
        counts.timestampLike,
        entries.length,
      ),
      timestampLikePercentageOfNonzero: percentage(
        counts.timestampLike,
        nonzero,
      ),
    },
    distinctCount: distinct.size,
    distinctValues: [...distinct].sort((left, right) => left - right),
    minimumNonzero,
    maximumNonzero,
    earliestTimestampLike:
      earliest === null
        ? null
        : { value: earliest, iso: new Date(earliest * 1000).toISOString() },
    latestTimestampLike:
      latest === null
        ? null
        : { value: latest, iso: new Date(latest * 1000).toISOString() },
    yearCounts: numberCounts(years, 'year') as Array<{
      year: number
      count: number
    }>,
    byEntryType,
    byPayloadKind,
    nonTimestampLikeExamples: examples,
  }
}

function analyzeOrdering(
  entries: readonly PakEntry[],
  anomalyLimit: number,
): OrderingAnalysis {
  let blockCount = 0
  let matchingBlocks = 0
  const examples: OrderingAnalysis['examples'] = []
  const visit = (items: readonly PakEntry[], directoryPath: string): void => {
    blockCount++
    const actual = items.map((entry) => entry.name)
    const fallback = [...actual].sort(compareFallbackPakNames)
    const matches = actual.every((name, index) => name === fallback[index])
    if (matches) matchingBlocks++
    else if (examples.length < anomalyLimit)
      examples.push({
        directoryPath,
        actualFirstNames: actual.slice(0, NAME_PREVIEW_LIMIT),
        fallbackFirstNames: fallback.slice(0, NAME_PREVIEW_LIMIT),
      })
    for (const entry of items)
      if (entry.type === 'directory') visit(entry.children!, entry.path)
  }
  visit(entries, '<root>')
  return {
    blockCount,
    matchingBlocks,
    nonmatchingBlocks: blockCount - matchingBlocks,
    matchingPercentage: percentage(matchingBlocks, blockCount),
    examples,
  }
}

function analyzeLayout(
  archive: PakArchive,
  entries: readonly PakEntry[],
  anomalyLimit: number,
): LayoutAnalysis {
  const regions = entries
    .filter((entry) => entry.packedSize > 0)
    .map((entry) => ({
      entry,
      start: entry.dataOffset,
      end: entry.dataOffset + entry.packedSize,
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const gaps = new Map<number, number>()
  const paddingExamples: LayoutAnalysis['paddingExamples'] = []
  let cursor = archive.dataStart
  let continuousRegionCount = 0
  let positiveGapCount = 0
  let overlapCount = 0
  let totalPaddingBytes = 0
  let transitions = 0
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index]!
    const difference = region.start - cursor
    if (difference === 0) {
      continuousRegionCount++
      increment(gaps, 0)
    } else if (difference > 0) {
      positiveGapCount++
      totalPaddingBytes += difference
      increment(gaps, difference)
      if (paddingExamples.length < anomalyLimit)
        paddingExamples.push({
          path: region.entry.path,
          offset: region.start,
          bytes: difference,
        })
    } else overlapCount++
    if (index > 0 && regions[index - 1]!.entry.type !== region.entry.type)
      transitions++
    cursor = Math.max(cursor, region.end)
  }
  return {
    nonzeroRegionCount: regions.length,
    continuousRegionCount,
    positiveGapCount,
    overlapCount,
    totalPaddingBytes,
    trailingBytes: archive.size - cursor,
    gapDistribution: numberCounts(gaps, 'bytes') as Array<{
      bytes: number
      count: number
    }>,
    offsetAlignments: ALIGNMENTS.map((alignment) => {
      const alignedEntries = entries.filter(
        (entry) => entry.dataOffset % alignment === 0,
      ).length
      return {
        alignment,
        alignedEntries,
        totalEntries: entries.length,
        percentage: percentage(alignedEntries, entries.length),
      }
    }),
    directoryFileTransitions: transitions,
    paddingExamples,
  }
}

function analyzeDirectories(
  directories: readonly PakEntry[],
): DirectoryAnalysis {
  const depths = new Map<number, number>()
  const childCounts = new Map<number, number>()
  let equalPackedUnpackedCount = 0
  let childSizeInvariantCount = 0
  let firstChildOffsetMatchCount = 0
  let sequentialChildEntriesCount = 0
  let childTotal = 0
  for (const directory of directories) {
    const children = directory.children!
    increment(depths, directory.depth)
    increment(childCounts, children.length)
    childTotal += children.length
    if (directory.packedSize === directory.unpackedSize)
      equalPackedUnpackedCount++
    if (directory.packedSize === children.length * ENTRY_SIZE)
      childSizeInvariantCount++
    if (
      children.length === 0 ||
      children[0]!.entryOffset === directory.dataOffset
    )
      firstChildOffsetMatchCount++
    if (
      children.every(
        (entry, index) =>
          entry.entryOffset === directory.dataOffset + index * ENTRY_SIZE,
      )
    )
      sequentialChildEntriesCount++
  }
  const childValues = directories.map((directory) => directory.children!.length)
  return {
    count: directories.length,
    maximumDepth: Math.max(0, ...directories.map((entry) => entry.depth)),
    depthCounts: numberCounts(depths, 'depth') as Array<{
      depth: number
      count: number
    }>,
    childCountMinimum:
      childValues.length === 0 ? null : Math.min(...childValues),
    childCountMaximum:
      childValues.length === 0 ? null : Math.max(...childValues),
    childCountAverage:
      directories.length === 0
        ? 0
        : Number((childTotal / directories.length).toFixed(2)),
    childCountDistribution: numberCounts(childCounts, 'childCount') as Array<{
      childCount: number
      count: number
    }>,
    equalPackedUnpackedCount,
    childSizeInvariantCount,
    firstChildOffsetMatchCount,
    sequentialChildEntriesCount,
  }
}

function analyzeFilenames(
  entries: readonly PakEntry[],
  anomalyLimit: number,
): FilenameAnalysis {
  const widths = new Map<number, number>()
  let maximumByteLength = 0
  let maximumCharacterLength = 0
  let nonAsciiCount = 0
  let multibyteCount = 0
  let missingNulTerminatorCount = 0
  let nonzeroPaddingCount = 0
  const byteNames: FilenameAnalysis['longestByteNames'] = []
  const characterNames: FilenameAnalysis['longestCharacterNames'] = []
  const paddingExamples: FilenameAnalysis['nonzeroPaddingExamples'] = []
  for (const entry of entries) {
    const field = entry.raw.subarray(FILENAME_OFFSET)
    const bytes = entry.nameRaw.length
    const characters = Array.from(entry.name).length
    increment(widths, field.length)
    if (bytes > maximumByteLength) {
      maximumByteLength = bytes
      byteNames.length = 0
    }
    if (bytes === maximumByteLength && byteNames.length < anomalyLimit)
      byteNames.push({ path: entry.path, name: entry.name, bytes })
    if (characters > maximumCharacterLength) {
      maximumCharacterLength = characters
      characterNames.length = 0
    }
    if (
      characters === maximumCharacterLength &&
      characterNames.length < anomalyLimit
    )
      characterNames.push({ path: entry.path, name: entry.name, characters })
    if (entry.nameRaw.some((byte) => byte >= 0x80)) nonAsciiCount++
    if (bytes > characters) multibyteCount++
    const nul = field.indexOf(0)
    if (nul < 0) missingNulTerminatorCount++
    else if (field.subarray(nul + 1).some((byte) => byte !== 0)) {
      nonzeroPaddingCount++
      if (paddingExamples.length < anomalyLimit)
        paddingExamples.push({
          path: entry.path,
          filenameFieldHex: field.toString('hex'),
        })
    }
  }
  return {
    fieldWidthCounts: numberCounts(widths, 'bytes') as Array<{
      bytes: number
      count: number
    }>,
    maximumByteLength,
    maximumCharacterLength,
    longestByteNames: byteNames,
    longestCharacterNames: characterNames,
    nonAsciiCount,
    multibyteCount,
    missingNulTerminatorCount,
    nonzeroPaddingCount,
    nonzeroPaddingExamples: paddingExamples,
  }
}

export function analyzePak(
  archive: PakArchive,
  options: PakAnalysisOptions = {},
): PakAnalysis {
  const anomalyLimit = options.anomalyLimit ?? DEFAULT_ANOMALY_LIMIT
  const entries = flattenPakEntries(archive.entries)
  const field00 = new Map<number, Field00Analysis>()
  const depthCounts = new Map<number, number>()
  const payloadCounts: Record<PakPayloadKind, number> = {
    lzss: 0,
    stored: 0,
    none: 0,
  }
  const profileCounts = { asktao17: 0, okumura18: 0, unknown: 0 }
  const zeroPayloadEntries: ZeroPayloadAnalysis[] = []
  for (const entry of entries) {
    increment(depthCounts, entry.depth)
    let stat = field00.get(entry.field00)
    if (!stat) {
      stat = {
        value: entry.field00,
        hex: hex32(entry.field00),
        count: 0,
        files: 0,
        directories: 0,
        storedCount: 0,
        payloadKinds: { lzss: 0, stored: 0, none: 0, directory: 0 },
      }
      field00.set(entry.field00, stat)
    }
    stat.count++
    stat[entry.type === 'file' ? 'files' : 'directories']++
    if (entry.stored) stat.storedCount++
    if (entry.type === 'directory') stat.payloadKinds.directory++
    else {
      const kind = entry.payloadKind!
      stat.payloadKinds[kind]++
      payloadCounts[kind]++
      if (kind === 'none')
        zeroPayloadEntries.push({
          path: entry.path,
          field00: entry.field00,
          field00Hex: hex32(entry.field00),
          dataOffset: entry.dataOffset,
          packedSize: entry.packedSize,
          unpackedSize: entry.unpackedSize,
          field10: entry.field10,
          field10Hex: hex32(entry.field10),
        })
      if (kind === 'lzss') {
        const data = readPakEntryData(entry)
        const profile = detectLzssProfile(data, entry.packedData)
        if (profile === 'asktao-17') profileCounts.asktao17++
        else if (profile === 'okumura-18') profileCounts.okumura18++
        else profileCounts.unknown++
      }
    }
  }
  const lzssTotal = payloadCounts.lzss
  return {
    schemaVersion: 1,
    archive: options.archive ?? null,
    archiveKind: archiveKind(options.archive),
    header: {
      fileSize: archive.size,
      magic: archive.header.magic,
      magicHex: hex32(archive.header.magic),
      headerSize: HEADER_SIZE,
      indexSize: archive.header.indexSize,
      field08: archive.header.field08,
      field0c: archive.header.field0c,
      rootEntryCount: archive.entries.length,
      totalEntryCount: archive.entryCount,
      fileCount: archive.files.length,
      directoryCount: archive.directories.length,
      dataStart: archive.dataStart,
    },
    entryStats: {
      total: entries.length,
      files: archive.files.length,
      directories: archive.directories.length,
      maximumDepth: Math.max(0, ...entries.map((entry) => entry.depth)),
      depthCounts: numberCounts(depthCounts, 'depth') as Array<{
        depth: number
        count: number
      }>,
    },
    field00Stats: [...field00.values()].sort(
      (left, right) => left.value - right.value,
    ),
    field10Stats: field10Analysis(entries, anomalyLimit),
    payloadStats: {
      totalFiles: archive.files.length,
      lzss: countRatio(payloadCounts.lzss, archive.files.length),
      stored: countRatio(payloadCounts.stored, archive.files.length),
      none: countRatio(payloadCounts.none, archive.files.length),
    },
    lzssProfiles: {
      total: lzssTotal,
      asktao17: countRatio(profileCounts.asktao17, lzssTotal),
      okumura18: countRatio(profileCounts.okumura18, lzssTotal),
      unknown: countRatio(profileCounts.unknown, lzssTotal),
      mixedKnownProfiles:
        profileCounts.asktao17 > 0 && profileCounts.okumura18 > 0,
    },
    orderingStats: analyzeOrdering(archive.entries, anomalyLimit),
    layoutStats: analyzeLayout(archive, entries, anomalyLimit),
    directoryStats: analyzeDirectories(archive.directories),
    filenameStats: analyzeFilenames(entries, anomalyLimit),
    zeroPayloadEntries,
  }
}

function mergeField10Counts(
  target: Field10Counts,
  source: Field10Counts,
): void {
  target.zero += source.zero
  target.timestampLike += source.timestampLike
  target.nonTimestampLike += source.nonTimestampLike
}

function mergeDistribution(
  target: Map<number, number>,
  source: ReadonlyArray<Record<string, number>>,
  key: string,
): void {
  for (const item of source)
    target.set(item[key]!, (target.get(item[key]!) ?? 0) + item.count!)
}

export function summarizePakAnalyses(
  analyses: readonly PakAnalysis[],
): PakAnalysisSummary {
  const archiveLabel = (analysis: PakAnalysis): string =>
    analysis.archive ?? '<unknown>'
  const fieldValues = (
    key: 'field08' | 'field0c',
  ): Array<{ value: number; archives: string[] }> => {
    const values = new Map<number, string[]>()
    for (const analysis of analyses) {
      const value = analysis.header[key]
      const archives = values.get(value) ?? []
      archives.push(archiveLabel(analysis))
      values.set(value, archives)
    }
    return [...values]
      .sort(([left], [right]) => left - right)
      .map(([value, archives]) => ({ value, archives }))
  }
  const field00 = new Map<number, Field00Analysis>()
  const years = new Map<number, number>()
  const distinctField10 = new Set<number>()
  const field10Counts = emptyField10Counts()
  const byEntryType = {
    file: emptyField10Counts(),
    directory: emptyField10Counts(),
  }
  const byPayloadKind = {
    lzss: emptyField10Counts(),
    stored: emptyField10Counts(),
    none: emptyField10Counts(),
    directory: emptyField10Counts(),
  }
  const byArchiveKind: Record<PakArchiveKind, Field10Counts> = {
    etc: emptyField10Counts(),
    library: emptyField10Counts(),
    other: emptyField10Counts(),
    unknown: emptyField10Counts(),
  }
  const anomalies: Field10Analysis['nonTimestampLikeExamples'] = []
  let minimumNonzero: number | null = null
  let maximumNonzero: number | null = null
  let earliest: TimestampValue | null = null
  let latest: TimestampValue | null = null
  let totalEntries = 0
  let totalFiles = 0
  let totalDirectories = 0
  let lzss = 0
  let stored = 0
  let none = 0
  let asktao17 = 0
  let okumura18 = 0
  let unknownProfiles = 0
  let orderingBlocks = 0
  let orderingMatches = 0
  const orderingExamples: OrderingAnalysis['examples'] = []
  let regionCount = 0
  let continuousRegions = 0
  let positiveGaps = 0
  let overlaps = 0
  let paddingBytes = 0
  let trailingBytes = 0
  let transitions = 0
  const gaps = new Map<number, number>()
  const paddingExamples: LayoutAnalysis['paddingExamples'] = []
  const aligned = new Map<number, number>()
  let directoryCount = 0
  let directoryMaxDepth = 0
  const directoryDepths = new Map<number, number>()
  const childCounts = new Map<number, number>()
  let childTotal = 0
  let equalSizes = 0
  let sizeInvariants = 0
  let firstOffsets = 0
  let sequentialEntries = 0
  const filenameWidths = new Map<number, number>()
  let maxFilenameBytes = 0
  let maxFilenameCharacters = 0
  let nonAscii = 0
  let multibyte = 0
  let missingNul = 0
  let nonzeroPadding = 0
  const longestBytes: FilenameAnalysis['longestByteNames'] = []
  const longestCharacters: FilenameAnalysis['longestCharacterNames'] = []
  const filenamePaddingExamples: FilenameAnalysis['nonzeroPaddingExamples'] = []
  const zeroPayloadEntries: PakAnalysisSummary['zeroPayloadEntries'] = []
  const profilesByArchive = {
    asktao17: [] as string[],
    okumura18: [] as string[],
    unknown: [] as string[],
  }
  const mixedProfileArchives: string[] = []
  for (const analysis of analyses) {
    const label = archiveLabel(analysis)
    totalEntries += analysis.entryStats.total
    totalFiles += analysis.entryStats.files
    totalDirectories += analysis.entryStats.directories
    for (const item of analysis.field00Stats) {
      let target = field00.get(item.value)
      if (!target) {
        target = {
          value: item.value,
          hex: item.hex,
          count: 0,
          files: 0,
          directories: 0,
          storedCount: 0,
          payloadKinds: { lzss: 0, stored: 0, none: 0, directory: 0 },
        }
        field00.set(item.value, target)
      }
      target.count += item.count
      target.files += item.files
      target.directories += item.directories
      target.storedCount += item.storedCount
      for (const kind of ['lzss', 'stored', 'none', 'directory'] as const)
        target.payloadKinds[kind] += item.payloadKinds[kind]
    }
    const f10 = analysis.field10Stats
    for (const value of f10.distinctValues) distinctField10.add(value)
    mergeField10Counts(field10Counts, f10.counts)
    mergeField10Counts(byEntryType.file, f10.byEntryType.file)
    mergeField10Counts(byEntryType.directory, f10.byEntryType.directory)
    for (const kind of ['lzss', 'stored', 'none', 'directory'] as const)
      mergeField10Counts(byPayloadKind[kind], f10.byPayloadKind[kind])
    mergeField10Counts(byArchiveKind[analysis.archiveKind], f10.counts)
    for (const item of f10.yearCounts)
      years.set(item.year, (years.get(item.year) ?? 0) + item.count)
    if (f10.minimumNonzero !== null)
      minimumNonzero =
        minimumNonzero === null
          ? f10.minimumNonzero
          : Math.min(minimumNonzero, f10.minimumNonzero)
    if (f10.maximumNonzero !== null)
      maximumNonzero =
        maximumNonzero === null
          ? f10.maximumNonzero
          : Math.max(maximumNonzero, f10.maximumNonzero)
    if (
      f10.earliestTimestampLike &&
      (!earliest || f10.earliestTimestampLike.value < earliest.value)
    )
      earliest = f10.earliestTimestampLike
    if (
      f10.latestTimestampLike &&
      (!latest || f10.latestTimestampLike.value > latest.value)
    )
      latest = f10.latestTimestampLike
    anomalies.push(
      ...f10.nonTimestampLikeExamples
        .slice(0, DEFAULT_ANOMALY_LIMIT - anomalies.length)
        .map((example) => ({ ...example, archive: label })),
    )
    lzss += analysis.payloadStats.lzss.count
    stored += analysis.payloadStats.stored.count
    none += analysis.payloadStats.none.count
    asktao17 += analysis.lzssProfiles.asktao17.count
    okumura18 += analysis.lzssProfiles.okumura18.count
    unknownProfiles += analysis.lzssProfiles.unknown.count
    if (analysis.lzssProfiles.asktao17.count > 0)
      profilesByArchive.asktao17.push(label)
    if (analysis.lzssProfiles.okumura18.count > 0)
      profilesByArchive.okumura18.push(label)
    if (analysis.lzssProfiles.unknown.count > 0)
      profilesByArchive.unknown.push(label)
    if (analysis.lzssProfiles.mixedKnownProfiles)
      mixedProfileArchives.push(label)
    orderingBlocks += analysis.orderingStats.blockCount
    orderingMatches += analysis.orderingStats.matchingBlocks
    orderingExamples.push(
      ...analysis.orderingStats.examples
        .slice(0, DEFAULT_ANOMALY_LIMIT - orderingExamples.length)
        .map((example) => ({
          ...example,
          archive: label,
        })),
    )
    const layout = analysis.layoutStats
    regionCount += layout.nonzeroRegionCount
    continuousRegions += layout.continuousRegionCount
    positiveGaps += layout.positiveGapCount
    overlaps += layout.overlapCount
    paddingBytes += layout.totalPaddingBytes
    trailingBytes += layout.trailingBytes
    transitions += layout.directoryFileTransitions
    mergeDistribution(gaps, layout.gapDistribution, 'bytes')
    paddingExamples.push(
      ...layout.paddingExamples
        .slice(0, DEFAULT_ANOMALY_LIMIT - paddingExamples.length)
        .map((example) => ({ ...example, archive: label })),
    )
    for (const item of layout.offsetAlignments)
      aligned.set(
        item.alignment,
        (aligned.get(item.alignment) ?? 0) + item.alignedEntries,
      )
    const directories = analysis.directoryStats
    directoryCount += directories.count
    directoryMaxDepth = Math.max(directoryMaxDepth, directories.maximumDepth)
    mergeDistribution(directoryDepths, directories.depthCounts, 'depth')
    mergeDistribution(
      childCounts,
      directories.childCountDistribution,
      'childCount',
    )
    childTotal += directories.childCountDistribution.reduce(
      (sum, item) => sum + item.childCount * item.count,
      0,
    )
    equalSizes += directories.equalPackedUnpackedCount
    sizeInvariants += directories.childSizeInvariantCount
    firstOffsets += directories.firstChildOffsetMatchCount
    sequentialEntries += directories.sequentialChildEntriesCount
    const filenames = analysis.filenameStats
    mergeDistribution(filenameWidths, filenames.fieldWidthCounts, 'bytes')
    if (filenames.maximumByteLength > maxFilenameBytes) {
      maxFilenameBytes = filenames.maximumByteLength
      longestBytes.length = 0
    }
    if (filenames.maximumByteLength === maxFilenameBytes)
      longestBytes.push(
        ...filenames.longestByteNames.slice(
          0,
          DEFAULT_ANOMALY_LIMIT - longestBytes.length,
        ),
      )
    if (filenames.maximumCharacterLength > maxFilenameCharacters) {
      maxFilenameCharacters = filenames.maximumCharacterLength
      longestCharacters.length = 0
    }
    if (filenames.maximumCharacterLength === maxFilenameCharacters)
      longestCharacters.push(
        ...filenames.longestCharacterNames.slice(
          0,
          DEFAULT_ANOMALY_LIMIT - longestCharacters.length,
        ),
      )
    nonAscii += filenames.nonAsciiCount
    multibyte += filenames.multibyteCount
    missingNul += filenames.missingNulTerminatorCount
    nonzeroPadding += filenames.nonzeroPaddingCount
    filenamePaddingExamples.push(
      ...filenames.nonzeroPaddingExamples
        .slice(0, DEFAULT_ANOMALY_LIMIT - filenamePaddingExamples.length)
        .map((example) => ({ ...example, archive: label })),
    )
    zeroPayloadEntries.push(
      ...analysis.zeroPayloadEntries.map((entry) => ({
        ...entry,
        archive: label,
      })),
    )
  }
  const nonzero = field10Counts.timestampLike + field10Counts.nonTimestampLike
  const lzssTotal = asktao17 + okumura18 + unknownProfiles
  return {
    schemaVersion: 1,
    archiveCount: analyses.length,
    archives: analyses.map(archiveLabel),
    totals: {
      entries: totalEntries,
      files: totalFiles,
      directories: totalDirectories,
    },
    headerFields: {
      field08: fieldValues('field08'),
      field0c: fieldValues('field0c'),
    },
    field00Stats: [...field00.values()].sort((a, b) => a.value - b.value),
    field10Stats: {
      timestampRange: {
        minimum: TIMESTAMP_MINIMUM,
        maximum: TIMESTAMP_MAXIMUM,
        minimumIso: new Date(TIMESTAMP_MINIMUM * 1000).toISOString(),
        maximumIso: new Date(TIMESTAMP_MAXIMUM * 1000).toISOString(),
      },
      counts: {
        ...field10Counts,
        total: totalEntries,
        nonzero,
        timestampLikePercentageOfAll: percentage(
          field10Counts.timestampLike,
          totalEntries,
        ),
        timestampLikePercentageOfNonzero: percentage(
          field10Counts.timestampLike,
          nonzero,
        ),
      },
      distinctCount: distinctField10.size,
      distinctValues: [...distinctField10].sort((left, right) => left - right),
      minimumNonzero,
      maximumNonzero,
      earliestTimestampLike: earliest,
      latestTimestampLike: latest,
      yearCounts: numberCounts(years, 'year') as Array<{
        year: number
        count: number
      }>,
      byEntryType,
      byPayloadKind,
      nonTimestampLikeExamples: anomalies,
      byArchiveKind,
    },
    payloadStats: {
      totalFiles,
      lzss: countRatio(lzss, totalFiles),
      stored: countRatio(stored, totalFiles),
      none: countRatio(none, totalFiles),
    },
    lzssProfiles: {
      total: lzssTotal,
      asktao17: countRatio(asktao17, lzssTotal),
      okumura18: countRatio(okumura18, lzssTotal),
      unknown: countRatio(unknownProfiles, lzssTotal),
      mixedKnownProfiles: mixedProfileArchives.length > 0,
      mixedProfileArchives,
      archivesByProfile: profilesByArchive,
    },
    orderingStats: {
      blockCount: orderingBlocks,
      matchingBlocks: orderingMatches,
      nonmatchingBlocks: orderingBlocks - orderingMatches,
      matchingPercentage: percentage(orderingMatches, orderingBlocks),
      examples: orderingExamples,
    },
    layoutStats: {
      nonzeroRegionCount: regionCount,
      continuousRegionCount: continuousRegions,
      positiveGapCount: positiveGaps,
      overlapCount: overlaps,
      totalPaddingBytes: paddingBytes,
      trailingBytes,
      gapDistribution: numberCounts(gaps, 'bytes') as Array<{
        bytes: number
        count: number
      }>,
      offsetAlignments: ALIGNMENTS.map((alignment) => ({
        alignment,
        alignedEntries: aligned.get(alignment) ?? 0,
        totalEntries,
        percentage: percentage(aligned.get(alignment) ?? 0, totalEntries),
      })),
      directoryFileTransitions: transitions,
      paddingExamples,
    },
    directoryStats: {
      count: directoryCount,
      maximumDepth: directoryMaxDepth,
      depthCounts: numberCounts(directoryDepths, 'depth') as Array<{
        depth: number
        count: number
      }>,
      childCountMinimum:
        childCounts.size === 0 ? null : Math.min(...childCounts.keys()),
      childCountMaximum:
        childCounts.size === 0 ? null : Math.max(...childCounts.keys()),
      childCountAverage:
        directoryCount === 0
          ? 0
          : Number((childTotal / directoryCount).toFixed(2)),
      childCountDistribution: numberCounts(childCounts, 'childCount') as Array<{
        childCount: number
        count: number
      }>,
      equalPackedUnpackedCount: equalSizes,
      childSizeInvariantCount: sizeInvariants,
      firstChildOffsetMatchCount: firstOffsets,
      sequentialChildEntriesCount: sequentialEntries,
    },
    filenameStats: {
      fieldWidthCounts: numberCounts(filenameWidths, 'bytes') as Array<{
        bytes: number
        count: number
      }>,
      maximumByteLength: maxFilenameBytes,
      maximumCharacterLength: maxFilenameCharacters,
      longestByteNames: longestBytes,
      longestCharacterNames: longestCharacters,
      nonAsciiCount: nonAscii,
      multibyteCount: multibyte,
      missingNulTerminatorCount: missingNul,
      nonzeroPaddingCount: nonzeroPadding,
      nonzeroPaddingExamples: filenamePaddingExamples,
    },
    zeroPayloadEntries,
  }
}
