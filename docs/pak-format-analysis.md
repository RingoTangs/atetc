# PAK format analysis

This document records evidence from the 12 production archives under
`sample/real-etc`. It distinguishes observed invariants from hypotheses. The
results are reproducible with `atetc analyze <pak>` and the tests in
`src/pak-analysis.spec.ts`.

```bash
atetc analyze sample/real-etc/gs/etc.pak
atetc analyze sample/real-etc/dba/etc.pak --json
```

`field10` values are classified as timestamp-like only when they fall between
2000-01-01 and 2035-12-31 UTC. This diagnostic range is not a format rule.
Ordering compares every root or directory block with
`compareFallbackPakNames()`. Layout gaps are measured between non-empty file
payloads and directory index blocks in physical offset order.

## Confirmed

- All 12 archives use magic `0x11223344`, a 16-byte little-endian header,
  64-byte entries, and a 44-byte filename field.
- All 9,527 observed entries use one of three `field00` values:

  | `field00`    | Count | Observed interpretation                    |
  | ------------ | ----: | ------------------------------------------ |
  | `0x00000000` | 8,919 | 8,918 LZSS files and one zero-payload file |
  | `0x00000001` |   605 | Directory entries                          |
  | `0x80000000` |     3 | Stored files                               |

  This is an observed fixture set, not a claim that no other value can exist.

- The 8,922 file entries comprise 8,918 LZSS, three stored, and one
  zero-payload entry. Every readable payload passes decompression and all 12
  archives support byte-identical reference-preserving rebuilds.
- All 605 directory entries satisfy
  `packedSize === unpackedSize === childCount * 64`. Their first child starts at
  the directory offset and every child entry follows in one contiguous
  64-byte array. Directory index blocks and file payloads are physically
  interleaved in all five `lib_*32.pak` archives.
- All 9,523 non-empty physical regions are contiguous from `dataStart`, with no
  observed padding, overlap, or trailing bytes. Entry offsets are not all
  aligned even to 2 bytes, so these samples show no fixed alignment rule.
- All filename fields are 44 bytes. The longest observed name is 40 bytes and
  40 characters. No field has non-zero data after its NUL terminator.
- The only zero-payload entry is `dba/etc.pak:etc`: `field00=0x00000000`,
  `dataOffset=6901897`, `packedSize=0`, `unpackedSize=7829223`, and
  `field10=0x59e63e14`.

## Strongly Supported

### `field10` resembles a Unix timestamp

Of 9,527 entries, 8,357 have `field10=0`. All 1,170 non-zero values fall in the
diagnostic timestamp range, spanning 2013-08-30T12:47:17Z through
2017-12-23T10:34:00Z. There are 29 distinct values including zero.

| UTC year | Entries |
| -------- | ------: |
| 2013     |      32 |
| 2016     |     167 |
| 2017     |     971 |

This is strong evidence for Unix timestamps, but it does not establish the
field's precise meaning (build time, source modification time, or something
else). The public name remains `field10`.

### LZSS encoder profiles

The current detector classifies 8,911 streams as `asktao-17`, seven as
`okumura-18`, and none as unknown. `aaa/lib_aaa32.pak`, `ccs/lib_ccs32.pak`,
`csa/lib_csa32.pak`, and `dba/lib_dba32.pak` contain both detected profiles;
`gs/lib_gs32.pak` and every flat archive contain only streams detected as
`asktao-17`. These labels follow the detector's existing precedence and do not
prove how the original tool chose an encoder.

### Ordering

547 of 617 entry blocks (88.65%) match the fallback comparator. This aggregate
is dominated by `gs/lib_gs32.pak`, where all 519 blocks match. Other libraries
and several flat archives contain nonmatching blocks, so fallback order is not
the universal original ordering algorithm.

| Archive                  | Matching blocks | Total blocks |
| ------------------------ | --------------: | -----------: |
| `aaa/etc.pak`            |               0 |            1 |
| `aaa/lib_aaa32.pak`      |               5 |           20 |
| `ccs/etc.pak`            |               1 |            1 |
| `ccs/lib_ccs32.pak`      |               6 |           24 |
| `csa/etc.pak`            |               0 |            1 |
| `csa/lib_csa32.pak`      |               8 |           29 |
| `dba/etc.pak`            |               0 |            1 |
| `dba/lib_dba32.pak`      |               6 |           18 |
| `gs/etc.pak`             |               1 |            1 |
| `gs/lib_gs32.pak`        |             519 |          519 |
| `gs/server_animates.pak` |               0 |            1 |
| `gs/server_maps.pak`     |               1 |            1 |

## Unknown

- `field08` and `field0c` are zero in every observed archive. With no variation,
  their roles and correlations cannot be inferred.
- The final semantic meaning of `field10` remains unknown despite the timestamp
  evidence.
- The original ordering algorithm for nonmatching blocks is unknown.
- The original encoder-selection policy and whether streams detected as
  `asktao-17` may also be compatible with another encoder are unknown.
- The business meaning of the DBA zero-payload entry is unknown.
- Every observed filename is ASCII. The 44-byte field is confirmed, but these
  fixtures provide no independent evidence for non-ASCII GB18030 filenames or
  their raw padding conventions.
- Continuous packing is observed, but the original builder's broader layout
  policy is unknown and consumers must not assume all archives lack padding.

## Observed samples

All header unknown fields are zero in this sample set.

| Archive                  |      Bytes |  Root | Entries | Files | Directories | `indexSize` |
| ------------------------ | ---------: | ----: | ------: | ----: | ----------: | ----------: |
| `aaa/etc.pak`            | 18,448,880 |    16 |      16 |    16 |           0 |       1,024 |
| `aaa/lib_aaa32.pak`      |    606,428 |     6 |     221 |   202 |          19 |         384 |
| `ccs/etc.pak`            |  3,998,566 |   139 |     139 |   139 |           0 |       8,896 |
| `ccs/lib_ccs32.pak`      |  1,811,721 |     6 |     332 |   309 |          23 |         384 |
| `csa/etc.pak`            |  6,956,437 |    16 |      16 |    16 |           0 |       1,024 |
| `csa/lib_csa32.pak`      |    667,936 |     6 |     182 |   154 |          28 |         384 |
| `dba/etc.pak`            |  6,947,514 |    10 |      10 |    10 |           0 |         640 |
| `dba/lib_dba32.pak`      |    512,375 |     6 |     204 |   187 |          17 |         384 |
| `gs/etc.pak`             | 19,355,054 | 1,393 |   1,393 | 1,393 |           0 |      89,152 |
| `gs/lib_gs32.pak`        | 40,217,936 |     6 |   6,825 | 6,307 |         518 |         384 |
| `gs/server_animates.pak` |      6,439 |    32 |      32 |    32 |           0 |       2,048 |
| `gs/server_maps.pak`     |    215,176 |   157 |     157 |   157 |           0 |      10,048 |
