import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { comparePaks } from './compare'
import { decompressLzss } from './lzss'
import { buildPak, encodeFilename, parsePak, verifyPak } from './pak'

const samplePath = path.resolve(import.meta.dirname, '../sample/etc.pak')

describe('pAK', () => {
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
      rawHeader: original.header.raw,
      entries: original.entries.map((entry) => ({
        name: entry.name,
        rawEntry: entry.raw,
        data: decompressLzss(entry.packedData, entry.unpackedSize),
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
})
