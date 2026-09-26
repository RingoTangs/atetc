import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPak } from '../pak'
import {
  compareArchives,
  inspectArchive,
  listArchive,
  showInfo,
} from './read-commands'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atetc-compare-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('compare command', () => {
  it('prints bounded path-aligned verbose structural differences', () => {
    const root = temporaryDirectory()
    const originalPath = path.join(root, 'original.pak')
    const rebuiltPath = path.join(root, 'rebuilt.pak')
    const names = Array.from(
      { length: 22 },
      (_, index) => `entry-${String(index).padStart(2, '0')}`,
    )
    const data = new Map(
      names.map((name, index) => [name, Buffer.alloc(40 + index, 0x41)]),
    )
    fs.writeFileSync(
      originalPath,
      buildPak({
        entries: names.map((name, index) => ({
          name,
          data: data.get(name)!,
          stored: true,
          field10: index + 1,
        })),
      }),
    )
    fs.writeFileSync(
      rebuiltPath,
      buildPak({
        entries: [...names].reverse().map((name) => ({
          name,
          data: data.get(name)!,
          stored: name !== names[0],
          field10: 0,
        })),
      }),
    )

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) =>
      output.push(values.join(' ')),
    )
    vi.spyOn(console, 'warn').mockImplementation((...values: unknown[]) =>
      output.push(values.join(' ')),
    )
    compareArchives(originalPath, rebuiltPath, { verbose: true })

    const rendered = output.join('\n')
    expect(rendered).toContain('Logical match: YES')
    expect(rendered).toContain('Structural match: NO')
    expect(rendered).toContain('[entry-order]')
    expect(rendered).toContain('[metadata]')
    expect(rendered).toContain('[size]')
    expect(rendered).toContain('[offset]')
    expect(rendered).toContain('unpackedSize: same')
    expect(rendered).toContain('... 2 more differences')
    expect(rendered).not.toContain('index 20\n')
  })

  it('reports file modes, ratios, counts, and comparison details', () => {
    const root = temporaryDirectory()
    const archivePath = path.join(root, 'opaque.pak')
    fs.writeFileSync(
      archivePath,
      buildPak({
        entries: [
          {
            name: 'empty',
            data: Buffer.alloc(0),
            stored: true,
          },
          {
            name: 'compressed',
            data: Buffer.alloc(8, 0x41),
            stored: false,
          },
          {
            name: 'opaque',
            payloadKind: 'none',
            unpackedSizeOverride: 12_345,
            field10: 456,
          },
        ],
      }),
    )

    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) =>
      output.push(values.join(' ')),
    )
    listArchive(archivePath, { long: true })
    showInfo(archivePath)
    inspectArchive(archivePath)
    compareArchives(archivePath, archivePath)

    const rendered = output.join('\n')
    expect(output).toContain('INDEX  MODE     PACKED  ORIGINAL  RATIO    NAME')
    expect(output).toContain('0      STORED   0       0         -        empty')
    expect(output).toContain(
      '1      LZSS     4       8         50.00%   compressed',
    )
    expect(output).toContain(
      '2      NO-DATA  0       12345     -        opaque',
    )
    expect(rendered).not.toContain('NONE')
    expect(rendered).toContain('File entries: 3')
    expect(rendered).toContain('Extractable files: 2')
    expect(rendered).toContain('Zero-payload entries: 1')
    expect(rendered).toContain('payload=none')
    expect(rendered).toContain('field00=0x00000000')
    expect(rendered).toContain('Zero-payload entries matched: 1/1')
  })
})
