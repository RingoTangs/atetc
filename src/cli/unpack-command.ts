import type { Buffer } from 'node:buffer'
import type { PakEntry } from '../pak'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { flattenPakEntries, readPakEntryData, verifyPak } from '../pak'
import { success } from './output'

export interface UnpackOptions {
  output?: string
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
        data: readPakEntryData(entry),
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

export function unpackArchive(filename: string, options: UnpackOptions): void {
  const buffer = fs.readFileSync(filename)
  const verification = verifyPak(buffer)
  if (!verification.valid)
    throw new Error(verification.issues.map((issue) => issue.error).join('; '))
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
}
