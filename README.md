# atetc

`atetc` is an AskTao PAK archive toolkit: a Node.js CLI and TypeScript library for inspecting, analyzing, verifying, unpacking, comparing, and rebuilding archives.

Its compatibility is verified against the 12 production PAK samples in this repository. This evidence covers several archive types and layouts, but does not imply support for every historical or unknown AskTao PAK variant.

## Features

- Inspect archive metadata, entries, and binary layout with `info`, `list`, and `inspect`.
- Analyze observed format characteristics in human-readable or JSON form with `analyze`.
- Validate archive structure and payload streams with `verify`.
- Extract and rebuild archives with `unpack` and `pack`, including reference-preserving rebuilds.
- Compare logical contents, indexed structure, and complete binary representation with `compare`.
- Exercise an in-memory rebuild with `test-roundtrip`.

## Compatibility

The regression suite covers 12 production archives from AAA, CCS, CSA, DBA, and GS. The verified samples include:

- `etc.pak`
- `lib_aaa32.pak`, `lib_ccs32.pak`, `lib_csa32.pak`, `lib_dba32.pak`, and `lib_gs32.pak`
- `server_animates.pak` and `server_maps.pak`

Together, these fixtures exercise flat and recursive directory archives, stored entries, genuine zero-byte stored files, LZSS entries, mixed LZSS profiles, zero-payload entries, deep directory trees, and reference-preserving byte-identical rebuilds.

These results establish compatibility with the checked-in fixtures, not a guarantee for every unknown version or historical PAK variant. See [PAK format research](docs/pak-format-analysis.md) for the evidence and the distinction between confirmed, strongly supported, and unknown characteristics.

## Requirements

- Node.js 22 or newer
- pnpm 10 for development

## Installation

The current release is a prerelease published under the `alpha` dist-tag:

```bash
npm install --global @ringotangs/atetc@alpha
npx @ringotangs/atetc@alpha --version
```

The globally installed executable remains `atetc`.

## CLI

```bash
atetc info lib_gs32.pak
atetc list server_maps.pak --long
atetc inspect etc.pak
atetc analyze server_maps.pak
atetc analyze server_maps.pak --json
atetc verify lib_gs32.pak
atetc unpack lib_gs32.pak -o lib_gs32.pak.unpack
atetc pack lib_gs32.pak.unpack -o rebuilt.pak
atetc pack lib_gs32.pak.unpack -o compatible.pak --reference lib_gs32.pak
atetc compare lib_gs32.pak compatible.pak
atetc test-roundtrip server_animates.pak
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

Some legacy PAK files contain file-type entries with a packed size of zero and a nonzero original size. `unpack` skips these opaque zero-payload entries instead of creating fake empty files and reports how many were skipped; genuine zero-byte stored files are still created normally. Their position and metadata are preserved by a reference rebuild.

### Analyze archive format

`atetc analyze archive.pak` reports observed header values, `field00` and `field10` statistics, payload types, LZSS profiles, entry ordering, data layout, directory structure, filename field characteristics, and zero-payload entries. Add `--json` for structured output suitable for diagnostics, research, or CI reporting.

Analysis does not promote an observation into format semantics. Unknown fields remain named `field08`, `field0c`, and `field10`; evidence and limitations are documented in [PAK format research](docs/pak-format-analysis.md).

### Understanding compare results

Use `atetc compare original.pak rebuilt.pak --verbose` to inspect the first 20 entry-order, metadata, size, and offset differences. Logical comparison is path-based, so physical ordering differences do not make otherwise identical file contents mismatch.

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

PAK files share the same LZSS decoding format, but different archives may use the compatible `asktao-17` or `okumura-18` encoder profile. With `--reference`, atetc detects and preserves the original profile when possible; unchanged files preferentially reuse their original compressed streams. Stored reference files remain stored when modified.

## Library API

```ts
import {
  analyzePak,
  buildPak,
  compressLzss,
  decompressLzss,
  detectLzssProfile,
  parsePak,
  readPakEntryData,
  summarizePakAnalyses,
  verifyPak,
} from '@ringotangs/atetc'

const archive = parsePak(buffer)
const analysis = analyzePak(archive)
const summary = summarizePakAnalyses([analysis])
```

Core archive and compression APIs operate on `Buffer` values and do not perform file I/O. Analysis results are structured data without payload `Buffer` values and can be used for diagnostics, format research, CI reporting, and archive comparison tooling.

## Format research

[PAK format research](docs/pak-format-analysis.md) records the results from all 12 production fixtures under Confirmed, Strongly Supported, and Unknown headings. In particular, timestamp-like evidence does not rename `field10` or define its final semantics.

## Development

```bash
pnpm check
pnpm build
pnpm pack:check
```

[简体中文](./README.zh-CN.md)
