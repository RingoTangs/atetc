import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENTRY_SIZE, HEADER_SIZE, PAK_MAGIC } from './constants'
import { parsePak } from './pak'
import { analyzePak, summarizePakAnalyses } from './pak-analysis'

const REAL_SAMPLE_ROOT = path.resolve(import.meta.dirname, '../sample/real-etc')
const REAL_ANALYSIS_TEST_TIMEOUT = 180_000
const REAL_SAMPLES = [
  'aaa/etc.pak',
  'aaa/lib_aaa32.pak',
  'ccs/etc.pak',
  'ccs/lib_ccs32.pak',
  'csa/etc.pak',
  'csa/lib_csa32.pak',
  'dba/etc.pak',
  'dba/lib_dba32.pak',
  'gs/etc.pak',
  'gs/lib_gs32.pak',
  'gs/server_animates.pak',
  'gs/server_maps.pak',
] as const

describe('real production PAK analysis', () => {
  it(
    'analyzes and summarizes every real sample without inferring new format semantics',
    () => {
      const analyses = REAL_SAMPLES.map((relativePath) => {
        const archive = parsePak(
          fs.readFileSync(path.join(REAL_SAMPLE_ROOT, relativePath)),
        )
        expect(archive.header.magic, relativePath).toBe(PAK_MAGIC)
        expect(archive.dataStart, relativePath).toBe(
          HEADER_SIZE + archive.header.indexSize,
        )
        expect(archive.header.indexSize, relativePath).toBe(
          archive.entries.length * ENTRY_SIZE,
        )
        return analyzePak(archive, { archive: relativePath })
      })
      const summary = summarizePakAnalyses(analyses)

      expect(summary.archiveCount).toBe(12)
      expect(summary.totals).toEqual({
        entries: 9_527,
        files: 8_922,
        directories: 605,
      })
      expect(summary.headerFields).toEqual({
        field08: [{ value: 0, archives: [...REAL_SAMPLES] }],
        field0c: [{ value: 0, archives: [...REAL_SAMPLES] }],
      })
      expect(
        summary.field00Stats.map((item) => ({
          hex: item.hex,
          count: item.count,
          files: item.files,
          directories: item.directories,
          stored: item.storedCount,
          payloadKinds: item.payloadKinds,
        })),
      ).toEqual([
        {
          hex: '0x00000000',
          count: 8_919,
          files: 8_919,
          directories: 0,
          stored: 0,
          payloadKinds: {
            lzss: 8_918,
            stored: 0,
            none: 1,
            directory: 0,
          },
        },
        {
          hex: '0x00000001',
          count: 605,
          files: 0,
          directories: 605,
          stored: 0,
          payloadKinds: {
            lzss: 0,
            stored: 0,
            none: 0,
            directory: 605,
          },
        },
        {
          hex: '0x80000000',
          count: 3,
          files: 3,
          directories: 0,
          stored: 3,
          payloadKinds: {
            lzss: 0,
            stored: 3,
            none: 0,
            directory: 0,
          },
        },
      ])

      expect(summary.field10Stats.counts).toMatchObject({
        total: 9_527,
        zero: 8_357,
        nonzero: 1_170,
        timestampLike: 1_170,
        nonTimestampLike: 0,
        timestampLikePercentageOfAll: 12.28,
        timestampLikePercentageOfNonzero: 100,
      })
      expect(summary.field10Stats.distinctCount).toBe(29)
      expect(summary.field10Stats.earliestTimestampLike?.iso).toBe(
        '2013-08-30T12:47:17.000Z',
      )
      expect(summary.field10Stats.latestTimestampLike?.iso).toBe(
        '2017-12-23T10:34:00.000Z',
      )
      expect(summary.field10Stats.yearCounts).toEqual([
        { year: 2013, count: 32 },
        { year: 2016, count: 167 },
        { year: 2017, count: 971 },
      ])
      expect(summary.field10Stats.nonTimestampLikeExamples).toEqual([])

      expect(summary.payloadStats).toMatchObject({
        totalFiles: 8_922,
        lzss: { count: 8_918 },
        stored: { count: 3 },
        none: { count: 1 },
      })
      expect(summary.lzssProfiles).toMatchObject({
        total: 8_918,
        asktao17: { count: 8_911 },
        okumura18: { count: 7 },
        unknown: { count: 0 },
        mixedProfileArchives: [
          'aaa/lib_aaa32.pak',
          'ccs/lib_ccs32.pak',
          'csa/lib_csa32.pak',
          'dba/lib_dba32.pak',
        ],
      })

      expect(summary.orderingStats).toMatchObject({
        blockCount: 617,
        matchingBlocks: 547,
        nonmatchingBlocks: 70,
        matchingPercentage: 88.65,
      })
      expect(summary.layoutStats).toMatchObject({
        nonzeroRegionCount: 9_523,
        continuousRegionCount: 9_523,
        positiveGapCount: 0,
        overlapCount: 0,
        totalPaddingBytes: 0,
        trailingBytes: 0,
        gapDistribution: [{ bytes: 0, count: 9_523 }],
      })
      expect(
        summary.layoutStats.offsetAlignments.every(
          (item) => item.alignedEntries < item.totalEntries,
        ),
      ).toBe(true)

      expect(summary.directoryStats).toMatchObject({
        count: 605,
        maximumDepth: 5,
        equalPackedUnpackedCount: 605,
        childSizeInvariantCount: 605,
        firstChildOffsetMatchCount: 605,
        sequentialChildEntriesCount: 605,
      })
      expect(summary.filenameStats).toMatchObject({
        fieldWidthCounts: [{ bytes: 44, count: 9_527 }],
        maximumByteLength: 40,
        maximumCharacterLength: 40,
        nonAsciiCount: 0,
        multibyteCount: 0,
        missingNulTerminatorCount: 0,
        nonzeroPaddingCount: 0,
      })
      expect(summary.zeroPayloadEntries).toEqual([
        {
          archive: 'dba/etc.pak',
          path: 'etc',
          field00: 0,
          field00Hex: '0x00000000',
          dataOffset: 6_901_897,
          packedSize: 0,
          unpackedSize: 7_829_223,
          field10: 1_508_261_396,
          field10Hex: '0x59e63e14',
        },
      ])
    },
    REAL_ANALYSIS_TEST_TIMEOUT,
  )
})
