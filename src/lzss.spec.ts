import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { compressLzss, decompressLzss } from './lzss'

function roundtrip(input: Buffer): Buffer {
  const compressed = compressLzss(input)
  expect(decompressLzss(compressed, input.length)).toEqual(input)
  return compressed
}

describe('lZSS', () => {
  it.each([
    Buffer.alloc(0),
    Buffer.from('ABC'),
    Buffer.from('ABCABCABCABCABCABC'),
    Buffer.alloc(1000, 0x20),
    Buffer.from(Array.from({ length: 256 }, (_, index) => index)),
  ])('round-trips representative input %#', (input) => {
    roundtrip(input)
  })

  it('uses match tokens for repeated input', () => {
    const input = Buffer.from('ABCABCABCABCABCABC')
    expect(roundtrip(input).length).toBeLessThan(
      input.length + Math.ceil(input.length / 8),
    )
  })

  it('round-trips deterministic pseudo-random buffers', () => {
    let state = 0x12345678
    for (const length of [1, 7, 8, 9, 17, 18, 19, 127, 1024]) {
      const input = Buffer.alloc(length)
      for (let index = 0; index < length; index++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        input[index] = state & 0xff
      }
      roundtrip(input)
    }
  })

  it('rejects truncated and oversized streams', () => {
    expect(() => decompressLzss(Buffer.from([1]), 1)).toThrow('Unexpected EOF')
    expect(() => decompressLzss(Buffer.from([1, 65, 66]), 1)).toThrow(
      'trailing',
    )
    expect(() => decompressLzss(Buffer.from([0, 0, 0]), 1)).toThrow('exceeds')
  })
})
