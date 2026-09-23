#!/usr/bin/env node
import type { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import { Command } from 'commander'
import { comparePaks } from './compare'
import { ENTRY_SIZE, FILENAME_ENCODING, HEADER_SIZE } from './constants'
import { decompressLzss } from './lzss'
import {
  buildPak,
  comparePakFilenames,
  encodeFilename,
  parsePak,
  verifyPak,
} from './pak'

function readPak(filename: string): Buffer {
  return fs.readFileSync(filename)
}
function ratio(packed: number, unpacked: number): string {
  return unpacked === 0 ? '0.00%' : `${((packed / unpacked) * 100).toFixed(2)}%`
}
function yesNo(value: boolean): string {
  return value ? 'YES' : 'NO'
}

function success(value: string): string {
  return chalk.green(value)
}

function failure(value: string): string {
  return chalk.red(value)
}

function warning(value: string): string {
  return chalk.yellow(value)
}

function safeRelativePath(name: string): string {
  // 同时按 Windows 和 POSIX 规则检查，避免在不同平台解包时出现路径穿越。
  if (
    name.includes('\0') ||
    /^[a-z]:/i.test(name) ||
    name.startsWith('/') ||
    name.startsWith('\\')
  )
    throw new Error(`Unsafe archive path: ${name}`)
  const segments = name.split(/[\\/]/)
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  )
    throw new Error(`Unsafe archive path: ${name}`)
  return path.join(...segments)
}

function outputPath(root: string, name: string): string {
  const result = path.resolve(root, safeRelativePath(name))
  const relative = path.relative(path.resolve(root), result)
  // 分段检查后再次验证最终绝对路径，作为路径安全的第二道防线。
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Archive path escapes output directory: ${name}`)
  return result
}

function ensureEmptyDestination(destination: string): void {
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0)
    throw new Error(`Output directory is not empty: ${destination}`)
}

function defaultPackOutput(directory: string): string {
  return directory.endsWith('.pak.unpack')
    ? `${directory.slice(0, -'.pak.unpack'.length)}.repacked.pak`
    : `${directory}.pak`
}

interface DirectoryFile {
  name: string
  filename: string
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function scanDirectory(directory: string): DirectoryFile[] {
  const root = path.resolve(directory)
  const rootStats = fs.lstatSync(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink())
    throw new Error(`Pack input is not a regular directory: ${directory}`)
  const files: DirectoryFile[] = []
  const visit = (current: string, segments: string[]): void => {
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, item.name)
      const nextSegments = [...segments, item.name]
      if (item.isSymbolicLink())
        throw new Error(`Symbolic links are not supported: ${filename}`)
      if (item.isDirectory()) visit(filename, nextSegments)
      else if (item.isFile())
        files.push({ name: nextSegments.join('/'), filename })
      else throw new Error(`Unsupported directory entry: ${filename}`)
    }
  }
  visit(root, [])
  return files
}

function canonicalArchiveName(name: string): string {
  return safeRelativePath(name).split(path.sep).join('/')
}

function printIssues(buffer: Buffer): boolean {
  const result = verifyPak(buffer)
  if (result.valid) {
    console.log(
      `${success('PASS')}: ${result.archive!.entries.length} entries verified`,
    )
    return true
  }
  for (const issue of result.issues) {
    const prefix =
      issue.entryIndex === undefined
        ? ''
        : `Entry #${issue.entryIndex} (${issue.filename ?? '<unknown>'}), offset=${issue.offset ?? '-'}, packed=${issue.packedSize ?? '-'}, unpacked=${issue.unpackedSize ?? '-'}: `
    console.error(failure(`${prefix}${issue.error}`))
  }
  return false
}

const program = new Command()
  .name('atetc')
  .description('Inspect, unpack, verify, and rebuild etc.pak archives')
  .version('0.1.0')

program
  .command('info')
  .argument('<pak>')
  .action((filename: string) => {
    const archive = parsePak(readPak(filename))
    const packed = archive.entries.reduce(
      (sum, entry) => sum + entry.packedSize,
      0,
    )
    const unpacked = archive.entries.reduce(
      (sum, entry) => sum + entry.unpackedSize,
      0,
    )
    console.log(
      `Magic: 0x${archive.header.magic.toString(16).padStart(8, '0')}`,
    )
    console.log(`PAK size: ${archive.size}`)
    console.log(`Index size: ${archive.header.indexSize}`)
    console.log(`Entry count: ${archive.entries.length}`)
    console.log(`Entry size: ${ENTRY_SIZE}`)
    console.log(`Data start: ${archive.dataStart}`)
    console.log(`Compressed size: ${packed}`)
    console.log(`Uncompressed size: ${unpacked}`)
    console.log(`Compression ratio: ${ratio(packed, unpacked)}`)
    console.log(`Filename encoding: ${FILENAME_ENCODING}`)
    console.log('Compression algorithm: LZSS (4096/18/2)')
  })

program
  .command('list')
  .argument('<pak>')
  .option('-l, --long', 'show sizes and compression ratio')
  .action((filename: string, options: { long?: boolean }) => {
    const archive = parsePak(readPak(filename))
    if (!options.long)
      for (const entry of archive.entries) console.log(entry.name)
    else {
      console.log('INDEX  PACKED  ORIGINAL  RATIO    NAME')
      for (const entry of archive.entries)
        console.log(
          `${String(entry.index).padEnd(7)}${String(entry.packedSize).padEnd(8)}${String(entry.unpackedSize).padEnd(10)}${ratio(entry.packedSize, entry.unpackedSize).padEnd(9)}${entry.name}`,
        )
    }
  })

program
  .command('inspect')
  .argument('<pak>')
  .action((filename: string) => {
    const archive = parsePak(readPak(filename))
    console.log(`Header hex: ${archive.header.raw.toString('hex')}`)
    console.log(
      `Header uint32: ${[archive.header.magic, archive.header.indexSize, archive.header.field08, archive.header.field0c].join(', ')}`,
    )
    console.log(
      `Index: ${HEADER_SIZE}..${archive.dataStart} (${archive.entries.length} x ${ENTRY_SIZE})`,
    )
    console.log(
      `Unknown +0x00 values: ${[...new Set(archive.entries.map((entry) => entry.field00))].join(', ')}`,
    )
    console.log(
      `Unknown +0x10 values: ${[...new Set(archive.entries.map((entry) => entry.field10))].join(', ')}`,
    )
    const alignments = [2, 4, 8, 16, 512, 2048]
    console.log(
      `Aligned offsets: ${alignments.map((alignment) => `${alignment}=${archive.entries.filter((entry) => entry.dataOffset % alignment === 0).length}/${archive.entries.length}`).join(', ')}`,
    )
    const gaps = archive.entries.map((entry, index) => {
      const previousEnd =
        index === 0
          ? archive.dataStart
          : archive.entries[index - 1]!.dataOffset +
            archive.entries[index - 1]!.packedSize
      return entry.dataOffset - previousEnd
    })
    console.log(
      `Offsets monotonic: ${yesNo(archive.entries.every((entry, index) => index === 0 || entry.dataOffset >= archive.entries[index - 1]!.dataOffset))}`,
    )
    console.log(`Gap values: ${[...new Set(gaps)].join(', ')}`)
    console.log('Entries (first/last):')
    const selected =
      archive.entries.length <= 6
        ? archive.entries
        : [...archive.entries.slice(0, 3), ...archive.entries.slice(-3)]
    for (const entry of selected) {
      const previousEnd =
        entry.index === 0
          ? archive.dataStart
          : archive.entries[entry.index - 1]!.dataOffset +
            archive.entries[entry.index - 1]!.packedSize
      console.log(
        `#${entry.index} offset=${entry.dataOffset} packed=${entry.packedSize} unpacked=${entry.unpackedSize} gap=${entry.dataOffset - previousEnd} name=${JSON.stringify(entry.name)} nameRaw=${entry.nameRaw.toString('hex')} dataHead=${entry.packedData.subarray(0, 16).toString('hex')}`,
      )
    }
  })

program
  .command('verify')
  .argument('<pak>')
  .action((filename: string) => {
    if (!printIssues(readPak(filename))) process.exitCode = 1
  })

program
  .command('unpack')
  .argument('<pak>')
  .option('-o, --output <directory>')
  .action((filename: string, options: { output?: string }) => {
    const buffer = readPak(filename)
    const verification = verifyPak(buffer)
    if (!verification.valid)
      throw new Error(
        verification.issues.map((issue) => issue.error).join('; '),
      )
    const archive = verification.archive!
    const destination = options.output ?? `${filename}.unpack`
    ensureEmptyDestination(destination)
    // 在创建任何文件前完成解压和目标路径检查，尽量避免失败后留下半成品。
    const seen = new Set<string>()
    const files = archive.entries.map((entry) => {
      const target = outputPath(destination, entry.name)
      const key =
        process.platform === 'win32' || process.platform === 'darwin'
          ? target.toLowerCase()
          : target
      if (seen.has(key)) throw new Error(`Output path collision: ${entry.name}`)
      seen.add(key)
      return {
        entry,
        target,
        data: decompressLzss(entry.packedData, entry.unpackedSize),
      }
    })
    fs.mkdirSync(destination, { recursive: true })
    for (const file of files) {
      fs.mkdirSync(path.dirname(file.target), { recursive: true })
      fs.writeFileSync(file.target, file.data, { flag: 'wx' })
    }
    console.log(
      `${success('Extracted')} ${files.length} files to ${path.resolve(destination)}`,
    )
  })

program
  .command('pack')
  .argument('<directory>')
  .option('-o, --output <pak>')
  .option(
    '-r, --reference <pak>',
    'preserve order and unknown fields from a PAK',
  )
  .option('-f, --force', 'overwrite output PAK')
  .action(
    (
      directory: string,
      options: { output?: string; reference?: string; force?: boolean },
    ) => {
      const output = options.output ?? defaultPackOutput(directory)
      if (isInside(directory, output))
        throw new Error('Output PAK must be outside the input directory')
      if (options.reference && isInside(directory, options.reference))
        throw new Error('Reference PAK must be outside the input directory')
      if (!options.force && fs.existsSync(output))
        throw new Error(`${output} already exists; use --force to overwrite it`)

      const scanned = scanDirectory(directory)
      const byName = new Map<string, DirectoryFile>()
      for (const file of scanned) {
        const canonical = canonicalArchiveName(file.name)
        if (byName.has(canonical))
          throw new Error(`Duplicate archive path: ${canonical}`)
        encodeFilename(canonical)
        byName.set(canonical, file)
      }

      let field08 = 0
      let field0c = 0
      let missingReferenceFiles = 0
      const entries: Array<{
        name: string
        data: Buffer
        field00?: number
        field10?: number
      }> = []
      if (options.reference) {
        const referenceBuffer = readPak(options.reference)
        const verification = verifyPak(referenceBuffer)
        if (!verification.valid)
          throw new Error(
            `Invalid reference PAK: ${verification.issues[0]?.error}`,
          )
        const reference = verification.archive!
        field08 = reference.header.field08
        field0c = reference.header.field0c
        const referenceNames = new Set<string>()
        for (const entry of reference.entries) {
          const canonical = canonicalArchiveName(entry.name)
          if (referenceNames.has(canonical))
            throw new Error(
              `Reference contains a duplicate normalized path: ${entry.name}`,
            )
          referenceNames.add(canonical)
          const file = byName.get(canonical)
          if (!file) {
            missingReferenceFiles++
            continue
          }
          entries.push({
            name: entry.name,
            data: fs.readFileSync(file.filename),
            field00: entry.field00,
            field10: entry.field10,
          })
          byName.delete(canonical)
        }
      }
      const additions = [...byName.entries()].sort(([left], [right]) =>
        comparePakFilenames(left, right),
      )
      if (!options.reference)
        console.warn(
          `${warning('Warning:')} no reference PAK; using deterministic filename order and zero unknown fields`,
        )
      else {
        if (missingReferenceFiles > 0)
          console.warn(
            `${warning('Warning:')} ${missingReferenceFiles} reference file(s) are absent and will be omitted`,
          )
        if (additions.length > 0)
          console.warn(
            `${warning('Warning:')} ${additions.length} new file(s) will be appended with zero unknown fields`,
          )
      }
      for (const [name, file] of additions)
        entries.push({ name, data: fs.readFileSync(file.filename) })

      const pak = buildPak({ entries, field08, field0c })
      fs.writeFileSync(output, pak, { flag: options.force ? 'w' : 'wx' })
      console.log(
        `${success('Packed')} ${entries.length} files to ${path.resolve(output)}`,
      )
    },
  )

program
  .command('test-roundtrip')
  .argument('<pak>')
  .action((filename: string) => {
    const originalBuffer = readPak(filename)
    const verification = verifyPak(originalBuffer)
    if (!verification.valid)
      throw new Error(
        `Original verification failed: ${verification.issues[0]?.error}`,
      )
    const original = verification.archive!
    // 全流程在内存中执行，比较的是重建前后逐条目解压内容，而非压缩流本身。
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
    const result = comparePaks(originalBuffer, rebuilt)
    console.log(`Original files: ${original.entries.length}`)
    console.log(`Original verify: ${success('PASS')}`)
    console.log(`Repack: ${success('PASS')}`)
    console.log(`Repacked verify: ${success('PASS')}`)
    console.log(
      `Roundtrip: ${result.matchedFiles}/${result.totalFiles} ${result.logicalMatch ? success('MATCH') : failure('MISMATCH')}`,
    )
    if (!result.logicalMatch) process.exitCode = 1
  })

program
  .command('compare')
  .argument('<original>')
  .argument('<generated>')
  .action((original: string, generated: string) => {
    const result = comparePaks(readPak(original), readPak(generated))
    console.log(
      `Logical match: ${result.logicalMatch ? success('YES') : failure('NO')}`,
    )
    console.log(
      `Binary identical: ${result.binaryIdentical ? success('YES') : warning('NO')}`,
    )
    console.log(
      `Files matched: ${result.matchedFiles === result.totalFiles ? success(`${result.matchedFiles}/${result.totalFiles}`) : failure(`${result.matchedFiles}/${result.totalFiles}`)}`,
    )
    if (result.differences.length > 0)
      console.warn(
        `${warning('Differences:')} ${warning(result.differences.join(', '))}`,
      )
    if (!result.logicalMatch) process.exitCode = 1
  })

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(
    `${chalk.red.bold('Error:')} ${failure(error instanceof Error ? error.message : String(error))}`,
  )
  process.exitCode = 1
})
