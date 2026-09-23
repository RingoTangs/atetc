import { Buffer } from 'node:buffer'
import {
  LZSS_INITIAL_BYTE,
  LZSS_INITIAL_POSITION,
  LZSS_MAX_MATCH,
  LZSS_MIN_MATCH,
  LZSS_WINDOW_SIZE,
} from './constants'

export function decompressLzss(input: Buffer, expectedSize: number): Buffer {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0)
    throw new Error(`Invalid expected LZSS size: ${expectedSize}`)
  const dictionary = Buffer.alloc(LZSS_WINDOW_SIZE, LZSS_INITIAL_BYTE)
  const output = Buffer.alloc(expectedSize)
  let dictionaryPosition = LZSS_INITIAL_POSITION
  let inputPosition = 0
  let outputPosition = 0
  let flags = 0

  while (outputPosition < expectedSize) {
    // 每个 flag 字节按最低位到最高位控制后续最多 8 个 token。
    // 高 8 位补 1，使移位 8 次后能够自动触发下一次读取。
    flags >>= 1
    if ((flags & 0x100) === 0) {
      if (inputPosition >= input.length)
        throw new Error('Unexpected EOF reading LZSS flags')
      flags = input[inputPosition++]! | 0xff00
    }
    if ((flags & 1) !== 0) {
      if (inputPosition >= input.length)
        throw new Error('Unexpected EOF reading LZSS literal')
      const value = input[inputPosition++]!
      output[outputPosition++] = value
      dictionary[dictionaryPosition] = value
      dictionaryPosition = (dictionaryPosition + 1) & (LZSS_WINDOW_SIZE - 1)
      continue
    }
    if (inputPosition + 2 > input.length)
      throw new Error('Unexpected EOF reading LZSS match')
    const low = input[inputPosition++]!
    const high = input[inputPosition++]!
    // 位置占 12 bit，长度占 4 bit；长度字段 0 表示实际复制 3 字节。
    const matchPosition = low | ((high & 0xf0) << 4)
    const matchLength = (high & 0x0f) + LZSS_MIN_MATCH
    if (outputPosition + matchLength > expectedSize)
      throw new Error(`LZSS output exceeds expected size ${expectedSize}`)
    for (let index = 0; index < matchLength; index++) {
      // 逐字节读写允许源区间与当前写入区间重叠，这是该 LZSS 变体的必要行为。
      const value =
        dictionary[(matchPosition + index) & (LZSS_WINDOW_SIZE - 1)]!
      output[outputPosition++] = value
      dictionary[dictionaryPosition] = value
      dictionaryPosition = (dictionaryPosition + 1) & (LZSS_WINDOW_SIZE - 1)
    }
  }
  if (inputPosition !== input.length)
    throw new Error(
      `LZSS stream has ${input.length - inputPosition} trailing byte(s)`,
    )
  return output
}

export function compressLzss(input: Buffer): Buffer {
  if (input.length === 0) return Buffer.alloc(0)
  const nil = LZSS_WINDOW_SIZE
  const mask = LZSS_WINDOW_SIZE - 1
  // 额外的 F-1 字节用于比较环形缓冲区末尾的连续 lookahead。
  const dictionary = Buffer.alloc(
    LZSS_WINDOW_SIZE + LZSS_MAX_MATCH - 1,
    LZSS_INITIAL_BYTE,
  )
  // 经典 Okumura 实现为每个首字节维护一棵二叉搜索树。
  const left = new Int32Array(LZSS_WINDOW_SIZE + 1)
  const right = new Int32Array(LZSS_WINDOW_SIZE + 257)
  const parent = new Int32Array(LZSS_WINDOW_SIZE + 1)
  left.fill(nil)
  right.fill(nil)
  parent.fill(nil)
  let matchPosition = 0
  let matchLength = 0

  const insertNode = (position: number): void => {
    let comparison = 1
    let current = LZSS_WINDOW_SIZE + 1 + dictionary[position]!
    right[position] = nil
    left[position] = nil
    matchLength = 0
    while (true) {
      if (comparison >= 0) {
        if (right[current] !== nil) current = right[current]!
        else {
          right[current] = position
          parent[position] = current
          return
        }
      } else if (left[current] !== nil) current = left[current]!
      else {
        left[current] = position
        parent[position] = current
        return
      }

      let length = 1
      for (; length < LZSS_MAX_MATCH; length++) {
        comparison =
          dictionary[position + length]! - dictionary[current + length]!
        if (comparison !== 0) break
      }
      // 相同长度时保留最先找到的位置，这与经典 C 版本一致。
      if (length > matchLength) {
        matchPosition = current
        matchLength = length
        if (length >= LZSS_MAX_MATCH) break
      }
    }

    parent[position] = parent[current]!
    left[position] = left[current]!
    right[position] = right[current]!
    parent[left[current]!] = position
    parent[right[current]!] = position
    if (right[parent[current]!] === current) right[parent[current]!] = position
    else left[parent[current]!] = position
    parent[current] = nil
  }

  const deleteNode = (position: number): void => {
    if (parent[position] === nil) return
    let replacement: number
    if (right[position] === nil) replacement = left[position]!
    else if (left[position] === nil) replacement = right[position]!
    else {
      replacement = left[position]!
      if (right[replacement] !== nil) {
        do replacement = right[replacement]!
        while (right[replacement] !== nil)
        right[parent[replacement]!] = left[replacement]!
        parent[left[replacement]!] = parent[replacement]!
        left[replacement] = left[position]!
        parent[left[position]!] = replacement
      }
      right[replacement] = right[position]!
      parent[right[position]!] = replacement
    }
    parent[replacement] = parent[position]!
    if (right[parent[position]!] === position)
      right[parent[position]!] = replacement
    else left[parent[position]!] = replacement
    parent[position] = nil
  }

  let dictionaryStart = 0
  let dictionaryPosition = LZSS_INITIAL_POSITION
  let inputPosition = 0
  let bufferedLength = 0
  while (bufferedLength < LZSS_MAX_MATCH && inputPosition < input.length)
    dictionary[dictionaryPosition + bufferedLength++] = input[inputPosition++]!

  for (let index = 1; index <= LZSS_MAX_MATCH; index++)
    insertNode(dictionaryPosition - index)
  insertNode(dictionaryPosition)

  const output: number[] = []
  let code = Array.from<number>({ length: 17 }).fill(0)
  let codePosition = 1
  let flagMask = 1
  do {
    if (matchLength > bufferedLength) matchLength = bufferedLength
    if (matchLength < LZSS_MIN_MATCH) {
      matchLength = 1
      code[0]! |= flagMask
      code[codePosition++] = dictionary[dictionaryPosition]!
    } else {
      code[codePosition++] = matchPosition & 0xff
      code[codePosition++] =
        ((matchPosition >> 4) & 0xf0) | (matchLength - LZSS_MIN_MATCH)
    }
    flagMask <<= 1
    if (flagMask === 0x100) {
      output.push(...code.slice(0, codePosition))
      code = Array.from<number>({ length: 17 }).fill(0)
      codePosition = 1
      flagMask = 1
    }

    const consumed = matchLength
    let advanced = 0
    for (; advanced < consumed && inputPosition < input.length; advanced++) {
      const value = input[inputPosition++]!
      deleteNode(dictionaryStart)
      dictionary[dictionaryStart] = value
      if (dictionaryStart < LZSS_MAX_MATCH - 1)
        dictionary[dictionaryStart + LZSS_WINDOW_SIZE] = value
      dictionaryStart = (dictionaryStart + 1) & mask
      dictionaryPosition = (dictionaryPosition + 1) & mask
      insertNode(dictionaryPosition)
    }
    while (advanced++ < consumed) {
      deleteNode(dictionaryStart)
      dictionaryStart = (dictionaryStart + 1) & mask
      dictionaryPosition = (dictionaryPosition + 1) & mask
      bufferedLength--
      if (bufferedLength > 0) insertNode(dictionaryPosition)
    }
  } while (bufferedLength > 0)

  if (codePosition > 1) output.push(...code.slice(0, codePosition))
  return Buffer.from(output)
}
