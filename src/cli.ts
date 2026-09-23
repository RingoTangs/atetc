#!/usr/bin/env node
import type { Buffer } from 'node:buffer'
import type { PakBuildEntry, PakEntry } from './pak'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import { Command } from 'commander'
import { expandOperationShortcut } from './cli-arguments'
import { comparePaks } from './compare'
import {
  ENTRY_SIZE,
  FILENAME_ENCODING,
  FILENAME_OFFSET,
  HEADER_SIZE,
} from './constants'
import { decompressLzss } from './lzss'
import {
  buildPak,
  comparePakFilenames,
  encodeFilename,
  flattenPakEntries,
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

function lstatIfExists(
  filename: string,
): ReturnType<typeof fs.lstatSync> | undefined {
  try {
    return fs.lstatSync(filename)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined
    throw error
  }
}

function assertExistingDirectoryPath(filename: string): void {
  const stats = lstatIfExists(filename)
  if (!stats) return
  if (stats.isSymbolicLink())
    throw new Error(`Extraction path contains a symbolic link: ${filename}`)
  if (!stats.isDirectory())
    throw new Error(`Extraction path is not a directory: ${filename}`)
}

function preflightExtraction(
  destination: string,
  entries: readonly PakEntry[],
): {
  directories: string[]
  files: Array<{ entry: PakEntry; target: string; data: Buffer }>
} {
  const root = path.resolve(destination)
  assertExistingDirectoryPath(root)
  const planned = new Map<string, 'file' | 'directory'>()
  const targets = new Map<string, string>()
  const directories = new Set<string>()
  const files: Array<{ entry: PakEntry; target: string; data: Buffer }> = []
  const keyFor = (filename: string): string =>
    process.platform === 'win32' || process.platform === 'darwin'
      ? filename.toLowerCase()
      : filename

  for (const entry of flattenPakEntries(entries)) {
    const target = outputPath(root, entry.path)
    const relative = path.relative(root, target)
    const segments = relative.split(path.sep)
    for (let index = 0; index < segments.length - 1; index++) {
      const directory = path.join(root, ...segments.slice(0, index + 1))
      const key = keyFor(directory)
      if (planned.get(key) === 'file')
        throw new Error(`Output path collision: ${entry.path}`)
      planned.set(key, 'directory')
      targets.set(key, directory)
      directories.add(directory)
    }
    const key = keyFor(target)
    const expectedType = entry.type
    const previousType = planned.get(key)
    if (previousType && previousType !== expectedType)
      throw new Error(`Output path collision: ${entry.path}`)
    if (previousType === 'file')
      throw new Error(`Output path collision: ${entry.path}`)
    planned.set(key, expectedType)
    targets.set(key, target)
    if (entry.type === 'directory') directories.add(target)
    else
      files.push({
        entry,
        target,
        data: decompressLzss(entry.packedData, entry.unpackedSize),
      })
  }

  // 在真正创建目录前检查所有既有路径，避免合并解包时穿过符号链接或覆盖文件。
  for (const [key, expectedType] of planned) {
    const target = targets.get(key)!
    const stats = lstatIfExists(target)
    if (!stats) continue
    if (stats.isSymbolicLink())
      throw new Error(`Extraction path contains a symbolic link: ${target}`)
    if (expectedType === 'file')
      throw new Error(`Output file already exists: ${target}`)
    if (!stats.isDirectory())
      throw new Error(`Extraction path is not a directory: ${target}`)
  }
  return {
    directories: [...directories].sort(
      (left, right) => left.length - right.length,
    ),
    files,
  }
}

function defaultPackOutput(directory: string): string {
  return directory.endsWith('.pak.unpack')
    ? `${directory.slice(0, -'.pak.unpack'.length)}.repacked.pak`
    : `${directory}.pak`
}

interface ScannedEntry {
  name: string
  path: string
  filename: string
  type: 'file' | 'directory'
  children?: ScannedEntry[]
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function scanDirectory(directory: string): ScannedEntry[] {
  const root = path.resolve(directory)
  const rootStats = fs.lstatSync(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink())
    throw new Error(`Pack input is not a regular directory: ${directory}`)
  const visit = (current: string, segments: string[]): ScannedEntry[] => {
    const entries: ScannedEntry[] = []
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const filename = path.join(current, item.name)
      const nextSegments = [...segments, item.name]
      if (item.isSymbolicLink())
        throw new Error(`Symbolic links are not supported: ${filename}`)
      encodeFilename(item.name)
      if (item.isDirectory())
        entries.push({
          name: item.name,
          path: nextSegments.join('/'),
          filename,
          type: 'directory',
          children: visit(filename, nextSegments),
        })
      else if (item.isFile())
        entries.push({
          name: item.name,
          path: nextSegments.join('/'),
          filename,
          type: 'file',
        })
      else throw new Error(`Unsupported directory entry: ${filename}`)
    }
    return entries.sort((left, right) =>
      comparePakFilenames(left.name, right.name),
    )
  }
  return visit(root, [])
}

function flattenScannedEntries(
  entries: readonly ScannedEntry[],
): ScannedEntry[] {
  const flattened: ScannedEntry[] = []
  const visit = (items: readonly ScannedEntry[]): void => {
    for (const entry of items) {
      flattened.push(entry)
      if (entry.children) visit(entry.children)
    }
  }
  visit(entries)
  return flattened
}

function toBuildEntry(entry: ScannedEntry): PakBuildEntry {
  if (entry.type === 'directory')
    return {
      name: entry.name,
      children: entry.children!.map(toBuildEntry),
    }
  return { name: entry.name, data: fs.readFileSync(entry.filename) }
}

interface ReferenceBuildStats {
  reusedFiles: number
  recompressedFiles: number
  missingEntries: number
  addedEntries: number
}

function referenceFields(
  entry: PakEntry,
): Pick<PakBuildEntry, 'field00' | 'field10' | 'filenameField'> {
  return {
    field00: entry.field00,
    field10: entry.field10,
    filenameField: entry.raw.subarray(FILENAME_OFFSET),
  }
}

function buildReferencedFile(
  reference: PakEntry,
  scanned: ScannedEntry,
  stats: ReferenceBuildStats,
  name = reference.name,
): PakBuildEntry {
  const data = fs.readFileSync(scanned.filename)
  const referenceData = decompressLzss(
    reference.packedData,
    reference.unpackedSize,
  )
  const unchanged = data.equals(referenceData)
  if (unchanged) stats.reusedFiles++
  else stats.recompressedFiles++
  return {
    name,
    data,
    ...referenceFields(reference),
    packedData: unchanged ? reference.packedData : undefined,
  }
}

function rebuildEntry(entry: PakEntry): PakBuildEntry {
  if (entry.type === 'directory')
    return {
      name: entry.name,
      children: entry.children!.map(rebuildEntry),
      ...referenceFields(entry),
    }
  return {
    name: entry.name,
    data: decompressLzss(entry.packedData, entry.unpackedSize),
    ...referenceFields(entry),
  }
}

function mergeReferenceTree(
  referenceEntries: readonly PakEntry[],
  scannedEntries: readonly ScannedEntry[],
  stats: ReferenceBuildStats,
): PakBuildEntry[] {
  const remaining = new Map<string, ScannedEntry>()
  for (const entry of scannedEntries) {
    const key = canonicalArchiveName(entry.name)
    if (remaining.has(key))
      throw new Error(`Duplicate archive path: ${entry.path}`)
    remaining.set(key, entry)
  }
  const result: PakBuildEntry[] = []
  for (const reference of referenceEntries) {
    const key = canonicalArchiveName(reference.name)
    const scanned = remaining.get(key)
    if (!scanned) {
      stats.missingEntries += flattenPakEntries([reference]).length
      continue
    }
    if (reference.type !== scanned.type)
      throw new Error(
        `Reference type differs from input directory: ${reference.path}`,
      )
    remaining.delete(key)
    if (reference.type === 'directory')
      result.push({
        name: reference.name,
        children: mergeReferenceTree(
          reference.children!,
          scanned.children!,
          stats,
        ),
        ...referenceFields(reference),
      })
    else result.push(buildReferencedFile(reference, scanned, stats))
  }
  const additions = [...remaining.values()].sort((left, right) =>
    comparePakFilenames(left.name, right.name),
  )
  stats.addedEntries += flattenScannedEntries(additions).length
  result.push(...additions.map(toBuildEntry))
  return result
}

function mergeFlatReference(
  referenceEntries: readonly PakEntry[],
  scannedEntries: readonly ScannedEntry[],
  stats: ReferenceBuildStats,
): PakBuildEntry[] {
  const files = flattenScannedEntries(scannedEntries).filter(
    (entry) => entry.type === 'file',
  )
  const remaining = new Map<string, ScannedEntry>()
  for (const file of files) {
    const key = canonicalArchiveName(file.path)
    if (remaining.has(key)) throw new Error(`Duplicate archive path: ${key}`)
    remaining.set(key, file)
  }
  const result: PakBuildEntry[] = []
  for (const reference of referenceEntries) {
    const key = canonicalArchiveName(reference.name)
    const scanned = remaining.get(key)
    if (!scanned) {
      stats.missingEntries++
      continue
    }
    remaining.delete(key)
    result.push(buildReferencedFile(reference, scanned, stats))
  }
  const additions = [...remaining.entries()].sort(([left], [right]) =>
    comparePakFilenames(left, right),
  )
  stats.addedEntries += additions.length
  for (const [name, file] of additions) {
    encodeFilename(name)
    result.push({ name, data: fs.readFileSync(file.filename) })
  }
  return result
}

function canonicalArchiveName(name: string): string {
  return safeRelativePath(name).split(path.sep).join('/')
}

function printIssues(buffer: Buffer): boolean {
  const result = verifyPak(buffer)
  if (result.valid) {
    console.log(
      `${success('PASS')}: ${result.archive!.entryCount} entries verified`,
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
  .showSuggestionAfterError()
  .addHelpText(
    'after',
    `\nOperation shortcuts:\n  -c <directory> [options]  same as pack\n  -x <pak> [options]        same as unpack`,
  )

program
  .command('info')
  .description('show archive metadata and compression statistics')
  .argument('<pak>')
  .action((filename: string) => {
    const archive = parsePak(readPak(filename))
    const packed = archive.files.reduce(
      (sum, entry) => sum + entry.packedSize,
      0,
    )
    const unpacked = archive.files.reduce(
      (sum, entry) => sum + entry.unpackedSize,
      0,
    )
    console.log(
      `Magic: 0x${archive.header.magic.toString(16).padStart(8, '0')}`,
    )
    console.log(`PAK size: ${archive.size}`)
    console.log(`Index size: ${archive.header.indexSize}`)
    console.log(`Root entries: ${archive.entries.length}`)
    console.log(`Directories: ${archive.directories.length}`)
    console.log(`Files: ${archive.files.length}`)
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
  .alias('ls')
  .description('list files in archive order')
  .argument('<pak>')
  .option('-l, --long', 'show sizes and compression ratio')
  .action((filename: string, options: { long?: boolean }) => {
    const archive = parsePak(readPak(filename))
    const entries = flattenPakEntries(archive.entries)
    if (!options.long)
      for (const entry of entries)
        console.log(entry.type === 'directory' ? `${entry.path}/` : entry.path)
    else {
      console.log('INDEX  PACKED  ORIGINAL  RATIO    NAME')
      for (const entry of entries)
        console.log(
          `${String(entry.index).padEnd(7)}${String(entry.packedSize).padEnd(8)}${String(entry.unpackedSize).padEnd(10)}${ratio(entry.packedSize, entry.unpackedSize).padEnd(9)}${entry.type === 'directory' ? `${entry.path}/` : entry.path}`,
        )
    }
  })

program
  .command('inspect')
  .description('inspect binary layout and unknown fields')
  .argument('<pak>')
  .action((filename: string) => {
    const archive = parsePak(readPak(filename))
    const entries = flattenPakEntries(archive.entries)
    console.log(`Header hex: ${archive.header.raw.toString('hex')}`)
    console.log(
      `Header uint32: ${[archive.header.magic, archive.header.indexSize, archive.header.field08, archive.header.field0c].join(', ')}`,
    )
    console.log(
      `Root index: ${HEADER_SIZE}..${archive.dataStart} (${archive.entries.length} x ${ENTRY_SIZE})`,
    )
    console.log(
      `Entry type values: ${[...new Set(entries.map((entry) => entry.field00))].join(', ')}`,
    )
    console.log(
      `Unknown +0x10 values: ${[...new Set(entries.map((entry) => entry.field10))].join(', ')}`,
    )
    const alignments = [2, 4, 8, 16, 512, 2048]
    console.log(
      `Aligned offsets: ${alignments.map((alignment) => `${alignment}=${entries.filter((entry) => entry.dataOffset % alignment === 0).length}/${entries.length}`).join(', ')}`,
    )
    const gaps = entries.map((entry, index) => {
      const previousEnd =
        index === 0
          ? archive.dataStart
          : entries[index - 1]!.dataOffset + entries[index - 1]!.packedSize
      return entry.dataOffset - previousEnd
    })
    console.log(
      `Offsets monotonic: ${yesNo(entries.every((entry, index) => index === 0 || entry.dataOffset >= entries[index - 1]!.dataOffset))}`,
    )
    console.log(`Gap values: ${[...new Set(gaps)].join(', ')}`)
    console.log('Entries (first/last):')
    const selected =
      entries.length <= 6
        ? entries
        : [...entries.slice(0, 3), ...entries.slice(-3)]
    for (const entry of selected) {
      const previousEnd =
        entry.index === 0
          ? archive.dataStart
          : entries[entry.index - 1]!.dataOffset +
            entries[entry.index - 1]!.packedSize
      console.log(
        `#${entry.index} type=${entry.type} offset=${entry.dataOffset} packed=${entry.packedSize} unpacked=${entry.unpackedSize} gap=${entry.dataOffset - previousEnd} path=${JSON.stringify(entry.path)} nameRaw=${entry.nameRaw.toString('hex')} dataHead=${entry.packedData.subarray(0, 16).toString('hex')}`,
      )
    }
  })

program
  .command('verify')
  .alias('check')
  .description('validate archive structure and compressed streams')
  .argument('<pak>')
  .action((filename: string) => {
    if (!printIssues(readPak(filename))) process.exitCode = 1
  })

program
  .command('unpack')
  .description('extract archive files into a directory')
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
    const extraction = preflightExtraction(destination, archive.entries)
    fs.mkdirSync(destination, { recursive: true })
    for (const directory of extraction.directories)
      fs.mkdirSync(directory, { recursive: true })
    for (const file of extraction.files)
      fs.writeFileSync(file.target, file.data, { flag: 'wx' })
    console.log(
      `${success('Extracted')} ${extraction.files.length} files to ${path.resolve(destination)}`,
    )
  })

program
  .command('pack')
  .description('build an archive from a directory')
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
      let field08 = 0
      let field0c = 0
      let entries: PakBuildEntry[]
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
        const stats: ReferenceBuildStats = {
          reusedFiles: 0,
          recompressedFiles: 0,
          missingEntries: 0,
          addedEntries: 0,
        }
        entries =
          reference.directories.length === 0
            ? mergeFlatReference(reference.entries, scanned, stats)
            : mergeReferenceTree(reference.entries, scanned, stats)
        console.log(
          `${success('Reused')} ${stats.reusedFiles} unchanged compressed stream(s)`,
        )
        if (stats.recompressedFiles > 0)
          console.warn(
            `${warning('Warning:')} ${stats.recompressedFiles} modified reference file(s) will be recompressed`,
          )
        if (stats.missingEntries > 0)
          console.warn(
            `${warning('Warning:')} ${stats.missingEntries} reference entry/entries are absent and will be omitted`,
          )
        if (stats.addedEntries > 0)
          console.warn(
            `${warning('Warning:')} ${stats.addedEntries} new entry/entries will be appended with zero unknown fields`,
          )
      } else {
        entries = scanned.map(toBuildEntry)
        console.warn(
          `${warning('Warning:')} no reference PAK; using deterministic filename order and zero unknown fields`,
        )
      }

      const pak = buildPak({ entries, field08, field0c })
      fs.writeFileSync(output, pak, { flag: options.force ? 'w' : 'wx' })
      console.log(
        `${success('Packed')} ${flattenScannedEntries(scanned).filter((entry) => entry.type === 'file').length} files to ${path.resolve(output)}`,
      )
    },
  )

program
  .command('test-roundtrip')
  .alias('rt')
  .description('rebuild in memory and compare all unpacked files')
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
      entries: original.entries.map(rebuildEntry),
    })
    const result = comparePaks(originalBuffer, rebuilt)
    console.log(`Original files: ${original.files.length}`)
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
  .alias('cmp')
  .description('compare logical contents and binary representation')
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

program
  .parseAsync(expandOperationShortcut(process.argv))
  .catch((error: unknown) => {
    console.error(
      `${chalk.red.bold('Error:')} ${failure(error instanceof Error ? error.message : String(error))}`,
    )
    process.exitCode = 1
  })
