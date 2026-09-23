import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { comparePaks } from './compare'
import { compressLzss, decompressLzss } from './lzss'
import {
  buildPak,
  comparePakFilenames,
  encodeFilename,
  parsePak,
  verifyPak,
} from './pak'

const samplePath = path.resolve(import.meta.dirname, '../sample/etc.pak')

describe('pak', () => {
  it('parses and verifies the real sample', () => {
    const buffer = fs.readFileSync(samplePath)
    const archive = parsePak(buffer)
    expect(archive.header).toMatchObject({
      magic: 0x11223344,
      indexSize: 576,
      field08: 0,
      field0c: 0,
    })
    expect(archive.dataStart).toBe(592)
    expect(archive.entries).toHaveLength(9)
    expect(verifyPak(buffer).valid).toBe(true)
    for (const entry of archive.entries) {
      const expected = fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          '../sample/etc.pak.unpack',
          entry.name,
        ),
      )
      expect(decompressLzss(entry.packedData, entry.unpackedSize)).toEqual(
        expected,
      )
    }
  })

  it('rebuilds the sample with a logical match', () => {
    const originalBuffer = fs.readFileSync(samplePath)
    const original = parsePak(originalBuffer)
    const rebuilt = buildPak({
      field08: original.header.field08,
      field0c: original.header.field0c,
      entries: original.entries.map((entry) => ({
        name: entry.name,
        data: decompressLzss(entry.packedData, entry.unpackedSize),
        field00: entry.field00,
        field10: entry.field10,
      })),
    })
    expect(verifyPak(rebuilt).valid).toBe(true)
    expect(comparePaks(originalBuffer, rebuilt)).toMatchObject({
      logicalMatch: true,
      matchedFiles: 9,
      totalFiles: 9,
    })
  })

  it('enforces filename byte limits and malformed headers', () => {
    expect(encodeFilename('中文.txt').length).toBe(8)
    expect(() => encodeFilename('a'.repeat(45))).toThrow('exceeds')
    expect(verifyPak(Buffer.alloc(16)).valid).toBe(false)
  })

  it('defaults unknown fields to zero and accepts explicit values', () => {
    const defaults = parsePak(
      buildPak({ entries: [{ name: 'a.txt', data: Buffer.from('a') }] }),
    )
    expect(defaults.header).toMatchObject({ field08: 0, field0c: 0 })
    expect(defaults.entries[0]).toMatchObject({ field00: 0, field10: 0 })

    const custom = parsePak(
      buildPak({
        field08: 1,
        field0c: 2,
        entries: [
          { name: 'a.txt', data: Buffer.from('a'), field00: 0, field10: 4 },
        ],
      }),
    )
    expect(custom.header).toMatchObject({ field08: 1, field0c: 2 })
    expect(custom.entries[0]).toMatchObject({ field00: 0, field10: 4 })
  })

  it('reproduces the complete pak filename order', () => {
    const fullSample = parsePak(
      fs.readFileSync(
        path.resolve(import.meta.dirname, '../sample/etc_full.pak'),
      ),
    )
    const names = fullSample.entries.map((entry) => entry.name)
    expect(names).toHaveLength(1356)
    expect([...names].sort(comparePakFilenames)).toEqual(names)
  })

  it('sorts case-insensitively with underscores after letters', () => {
    const names = ['ac_combat', 'ACHIEVE', 'account', 'a_', 'az', 'a-z']
    expect(names.sort(comparePakFilenames)).toEqual([
      'a-z',
      'account',
      'ACHIEVE',
      'ac_combat',
      'az',
      'a_',
    ])
  })

  it('reports the hierarchical pak variant explicitly', () => {
    const result = verifyPak(
      fs.readFileSync(
        path.resolve(import.meta.dirname, '../sample/lib_gs32.pak'),
      ),
    )
    expect(result.valid).toBe(false)
    expect(result.issues[0]?.error).toBe('Directory entries are not supported')
  })

  it('closely reproduces the original classic LZSS streams', () => {
    const archive = parsePak(fs.readFileSync(samplePath))
    const recompressed = archive.entries.map((entry) =>
      compressLzss(decompressLzss(entry.packedData, entry.unpackedSize)),
    )
    expect(
      recompressed.filter((data, index) =>
        data.equals(archive.entries[index]!.packedData),
      ),
    ).toHaveLength(8)
    expect(
      recompressed.every(
        (data, index) => data.length === archive.entries[index]!.packedSize,
      ),
    ).toBe(true)
  })

  it('validates and preserves supplied compressed and filename data', () => {
    const original = parsePak(fs.readFileSync(samplePath)).entries[0]!
    const data = decompressLzss(original.packedData, original.unpackedSize)
    const rebuilt = parsePak(
      buildPak({
        entries: [
          {
            name: original.name,
            data,
            packedData: original.packedData,
            filenameField: original.raw.subarray(20),
          },
        ],
      }),
    )
    expect(rebuilt.entries[0]!.packedData).toEqual(original.packedData)
    expect(rebuilt.entries[0]!.raw.subarray(20)).toEqual(
      original.raw.subarray(20),
    )

    expect(() =>
      buildPak({
        entries: [
          {
            name: original.name,
            data: Buffer.from(data).fill(0, 0, 1),
            packedData: original.packedData,
          },
        ],
      }),
    ).toThrow('does not match')
    expect(() =>
      buildPak({
        entries: [
          {
            name: original.name,
            data,
            filenameField: Buffer.alloc(43),
          },
        ],
      }),
    ).toThrow('must be 44 bytes')
  })
})
