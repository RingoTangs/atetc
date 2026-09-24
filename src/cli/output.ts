import type { Buffer } from 'node:buffer'
import chalk from 'chalk'
import { verifyPak } from '../pak'

export function ratio(packed: number, unpacked: number): string {
  return unpacked === 0 ? '0.00%' : `${((packed / unpacked) * 100).toFixed(2)}%`
}

export function yesNo(value: boolean): string {
  return value ? 'YES' : 'NO'
}

export function success(value: string): string {
  return chalk.green(value)
}

export function failure(value: string): string {
  return chalk.red(value)
}

export function warning(value: string): string {
  return chalk.yellow(value)
}

export function printIssues(buffer: Buffer): boolean {
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
        : `Entry #${issue.entryIndex} (${issue.filename ?? '<unknown>'}), field00=${issue.field00 === undefined ? '-' : `0x${issue.field00.toString(16).padStart(8, '0')}`}, offset=${issue.offset ?? '-'}, packed=${issue.packedSize ?? '-'}, unpacked=${issue.unpackedSize ?? '-'}: `
    console.error(failure(`${prefix}${issue.error}`))
  }
  return false
}
