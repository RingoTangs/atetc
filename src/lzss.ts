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
  const dictionary = Buffer.alloc(LZSS_WINDOW_SIZE, LZSS_INITIAL_BYTE)
  // 按首字节维护字典位置集合，减少无意义比较，但不会漏掉任何有效匹配。
  const positions = Array.from({ length: 256 }, () => new Set<number>())
  for (let position = 0; position < LZSS_WINDOW_SIZE; position++)
    positions[LZSS_INITIAL_BYTE]!.add(position)
  const chunks: number[] = []
  let dictionaryPosition = LZSS_INITIAL_POSITION
  let inputPosition = 0
  // 覆盖环形字典槽位时同步维护候选索引，保证索引始终反映当前字典内容。
  const writeDictionary = (value: number): void => {
    const previous = dictionary[dictionaryPosition]!
    if (previous !== value) {
      positions[previous]!.delete(dictionaryPosition)
      dictionary[dictionaryPosition] = value
      positions[value]!.add(dictionaryPosition)
    }
    dictionaryPosition = (dictionaryPosition + 1) & (LZSS_WINDOW_SIZE - 1)
  }

  while (inputPosition < input.length) {
    // 先预留 flag 字节，确定这一组 token 后再回填对应 bit。
    const flagOffset = chunks.length
    chunks.push(0)
    let flags = 0
    for (let bit = 0; bit < 8 && inputPosition < input.length; bit++) {
      const limit = Math.min(LZSS_MAX_MATCH, input.length - inputPosition)
      let bestLength = 0
      let bestPosition = 0
      if (limit >= LZSS_MIN_MATCH) {
        for (const candidate of positions[input[inputPosition]!]!) {
          let length = 0
          while (length < limit) {
            const sourcePosition = (candidate + length) & (LZSS_WINDOW_SIZE - 1)
            let value = dictionary[sourcePosition]!
            // 解码器允许 match 自引用。若候选位置已被本次 match 的前序字节覆盖，
            // 比较时必须读取即将写入的输入字节，才能与真实解码过程保持一致。
            for (let earlier = 0; earlier < length; earlier++) {
              if (
                ((dictionaryPosition + earlier) & (LZSS_WINDOW_SIZE - 1)) ===
                sourcePosition
              ) {
                value = input[inputPosition + earlier]!
                break
              }
            }
            if (value !== input[inputPosition + length]) break
            length++
          }
          if (
            length > bestLength ||
            (length === bestLength && candidate < bestPosition)
          ) {
            bestLength = length
            bestPosition = candidate
          }
        }
      }
      if (bestLength >= LZSS_MIN_MATCH) {
        // match token：低字节保存位置低 8 bit，高字节保存位置高 4 bit 和长度。
        chunks.push(
          bestPosition & 0xff,
          ((bestPosition >> 4) & 0xf0) | (bestLength - LZSS_MIN_MATCH),
        )
        for (let index = 0; index < bestLength; index++)
          writeDictionary(input[inputPosition + index]!)
        inputPosition += bestLength
      } else {
        // flag bit 为 1 表示 literal，字节原样写入压缩流和字典。
        flags |= 1 << bit
        const value = input[inputPosition++]!
        chunks.push(value)
        writeDictionary(value)
      }
    }
    chunks[flagOffset] = flags
  }
  return Buffer.from(chunks)
}
