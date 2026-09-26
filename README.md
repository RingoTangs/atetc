# atetc

`atetc` is a Node.js CLI and TypeScript library for inspecting, validating, unpacking, and rebuilding the game's `etc.pak` archive format.

The format uses a 16-byte little-endian header, 64-byte index entries, GB18030 filenames, and either raw storage or classic 4096-byte-window LZSS compression. Both flat archives such as `etc.pak` and recursive directory archives such as `lib_gs32.pak` are supported.

## Requirements

- Node.js 22 or newer
- pnpm 10 for development

## Installation

The current release is a prerelease published under the `alpha` dist-tag:

```bash
npm install --global atetc@alpha
npx atetc@alpha --version
```

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

Operation shortcuts and common aliases are available for interactive use:

```bash
atetc ls etc.pak -l
atetc -x etc.pak -o output
atetc -c output -r etc.pak -o rebuilt.pak
atetc check rebuilt.pak
atetc rt rebuilt.pak
atetc cmp etc.pak rebuilt.pak
```

`-c` and `-x` must be the first argument after `atetc`. They select the `pack` and `unpack` operations respectively; combined forms such as `-cf` and `-xf` are not supported.

`unpack` writes only the files stored in the archive and recreates directory entries, including empty directories. It may merge into an existing directory after checking every destination; existing files, type conflicts, and symbolic links cause the operation to fail before writing. Without `--reference`, `pack` recursively scans its input directory and uses a deterministic fallback filename order. This makes output reproducible for the same directory contents, but does not claim to reproduce the entry order used by every original PAK. With `--reference`, existing entries preserve the original PAK order and metadata whenever possible; new entries are appended in fallback order, while unchanged files reuse their original compressed streams. Existing PAK output is never overwritten unless `--force` is supplied.

Use `atetc compare original.pak rebuilt.pak --verbose` to inspect the first 20 entry-order, metadata, size, and offset differences. Logical comparison is path-based, so physical ordering differences do not make otherwise identical file contents mismatch.

### Understanding compare results

| Result                         | Meaning                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Logical match`                | Whether directory paths, file paths and unpacked contents match. Zero-payload entries must also have matching paths and logical metadata. This is the main test of whether two archives are functionally equivalent. |
| `Structural match`             | Whether entries have the same paths, types, order, `field00`, `field10`, packed/original sizes, and data offsets. It does not require identical compressed bytes, headers, or padding.                               |
| `Binary identical`             | Whether the complete PAK buffers are byte-for-byte identical. This is the strictest result.                                                                                                                          |
| `Files matched`                | The number of extractable files whose paths and unpacked contents match.                                                                                                                                             |
| `Zero-payload entries matched` | The number of opaque zero-payload entries whose paths and key metadata match. This line appears only when either archive contains such entries.                                                                      |
| `Differences`                  | A summary of detected differences, such as entry order, metadata, sizes, offsets, compressed streams, unpacked contents, headers, or padding.                                                                        |

Common interpretations:

- All three results are `YES`: the archives are exactly identical.
- Logical is `YES`, while Structural or Binary is `NO`: the usable contents match, but compression, entry order, metadata, or physical layout differs. This is common when rebuilding without a reference archive.
- Logical and Structural are `YES`, while Binary is `NO`: paths and indexed layout match, but header bytes, padding, or compressed stream bytes may differ.
- Logical is `NO`: file paths, unpacked contents, directories, or zero-payload entries differ and should be investigated.

Only a Logical `NO` makes `compare` exit with a nonzero status. Structural and Binary `NO` results are warnings when the logical contents still match. Use `--verbose` to show up to 20 entry-order, metadata, size, and offset differences; it does not change the comparison rules. For an ordinary rebuild, Logical `YES` is the minimum success criterion. An unchanged `--reference` roundtrip can normally be expected to produce all three `YES` results.

PAK files share the same LZSS decoding format, but different archives may use the compatible `asktao-17` or `okumura-18` encoder profile. With `--reference`, atetc detects and preserves the original profile when possible; unchanged files preferentially reuse their original compressed streams. Stored/raw reference files remain stored when modified.

Some legacy PAK files also contain file-type entries with a packed size of zero and a nonzero original size. `unpack` skips these opaque zero-payload entries instead of creating fake empty files and reports how many were skipped; genuine zero-byte stored files are still created normally. Their position and metadata are preserved when rebuilding with `--reference`.

## Library

```ts
import {
  buildPak,
  compressLzss,
  decompressLzss,
  detectLzssProfile,
  parsePak,
  readPakEntryData,
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
