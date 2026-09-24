import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectLzssProfile } from '../lzss'
import { buildPak, parsePak, readPakEntryData } from '../pak'
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
})
