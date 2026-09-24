import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { comparePaks } from '../compare'
import { detectLzssProfile } from '../lzss'
import {
  buildPak,
  compareFallbackPakNames,
  parsePak,
  readPakEntryData,
} from '../pak'
import { packDirectory } from './pack-command'
import { unpackArchive } from './unpack-command'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atetc-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('reference pack', () => {
  it('produces byte-identical fallback builds for the same directory', () => {
    const root = temporaryDirectory()
    const input = path.join(root, 'input')
    fs.mkdirSync(input)
    for (const name of ['z.txt', 'a.txt', 'foo_bar.txt', 'Foo.txt'])
      fs.writeFileSync(path.join(input, name), name)

    const first = path.join(root, 'first.pak')
    const second = path.join(root, 'second.pak')
    packDirectory(input, { output: first })
    packDirectory(input, { output: second })

    expect(fs.readFileSync(first)).toEqual(fs.readFileSync(second))
    expect(
      parsePak(fs.readFileSync(first)).entries.map((entry) => entry.name),
    ).toEqual(
      ['z.txt', 'a.txt', 'foo_bar.txt', 'Foo.txt'].sort(
        compareFallbackPakNames,
      ),
    )
  })

  it('keeps reference order and appends sorted additions', () => {
    const root = temporaryDirectory()
    const input = path.join(root, 'input')
    fs.mkdirSync(input)
    for (const name of ['A', 'B', 'C', 'D', 'E'])
      fs.writeFileSync(path.join(input, name), name)
    const referencePath = path.join(root, 'reference.pak')
    fs.writeFileSync(
      referencePath,
      buildPak({
        entries: ['C', 'A', 'B'].map((name) => ({
          name,
          data: Buffer.from(name),
          stored: true,
        })),
      }),
    )

    const output = path.join(root, 'output.pak')
    packDirectory(input, { output, reference: referencePath })
    expect(
      parsePak(fs.readFileSync(output)).entries.map((entry) => entry.name),
    ).toEqual(['C', 'A', 'B', 'D', 'E'])
  })

  it('keeps reference order at every directory level', () => {
    const root = temporaryDirectory()
    const referencePath = path.join(root, 'reference.pak')
    const reference = buildPak({
      entries: [
        {
          name: 'zdir',
          children: [
            { name: 'z.txt', data: Buffer.from('z'), stored: true },
            { name: 'a.txt', data: Buffer.from('a'), stored: true },
          ],
        },
        { name: 'adir', children: [] },
        { name: 'file.txt', data: Buffer.from('file'), stored: true },
      ],
    })
    fs.writeFileSync(referencePath, reference)
    const unpacked = path.join(root, 'unpacked')
    unpackArchive(referencePath, { output: unpacked })

    const output = path.join(root, 'output.pak')
    packDirectory(unpacked, { output, reference: referencePath })
    expect(fs.readFileSync(output)).toEqual(reference)
    const archive = parsePak(fs.readFileSync(output))
    expect(archive.entries.map((entry) => entry.name)).toEqual([
      'zdir',
      'adir',
      'file.txt',
    ])
    expect(archive.entries[0]!.children!.map((entry) => entry.name)).toEqual([
      'z.txt',
      'a.txt',
    ])
  })

  it('preserves stored mode and the detected LZSS profile', () => {
    const root = temporaryDirectory()
    const referencePath = path.join(root, 'reference.pak')
    const unpackedPath = path.join(root, 'unpacked')
    const unchangedPath = path.join(root, 'unchanged.pak')
    const modifiedPath = path.join(root, 'modified.pak')
    const compressedData = Buffer.from('                  ABCABCABCABCABCABC')
    const reference = buildPak({
      entries: [
        {
          name: 'compressed.bin',
          data: compressedData,
          stored: false,
          lzssProfile: 'okumura-18',
          field10: 123,
        },
        {
          name: 'stored.bin',
          data: Buffer.from('stored original'),
          stored: true,
          field10: 456,
        },
      ],
    })
    fs.writeFileSync(referencePath, reference)

    unpackArchive(referencePath, { output: unpackedPath })
    packDirectory(unpackedPath, {
      output: unchangedPath,
      reference: referencePath,
    })
    expect(fs.readFileSync(unchangedPath)).toEqual(reference)

    const modifiedCompressed = Buffer.concat([
      compressedData,
      Buffer.from(' changed'),
    ])
    const modifiedStored = Buffer.from('stored changed')
    fs.writeFileSync(
      path.join(unpackedPath, 'compressed.bin'),
      modifiedCompressed,
    )
    fs.writeFileSync(path.join(unpackedPath, 'stored.bin'), modifiedStored)
    packDirectory(unpackedPath, {
      output: modifiedPath,
      reference: referencePath,
    })

    const archive = parsePak(fs.readFileSync(modifiedPath))
    const compressed = archive.files.find(
      (entry) => entry.name === 'compressed.bin',
    )!
    const stored = archive.files.find((entry) => entry.name === 'stored.bin')!
    expect(compressed.stored).toBe(false)
    expect(compressed.field10).toBe(123)
    expect(readPakEntryData(compressed)).toEqual(modifiedCompressed)
    expect(detectLzssProfile(modifiedCompressed, compressed.packedData)).toBe(
      'okumura-18',
    )
    expect(stored.stored).toBe(true)
    expect(stored.field10).toBe(456)
    expect(readPakEntryData(stored)).toEqual(modifiedStored)
  })

  it('skips and restores zero-payload entries during reference roundtrips', () => {
    const root = temporaryDirectory()
    const referencePath = path.join(root, 'reference.pak')
    const unpackedPath = path.join(root, 'unpacked')
    const rebuiltPath = path.join(root, 'rebuilt.pak')
    const reference = buildPak({
      entries: [
        { name: 'A', data: Buffer.from('A'), stored: true },
        {
          name: 'opaque',
          payloadKind: 'none',
          unpackedSizeOverride: 12345,
          field10: 0x59e63e14,
        },
        { name: 'empty', data: Buffer.alloc(0), stored: true },
        { name: 'B', data: Buffer.from('B'), stored: true },
      ],
    })
    fs.writeFileSync(referencePath, reference)

    unpackArchive(referencePath, { output: unpackedPath })
    expect(fs.existsSync(path.join(unpackedPath, 'opaque'))).toBe(false)
    expect(fs.readFileSync(path.join(unpackedPath, 'empty'))).toEqual(
      Buffer.alloc(0),
    )

    packDirectory(unpackedPath, {
      output: rebuiltPath,
      reference: referencePath,
    })
    const rebuilt = fs.readFileSync(rebuiltPath)
    expect(rebuilt).toEqual(reference)
    expect(parsePak(rebuilt).entries.map((entry) => entry.name)).toEqual([
      'A',
      'opaque',
      'empty',
      'B',
    ])
    expect(comparePaks(reference, rebuilt)).toMatchObject({
      logicalMatch: true,
      structuralMatch: true,
      binaryIdentical: true,
      matchedFiles: 3,
      totalFiles: 3,
      matchedZeroPayloadEntries: 1,
      totalZeroPayloadEntries: 1,
    })

    fs.writeFileSync(path.join(unpackedPath, 'opaque'), 'replacement')
    expect(() =>
      packDirectory(unpackedPath, {
        output: path.join(root, 'conflict.pak'),
        reference: referencePath,
      }),
    ).toThrow('Reference zero-payload entry conflicts with input path: opaque')
  })
})
