import type { PakArchive, PakBuildEntry, PakEntry } from './pak'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FILENAME_OFFSET } from './constants'
import { detectLzssProfile } from './lzss'
import {
  buildPak,
  flattenPakEntries,
  parsePak,
  readPakEntryData,
  verifyPak,
} from './pak'

const REAL_SAMPLE_ROOT = path.resolve(import.meta.dirname, '../sample/real-etc')
const REAL_SAMPLE_TEST_TIMEOUT = 30_000

interface SampleContext {
  relativePath: string
  archive: PakArchive
  flattened: PakEntry[]
  payloads: Map<PakEntry, Buffer>
}

interface RealSample {
  relativePath: string
  assertSpecial?: (context: SampleContext) => void
}

function entryDetails(relativePath: string, entry: PakEntry): string {
  return [
    `sample=${relativePath}`,
    `entry=${entry.path}`,
    `field00=0x${entry.field00.toString(16).padStart(8, '0')}`,
    `payload=${entry.type === 'directory' ? 'directory' : entry.payloadKind}`,
    `packedSize=${entry.packedSize}`,
    `unpackedSize=${entry.unpackedSize}`,
  ].join(' ')
}

function sampleDetails(relativePath: string, archive: PakArchive): string {
  const flattened = flattenPakEntries(archive.entries)
  const maximumDepth = Math.max(0, ...flattened.map((entry) => entry.depth))
  const zeroPayloadEntries = archive.files.filter(
    (entry) => entry.payloadKind === 'none',
  ).length
  return [
    `sample=${relativePath}`,
    `size=${archive.size}`,
    `entries=${archive.entryCount}`,
    `files=${archive.files.length}`,
    `directories=${archive.directories.length}`,
    `zeroPayload=${zeroPayloadEntries}`,
    `maxDepth=${maximumDepth}`,
  ].join(' ')
}

function readPayload(relativePath: string, entry: PakEntry): Buffer {
  try {
    return readPakEntryData(entry)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to read real PAK payload: ${entryDetails(relativePath, entry)} error=${reason}`,
    )
  }
}

function requireFile(context: SampleContext, entryPath: string): PakEntry {
  const entry = context.archive.files.find((item) => item.path === entryPath)
  if (!entry)
    throw new Error(
      `Missing expected file: sample=${context.relativePath} entry=${entryPath}`,
    )
  return entry
}

function preservingBuildEntry(
  relativePath: string,
  entry: PakEntry,
  payloads: ReadonlyMap<PakEntry, Buffer>,
): PakBuildEntry {
  const metadata = {
    name: entry.name,
    field00: entry.field00,
    field10: entry.field10,
    filenameField: entry.raw.subarray(FILENAME_OFFSET),
  }
  if (entry.type === 'directory')
    return {
      ...metadata,
      children: entry.children!.map((child) =>
        preservingBuildEntry(relativePath, child, payloads),
      ),
    }
  if (entry.payloadKind === 'none')
    return {
      ...metadata,
      payloadKind: 'none',
      unpackedSizeOverride: entry.unpackedSize,
    }
  const data = payloads.get(entry)
  if (!data)
    throw new Error(
      `Missing cached payload for rebuild: ${entryDetails(relativePath, entry)}`,
    )
  return {
    ...metadata,
    data,
    packedData: entry.packedData,
  }
}

function firstDifference(left: Buffer, right: Buffer): number {
  const sharedLength = Math.min(left.length, right.length)
  for (let offset = 0; offset < sharedLength; offset++)
    if (left[offset] !== right[offset]) return offset
  return left.length === right.length ? -1 : sharedLength
}

function binaryDifferenceDetails(
  context: SampleContext,
  original: Buffer,
  rebuilt: Buffer,
): string {
  const offset = firstDifference(original, rebuilt)
  const entry = context.flattened.find(
    (item) =>
      (offset >= item.entryOffset &&
        offset < item.entryOffset + item.raw.length) ||
      (offset >= item.dataOffset && offset < item.dataOffset + item.packedSize),
  )
  return [
    'Reference-preserving rebuild is not byte-identical',
    sampleDetails(context.relativePath, context.archive),
    `originalSize=${original.length}`,
    `rebuiltSize=${rebuilt.length}`,
    `firstDifference=${offset}`,
    entry ? entryDetails(context.relativePath, entry) : 'entry=<none>',
  ].join(' ')
}

function assertAaaEtc(context: SampleContext): void {
  const entry = requireFile(context, 'file_dependence.list')
  expect(entry, entryDetails(context.relativePath, entry)).toMatchObject({
    stored: true,
    payloadKind: 'stored',
    packedSize: 0,
    unpackedSize: 0,
  })
  expect(
    context.payloads.get(entry),
    entryDetails(context.relativePath, entry),
  ).toEqual(Buffer.alloc(0))

  const stored = context.archive.files.filter((item) => item.stored)
  expect(
    stored.map((item) => [item.name, item.packedSize, item.unpackedSize]),
    sampleDetails(context.relativePath, context.archive),
  ).toEqual([
    ['file_dependence.list', 0, 0],
    ['hanzi_table.list', 938, 938],
  ])
}

function assertAaaLibrary(context: SampleContext): void {
  for (const entryPath of [
    'aaa/daemons/express_recharged.o',
    'aaa/start_aaa.o',
  ]) {
    const entry = requireFile(context, entryPath)
    expect(
      detectLzssProfile(context.payloads.get(entry)!, entry.packedData),
      entryDetails(context.relativePath, entry),
    ).toBe('okumura-18')
  }
}

function assertDbaEtc(context: SampleContext): void {
  const empty = requireFile(context, 'file_dependence.list')
  expect(empty, entryDetails(context.relativePath, empty)).toMatchObject({
    stored: true,
    payloadKind: 'stored',
    packedSize: 0,
    unpackedSize: 0,
  })
  expect(
    context.payloads.get(empty),
    entryDetails(context.relativePath, empty),
  ).toEqual(Buffer.alloc(0))

  const opaque = requireFile(context, 'etc')
  expect(opaque, entryDetails(context.relativePath, opaque)).toMatchObject({
    stored: false,
    payloadKind: 'none',
    field00: 0,
    dataOffset: 6_901_897,
    packedSize: 0,
    unpackedSize: 7_829_223,
    field10: 0x59e63e14,
  })
  expect(
    () => readPakEntryData(opaque),
    entryDetails(context.relativePath, opaque),
  ).toThrow('Entry has no payload: etc')
}

function assertGsLibrary(context: SampleContext): void {
  expect(
    context.archive.directories.length,
    sampleDetails(context.relativePath, context.archive),
  ).toBeGreaterThan(0)
  expect(
    Math.max(...context.flattened.map((entry) => entry.depth)),
    sampleDetails(context.relativePath, context.archive),
  ).toBeGreaterThan(1)
  expect(
    context.archive.directories.some((entry) => entry.depth > 0),
    sampleDetails(context.relativePath, context.archive),
  ).toBe(true)

  for (const entryPath of [
    'clone/misc/mixed_agent.o',
    'gs/daemons/tasks/2016/summer_vacation/choubwz_sub_tasks/camel.o',
    'gs/daemons/tasks/2016/summer_vacation/choubwz_sub_tasks/food.o',
  ]) {
    const entry = requireFile(context, entryPath)
    expect(
      context.payloads.get(entry)?.length,
      entryDetails(context.relativePath, entry),
    ).toBe(entry.unpackedSize)
  }

  const deepFiles = context.archive.files.filter((entry) => entry.depth > 1)
  expect(
    deepFiles.length,
    sampleDetails(context.relativePath, context.archive),
  ).toBeGreaterThan(0)
  for (const entry of deepFiles)
    expect(
      context.payloads.get(entry)?.length,
      entryDetails(context.relativePath, entry),
    ).toBe(entry.unpackedSize)
}

const REAL_SAMPLES: readonly RealSample[] = [
  { relativePath: 'aaa/etc.pak', assertSpecial: assertAaaEtc },
  { relativePath: 'aaa/lib_aaa32.pak', assertSpecial: assertAaaLibrary },
  { relativePath: 'ccs/etc.pak' },
  { relativePath: 'ccs/lib_ccs32.pak' },
  { relativePath: 'csa/etc.pak' },
  { relativePath: 'csa/lib_csa32.pak' },
  { relativePath: 'dba/etc.pak', assertSpecial: assertDbaEtc },
  { relativePath: 'dba/lib_dba32.pak' },
  { relativePath: 'gs/etc.pak' },
  { relativePath: 'gs/lib_gs32.pak', assertSpecial: assertGsLibrary },
  { relativePath: 'gs/server_animates.pak' },
  { relativePath: 'gs/server_maps.pak' },
]

describe('real production PAK compatibility', () => {
  it.each(REAL_SAMPLES)(
    '$relativePath parses, verifies, reads every payload, and rebuilds byte-identically',
    ({ relativePath, assertSpecial }) => {
      const original = fs.readFileSync(
        path.resolve(REAL_SAMPLE_ROOT, relativePath),
      )
      const archive = parsePak(original)
      const flattened = flattenPakEntries(archive.entries)
      const details = sampleDetails(relativePath, archive)

      const verification = verifyPak(original)
      expect(
        verification.valid,
        `${details} issues=${JSON.stringify(verification.issues)}`,
      ).toBe(true)
      expect(archive.entryCount, details).toBe(flattened.length)
      expect(archive.files.length + archive.directories.length, details).toBe(
        flattened.length,
      )
      expect(
        archive.files.map((entry) => entry.path),
        details,
      ).toEqual(
        flattened
          .filter((entry) => entry.type === 'file')
          .map((entry) => entry.path),
      )
      expect(
        archive.directories.map((entry) => entry.path),
        details,
      ).toEqual(
        flattened
          .filter((entry) => entry.type === 'directory')
          .map((entry) => entry.path),
      )

      const paths = new Set<string>()
      for (const entry of flattened) {
        expect(paths.has(entry.path), entryDetails(relativePath, entry)).toBe(
          false,
        )
        paths.add(entry.path)
      }

      const payloads = new Map<PakEntry, Buffer>()
      for (const entry of archive.files) {
        if (entry.payloadKind === 'none') continue
        const data = readPayload(relativePath, entry)
        expect(data.length, entryDetails(relativePath, entry)).toBe(
          entry.unpackedSize,
        )
        payloads.set(entry, data)
      }

      const context: SampleContext = {
        relativePath,
        archive,
        flattened,
        payloads,
      }
      assertSpecial?.(context)

      const rebuilt = buildPak({
        field08: archive.header.field08,
        field0c: archive.header.field0c,
        entries: archive.entries.map((entry) =>
          preservingBuildEntry(relativePath, entry, payloads),
        ),
      })
      const identical = rebuilt.equals(original)
      expect(
        identical,
        identical
          ? details
          : binaryDifferenceDetails(context, original, rebuilt),
      ).toBe(true)
    },
    REAL_SAMPLE_TEST_TIMEOUT,
  )
})
