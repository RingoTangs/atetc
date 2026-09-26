import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPak } from '../pak'
import { analyzeArchive } from './analyze-command'

const temporaryDirectories: string[] = []

function fixture(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atetc-analysis-'))
  temporaryDirectories.push(directory)
  const filename = path.join(directory, 'fixture.pak')
  fs.writeFileSync(
    filename,
    buildPak({
      entries: [
        { name: 'stored.txt', data: Buffer.from('stored'), stored: true },
        { name: 'compressed.bin', data: Buffer.alloc(32, 0x41) },
        {
          name: 'opaque',
          payloadKind: 'none',
          unpackedSizeOverride: 123,
        },
      ],
    }),
  )
  return filename
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('analyze command', () => {
  it('prints a concise human-readable report', () => {
    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((value: unknown) =>
      output.push(String(value)),
    )

    analyzeArchive(fixture(), {})

    const rendered = output.join('\n')
    expect(rendered).toContain('Header: magic=0x11223344')
    expect(rendered).toContain('field00:')
    expect(rendered).toContain('LZSS profiles:')
    expect(rendered).toContain('Ordering:')
    expect(rendered).toContain('Zero-payload entries:')
    expect(rendered).toContain('opaque:')
  })

  it('prints machine-readable JSON without Buffer data', () => {
    const output: string[] = []
    vi.spyOn(console, 'log').mockImplementation((value: unknown) =>
      output.push(String(value)),
    )

    analyzeArchive(fixture(), { json: true })

    const parsed = JSON.parse(output.join('\n'))
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      entryStats: { total: 3, files: 3, directories: 0 },
      payloadStats: {
        totalFiles: 3,
        stored: { count: 1 },
        none: { count: 1 },
      },
    })
    expect(JSON.stringify(parsed)).not.toContain('packedData')
    expect(JSON.stringify(parsed)).not.toContain('"type":"Buffer"')
  })
})
