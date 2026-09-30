import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { comparePaks } from './compare'
import { ENTRY_FLAG_STORED, FILENAME_SIZE, HEADER_SIZE } from './constants'
import { compressLzss } from './lzss'
import {
  buildPak,
  compareFallbackPakNames,
  comparePakFilenames,
  encodeFilename,
  parsePak,
  readPakEntryData,
  verifyPak,
} from './pak'

describe('pak', () => {
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
    expect(defaults.entries[0]).toMatchObject({
      field00: ENTRY_FLAG_STORED,
      field10: 0,
      stored: true,
    })
    const compressedDefault = parsePak(
      buildPak({
        entries: [{ name: 'repeat.bin', data: Buffer.alloc(128, 0x41) }],
      }),
    )
    expect(compressedDefault.entries[0]).toMatchObject({
      field00: 0,
      stored: false,
    })

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

  it('sorts case-insensitively with underscores after letters', () => {
    const names = ['ac_combat', 'ACHIEVE', 'account', 'a_', 'az', 'a-z']
    expect(comparePakFilenames).toBe(compareFallbackPakNames)
    expect(names.sort(compareFallbackPakNames)).toEqual([
      'a-z',
      'account',
      'ACHIEVE',
      'ac_combat',
      'az',
      'a_',
    ])
  })

  it('builds nested directories and empty archives', () => {
    const nested = parsePak(
      buildPak({
        entries: [
          {
            name: 'root',
            children: [
              { name: 'empty', children: [] },
              { name: 'hello.txt', data: Buffer.from('hello') },
            ],
          },
        ],
      }),
    )
    expect(nested.directories.map((entry) => entry.path)).toEqual([
      'root',
      'root/empty',
    ])
    expect(nested.files.map((entry) => entry.path)).toEqual(['root/hello.txt'])
    expect(verifyPak(buildPak({ entries: [] })).valid).toBe(true)
  })

  it('validates and preserves supplied compressed and filename data', () => {
    const name = 'repeat.bin'
    const data = Buffer.alloc(128, 0x41)
    const packedData = compressLzss(data)
    const filenameField = Buffer.alloc(FILENAME_SIZE, 0x7f)
    Buffer.from(name).copy(filenameField)
    filenameField[name.length] = 0
    const rebuilt = parsePak(
      buildPak({
        entries: [
          {
            name,
            data,
            packedData,
            filenameField,
          },
        ],
      }),
    )
    expect(rebuilt.entries[0]!.packedData).toEqual(packedData)
    expect(rebuilt.entries[0]!.raw.subarray(20)).toEqual(filenameField)

    expect(() =>
      buildPak({
        entries: [
          {
            name,
            data: Buffer.from(data).fill(0, 0, 1),
            packedData,
          },
        ],
      }),
    ).toThrow('does not match')
    expect(() =>
      buildPak({
        entries: [
          {
            name,
            data,
            filenameField: Buffer.alloc(FILENAME_SIZE - 1),
          },
        ],
      }),
    ).toThrow('must be 44 bytes')
  })

  it('supports stored, empty stored, and explicitly compressed files', () => {
    const raw = Buffer.from(Array.from({ length: 64 }, (_, index) => index))
    const buffer = buildPak({
      entries: [
        { name: 'raw.bin', data: raw, stored: true },
        { name: 'empty.bin', data: Buffer.alloc(0), stored: true },
        {
          name: 'compressed.txt',
          data: Buffer.alloc(128, 0x41),
          stored: false,
        },
      ],
    })
    const archive = parsePak(buffer)

    expect(verifyPak(buffer).valid).toBe(true)
    expect(archive.files.map((entry) => entry.stored)).toEqual([
      true,
      true,
      false,
    ])
    expect(archive.files[0]!.field00).toBe(ENTRY_FLAG_STORED)
    expect(archive.files[0]!.packedSize).toBe(raw.length)
    expect(readPakEntryData(archive.files[0]!)).toEqual(raw)
    expect(readPakEntryData(archive.files[1]!)).toEqual(Buffer.alloc(0))
    expect(readPakEntryData(archive.files[2]!)).toEqual(Buffer.alloc(128, 0x41))

    const malformed = Buffer.from(buffer)
    malformed.writeUInt32LE(raw.length + 1, HEADER_SIZE + 12)
    const verification = verifyPak(malformed)
    expect(verification.valid).toBe(false)
    expect(verification.issues[0]).toMatchObject({
      field00: ENTRY_FLAG_STORED,
      error: 'Stored entry has different packed/unpacked size: raw.bin',
    })
  })

  it('supports zero-payload entries without treating empty stored files as none', () => {
    const buffer = buildPak({
      entries: [
        {
          name: 'empty.txt',
          data: Buffer.alloc(0),
          stored: true,
        },
        {
          name: 'opaque',
          payloadKind: 'none',
          unpackedSizeOverride: 12_345,
          field10: 456,
        },
        {
          name: 'next.txt',
          data: Buffer.from('next'),
          stored: true,
        },
      ],
    })
    const verification = verifyPak(buffer)
    expect(verification.valid).toBe(true)
    const [empty, opaque, next] = verification.archive!.files
    expect(empty).toMatchObject({
      payloadKind: 'stored',
      packedSize: 0,
      unpackedSize: 0,
    })
    expect(readPakEntryData(empty!)).toEqual(Buffer.alloc(0))
    expect(opaque).toMatchObject({
      payloadKind: 'none',
      stored: false,
      packedSize: 0,
      unpackedSize: 12_345,
      field10: 456,
    })
    expect(() => readPakEntryData(opaque!)).toThrow(
      'Entry has no payload: opaque',
    )
    expect(opaque!.dataOffset).toBe(next!.dataOffset)
  })

  it('validates zero-payload build inputs', () => {
    expect(() =>
      buildPak({
        entries: [
          {
            name: 'opaque',
            data: Buffer.alloc(0),
            payloadKind: 'none',
            unpackedSizeOverride: 1,
          },
        ],
      }),
    ).toThrow('Zero-payload entry must not contain data')
    expect(() =>
      buildPak({
        entries: [{ name: 'opaque', payloadKind: 'none' }],
      }),
    ).toThrow('requires a positive uint32 unpackedSizeOverride')
  })

  it('rejects a stored directory bitfield', () => {
    const buffer = buildPak({ entries: [{ name: 'dir', children: [] }] })
    buffer.writeUInt32LE(ENTRY_FLAG_STORED + 1, HEADER_SIZE)
    expect(verifyPak(buffer).issues[0]!.error).toContain(
      'cannot be a stored directory',
    )

    const unsupported = Buffer.from(buffer)
    unsupported.writeUInt32LE(2, HEADER_SIZE)
    expect(verifyPak(unsupported).issues[0]!.error).toContain(
      'unsupported field00',
    )
  })

  it('compares logical contents by path instead of entry order', () => {
    const first = buildPak({
      entries: [
        { name: 'foo', data: Buffer.from('foo'), stored: true },
        { name: 'bar', data: Buffer.from('bar'), stored: true },
      ],
    })
    const reordered = buildPak({
      entries: [
        { name: 'bar', data: Buffer.from('bar'), stored: true },
        { name: 'foo', data: Buffer.from('foo'), stored: true },
      ],
    })
    const changed = buildPak({
      entries: [
        { name: 'foo', data: Buffer.from('changed'), stored: true },
        { name: 'bar', data: Buffer.from('bar'), stored: true },
      ],
    })

    expect(comparePaks(first, reordered)).toMatchObject({
      logicalMatch: true,
      structuralMatch: false,
      binaryIdentical: false,
      matchedFiles: 2,
      totalFiles: 2,
    })
    expect(comparePaks(first, reordered).details).toMatchObject({
      entryOrder: [{ index: 0 }, { index: 1 }],
      metadata: [],
      sizes: [],
    })
    const changedResult = comparePaks(first, changed)
    expect(changedResult).toMatchObject({
      logicalMatch: false,
      matchedFiles: 1,
      totalFiles: 2,
    })
    expect(changedResult.differences).toContain('unpacked content differs')
  })

  it('compares zero-payload entries separately from extractable files', () => {
    const build = (unpackedSizeOverride: number): Buffer =>
      buildPak({
        entries: [
          { name: 'file', data: Buffer.from('file'), stored: true },
          {
            name: 'opaque',
            payloadKind: 'none',
            unpackedSizeOverride,
            field10: 123,
          },
        ],
      })
    expect(comparePaks(build(99), build(99))).toMatchObject({
      logicalMatch: true,
      matchedFiles: 1,
      totalFiles: 1,
      matchedZeroPayloadEntries: 1,
      totalZeroPayloadEntries: 1,
    })
    expect(comparePaks(build(99), build(100))).toMatchObject({
      logicalMatch: false,
      matchedZeroPayloadEntries: 0,
      totalZeroPayloadEntries: 1,
    })
  })
})
