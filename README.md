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
atetc test-roundtrip etc.pak
atetc compare etc.pak rebuilt.pak
```

`unpack` writes a `manifest.json` alongside the extracted files. `pack` requires that manifest so original entry order and unknown metadata are retained. Existing PAK output is never overwritten unless `--force` is supplied.

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
