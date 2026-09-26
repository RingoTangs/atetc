import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { comparePaks } from '../compare'
import { buildPak, parsePak } from '../pak'
import { packDirectory } from './pack-command'
import { unpackArchive } from './unpack-command'

const REAL_SAMPLE_ROOT = path.resolve(
  import.meta.dirname,
  '../../sample/real-etc',
)
const REAL_CLI_TEST_TIMEOUT = 60_000
const temporaryDirectories: string[] = []
let output: string[]
let warnings: string[]

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atetc-unpack-'))
  temporaryDirectories.push(directory)
  return directory
}

function realSample(...segments: string[]): string {
  return path.join(REAL_SAMPLE_ROOT, ...segments)
}

function expectIdenticalRoundtrip(original: Buffer, rebuilt: Buffer): void {
  expect(comparePaks(original, rebuilt)).toMatchObject({
    logicalMatch: true,
    structuralMatch: true,
    binaryIdentical: true,
  })
}

beforeEach(() => {
  output = []
  warnings = []
  vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) =>
    output.push(values.join(' ')),
  )
  vi.spyOn(console, 'warn').mockImplementation((...values: unknown[]) =>
    warnings.push(values.join(' ')),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('unpack command', () => {
  it('keeps the normal extraction summary when every file has payload data', () => {
    const root = temporaryDirectory()
    const archivePath = path.join(root, 'archive.pak')
    const unpackedPath = path.join(root, 'unpacked')
    fs.writeFileSync(
      archivePath,
      buildPak({
        entries: [
          { name: 'hello.txt', data: Buffer.from('hello'), stored: true },
        ],
      }),
    )

    unpackArchive(archivePath, { output: unpackedPath })

    expect(fs.readFileSync(path.join(unpackedPath, 'hello.txt'), 'utf8')).toBe(
      'hello',
    )
    expect(output).toEqual([
      `Extracted 1 files to ${path.resolve(unpackedPath)}`,
    ])
    expect(output.join('\n')).not.toContain('zero-payload')
  })

  it('creates empty stored files and reports a skipped zero-payload entry', () => {
    const root = temporaryDirectory()
    const archivePath = path.join(root, 'archive.pak')
    const unpackedPath = path.join(root, 'unpacked')
    fs.writeFileSync(
      archivePath,
      buildPak({
        entries: [
          { name: 'data.txt', data: Buffer.from('data'), stored: true },
          { name: 'empty.txt', data: Buffer.alloc(0), stored: true },
          {
            name: 'opaque',
            payloadKind: 'none',
            unpackedSizeOverride: 12_345,
          },
        ],
      }),
    )

    unpackArchive(archivePath, { output: unpackedPath })

    expect(fs.readFileSync(path.join(unpackedPath, 'data.txt'), 'utf8')).toBe(
      'data',
    )
    expect(fs.statSync(path.join(unpackedPath, 'empty.txt')).size).toBe(0)
    expect(fs.existsSync(path.join(unpackedPath, 'opaque'))).toBe(false)
    expect(output).toEqual([
      `Extracted 2 files to ${path.resolve(unpackedPath)} (1 zero-payload entry skipped)`,
    ])
  })

  it('pluralizes the skipped zero-payload entry count', () => {
    const root = temporaryDirectory()
    const archivePath = path.join(root, 'archive.pak')
    const unpackedPath = path.join(root, 'unpacked')
    fs.writeFileSync(
      archivePath,
      buildPak({
        entries: [
          {
            name: 'opaque-a',
            payloadKind: 'none',
            unpackedSizeOverride: 1,
          },
          {
            name: 'opaque-b',
            payloadKind: 'none',
            unpackedSizeOverride: 2,
          },
        ],
      }),
    )

    unpackArchive(archivePath, { output: unpackedPath })

    expect(output).toEqual([
      `Extracted 0 files to ${path.resolve(unpackedPath)} (2 zero-payload entries skipped)`,
    ])
  })
})

describe('real PAK CLI roundtrip', () => {
  it(
    'roundtrips the AAA etc archive with its empty stored file',
    () => {
      const root = temporaryDirectory()
      const originalPath = realSample('aaa', 'etc.pak')
      const unpackedPath = path.join(root, 'unpacked')
      const rebuiltPath = path.join(root, 'rebuilt.pak')

      unpackArchive(originalPath, { output: unpackedPath })
      const unpackOutput = output.join('\n')
      expect(unpackOutput).toContain('Extracted 16 files')
      expect(unpackOutput).not.toContain('zero-payload')
      expect(
        fs.statSync(path.join(unpackedPath, 'file_dependence.list')).size,
      ).toBe(0)
      expect(
        fs.readFileSync(path.join(unpackedPath, 'hanzi_table.list')).length,
      ).toBeGreaterThan(0)

      packDirectory(unpackedPath, {
        reference: originalPath,
        output: rebuiltPath,
      })
      expect(warnings).toEqual([])
      const original = fs.readFileSync(originalPath)
      const rebuilt = fs.readFileSync(rebuiltPath)
      expectIdenticalRoundtrip(original, rebuilt)
    },
    REAL_CLI_TEST_TIMEOUT,
  )

  it(
    'roundtrips the DBA etc archive while keeping its zero-payload entry opaque',
    () => {
      const root = temporaryDirectory()
      const originalPath = realSample('dba', 'etc.pak')
      const unpackedPath = path.join(root, 'unpacked')
      const rebuiltPath = path.join(root, 'rebuilt.pak')

      unpackArchive(originalPath, { output: unpackedPath })
      const unpackOutput = output.join('\n')
      expect(unpackOutput).toContain('Extracted 9 files')
      expect(unpackOutput).toContain('1 zero-payload entry skipped')
      const emptyPath = path.join(unpackedPath, 'file_dependence.list')
      expect(fs.statSync(emptyPath).isFile()).toBe(true)
      expect(fs.statSync(emptyPath).size).toBe(0)
      expect(fs.existsSync(path.join(unpackedPath, 'etc'))).toBe(false)

      packDirectory(unpackedPath, {
        reference: originalPath,
        output: rebuiltPath,
      })
      expect(warnings).toEqual([])
      expect(fs.existsSync(rebuiltPath)).toBe(true)
      const original = fs.readFileSync(originalPath)
      const rebuilt = fs.readFileSync(rebuiltPath)
      expectIdenticalRoundtrip(original, rebuilt)

      const rebuiltArchive = parsePak(rebuilt)
      const rebuiltEmpty = rebuiltArchive.files.find(
        (entry) => entry.path === 'file_dependence.list',
      )
      expect(rebuiltEmpty).toMatchObject({
        stored: true,
        packedSize: 0,
        unpackedSize: 0,
      })
      const rebuiltOpaque = rebuiltArchive.files.find(
        (entry) => entry.path === 'etc',
      )
      expect(rebuiltOpaque).toMatchObject({
        payloadKind: 'none',
        packedSize: 0,
      })
      expect(rebuiltOpaque!.unpackedSize).toBeGreaterThan(0)
    },
    REAL_CLI_TEST_TIMEOUT,
  )

  it(
    'roundtrips the GS library archive with its deep directory tree',
    () => {
      const root = temporaryDirectory()
      const originalPath = realSample('gs', 'lib_gs32.pak')
      const unpackedPath = path.join(root, 'unpacked')
      const rebuiltPath = path.join(root, 'rebuilt.pak')
      const deepFiles = [
        'clone/misc/mixed_agent.o',
        'gs/daemons/tasks/2016/summer_vacation/choubwz_sub_tasks/camel.o',
        'gs/daemons/tasks/2016/summer_vacation/choubwz_sub_tasks/food.o',
      ]

      unpackArchive(originalPath, { output: unpackedPath })
      for (const entryPath of deepFiles) {
        const filename = path.join(unpackedPath, ...entryPath.split('/'))
        expect(fs.statSync(filename).isFile()).toBe(true)
        expect(fs.statSync(path.dirname(filename)).isDirectory()).toBe(true)
      }

      packDirectory(unpackedPath, {
        reference: originalPath,
        output: rebuiltPath,
      })
      expect(warnings).toEqual([])
      const original = fs.readFileSync(originalPath)
      const rebuilt = fs.readFileSync(rebuiltPath)
      expectIdenticalRoundtrip(original, rebuilt)
    },
    REAL_CLI_TEST_TIMEOUT,
  )
})
