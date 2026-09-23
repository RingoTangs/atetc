# atetc

`atetc` is a Node.js CLI and TypeScript library for inspecting, validating, unpacking, and rebuilding the game's `etc.pak` archive format.

The format uses a 16-byte little-endian header, 64-byte index entries, GB18030 filenames, and classic 4096-byte-window LZSS compression.

## Requirements

- Node.js 22 or newer
- pnpm 10 for development

## CLI

```bash
atetc info etc.pak
atetc list etc.pak --long
atetc inspect etc.pak
atetc verify etc.pak
atetc unpack etc.pak -o etc.pak.unpack
atetc pack etc.pak.unpack -o rebuilt.pak
atetc pack etc.pak.unpack -o compatible.pak --reference etc.pak
atetc test-roundtrip etc.pak
atetc compare etc.pak rebuilt.pak
```

Common aliases are available for interactive use:

```bash
atetc ls etc.pak -l
atetc x etc.pak -o output
atetc c output -r etc.pak -o rebuilt.pak
atetc check rebuilt.pak
atetc rt rebuilt.pak
atetc cmp etc.pak rebuilt.pak
```

`unpack` writes only the files stored in the archive. `pack` recursively scans its input directory and reproduces the game's case-insensitive filename order, where underscores sort after letters. Pass `--reference` to preserve matching entry order and metadata; unchanged files also reuse their original compressed streams, allowing an unchanged archive to be rebuilt byte-for-byte. Existing PAK output is never overwritten unless `--force` is supplied.

New and modified files use the classic Okumura binary-tree LZSS encoder that most closely matches the original game tool.

## Library

```ts
import {
  buildPak,
  compressLzss,
  decompressLzss,
  parsePak,
  verifyPak,
} from 'atetc'
```

All core archive and compression APIs operate on `Buffer` values and do not perform file I/O.

## Development

```bash
pnpm check
pnpm build
pnpm pack:check
```

[简体中文](./README.zh-CN.md)
