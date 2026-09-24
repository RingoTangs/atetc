import type { PakBuildEntry, PakEntry } from '../pak'
import fs from 'node:fs'
import path from 'node:path'
import { FILENAME_OFFSET } from '../constants'
import { detectLzssProfile } from '../lzss'
import {
  buildPak,
  compareFallbackPakNames,
  encodeFilename,
  flattenPakEntries,
  readPakEntryData,
  verifyPak,
} from '../pak'
import { success, warning } from './output'

export interface PackOptions {
  output?: string
  reference?: string
  force?: boolean
}

interface ScannedEntry {
  name: string
  path: string
  filename: string
  type: 'file' | 'directory'
  children?: ScannedEntry[]
}

interface ReferenceBuildStats {
  reusedFiles: number
  recompressedFiles: number
  missingEntries: number
  addedEntries: number
  unknownProfiles: number
}

function defaultPackOutput(directory: string): string {
  return directory.endsWith('.pak.unpack')
    ? `${directory.slice(0, -'.pak.unpack'.length)}.repacked.pak`
    : `${directory}.pak`
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function safeRelativePath(name: string): string {
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

function canonicalArchiveName(name: string): string {
  return safeRelativePath(name).split(path.sep).join('/')
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
      compareFallbackPakNames(left.name, right.name),
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
  const referenceData = readPakEntryData(reference)
  const unchanged = data.equals(referenceData)
  if (unchanged) stats.reusedFiles++
  else stats.recompressedFiles++
  const lzssProfile =
    !unchanged && !reference.stored
      ? detectLzssProfile(referenceData, reference.packedData)
      : undefined
  if (!unchanged && !reference.stored && lzssProfile === undefined)
    stats.unknownProfiles++
  return {
    name,
    data,
    ...referenceFields(reference),
    stored: reference.stored,
    lzssProfile,
    packedData: unchanged ? reference.packedData : undefined,
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
    compareFallbackPakNames(left.name, right.name),
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
    compareFallbackPakNames(left, right),
  )
  stats.addedEntries += additions.length
  for (const [name, file] of additions) {
    encodeFilename(name)
    result.push({ name, data: fs.readFileSync(file.filename) })
  }
  return result
}

export function packDirectory(directory: string, options: PackOptions): void {
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
    const referenceBuffer = fs.readFileSync(options.reference)
    const verification = verifyPak(referenceBuffer)
    if (!verification.valid)
      throw new Error(`Invalid reference PAK: ${verification.issues[0]?.error}`)
    const reference = verification.archive!
    field08 = reference.header.field08
    field0c = reference.header.field0c
    const stats: ReferenceBuildStats = {
      reusedFiles: 0,
      recompressedFiles: 0,
      missingEntries: 0,
      addedEntries: 0,
      unknownProfiles: 0,
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
    if (stats.unknownProfiles > 0)
      console.warn(
        `${warning('Warning:')} ${stats.unknownProfiles} modified reference file(s) use an unknown LZSS profile; falling back to asktao-17`,
      )
  } else {
    entries = scanned.map(toBuildEntry)
    console.warn(
      `${warning('Warning:')} no reference PAK; using deterministic fallback order and zero unknown fields`,
    )
  }

  const pak = buildPak({ entries, field08, field0c })
  fs.writeFileSync(output, pak, { flag: options.force ? 'w' : 'wx' })
  const fileCount = flattenScannedEntries(scanned).filter(
    (entry) => entry.type === 'file',
  ).length
  console.log(
    `${success('Packed')} ${fileCount} files to ${path.resolve(output)}`,
  )
}
