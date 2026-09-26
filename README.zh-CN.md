# atetc

`atetc` 是用于检查、分析、验证、解包、比较和重新构建 AskTao PAK 归档的 Node.js CLI 与 TypeScript 库。

当前兼容能力已经由仓库内的 12 个真实生产 PAK 样本验证。这些证据覆盖了多种归档类型和布局，但不代表支持所有历史版本或未知的 AskTao PAK 变体。

## 功能

- 使用 `info`、`list` 和 `inspect` 检查归档元数据、Entry 和二进制布局。
- 使用 `analyze` 以适合阅读的文本或 JSON 分析已观察到的格式特征。
- 使用 `verify` 验证归档结构和 payload 数据流。
- 使用 `unpack` 和 `pack` 解包及重新构建归档，包括 reference-preserving rebuild。
- 使用 `compare` 比较逻辑内容、索引结构和完整二进制表示。
- 使用 `test-roundtrip` 执行内存重建检查。

## 兼容性

回归测试覆盖来自 AAA、CCS、CSA、DBA 和 GS 的 12 个真实生产归档，已验证的样本类型包括：

- `etc.pak`
- `lib_aaa32.pak`、`lib_ccs32.pak`、`lib_csa32.pak`、`lib_dba32.pak` 和 `lib_gs32.pak`
- `server_animates.pak` 和 `server_maps.pak`

这些 fixture 共同覆盖单层和递归目录归档、stored Entry、真实的 0-byte stored file、LZSS Entry、混合 LZSS profile、zero-payload Entry、深层目录树，以及 reference-preserving byte-identical rebuild。

这些结果证明当前仓库内 fixture 的兼容性，并不保证所有未知版本或历史 PAK 变体均受支持。格式证据以及 Confirmed、Strongly Supported、Unknown 的划分请参阅 [PAK 格式研究](docs/pak-format-analysis.md)。

## 环境要求

- Node.js 22 或更高版本
- 开发时使用 pnpm 10

## 安装

当前版本为预发布版本，通过 `alpha` dist-tag 发布：

```bash
npm install --global @ringotangs/atetc@alpha
npx @ringotangs/atetc@alpha --version
```

全局安装后的可执行命令仍然是 `atetc`。

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

交互使用时可以使用操作简写和常用别名：

```bash
atetc ls etc.pak -l
atetc -x etc.pak -o output
atetc -c output -r etc.pak -o rebuilt.pak
atetc check rebuilt.pak
atetc rt rebuilt.pak
atetc cmp etc.pak rebuilt.pak
```

`-c` 和 `-x` 必须是 `atetc` 后的第一个参数，分别用于选择 `pack` 和 `unpack` 操作；不支持 `-cf`、`-xf` 等组合形式。

`unpack` 只输出归档内具有实际 payload 的文件，同时还原目录 Entry 和空目录。它允许安全合并到已有目录，但会在写入前检查全部目标；已有文件、类型冲突或符号链接都会使操作整体失败。不使用 `--reference` 时，`pack` 会递归扫描输入目录并采用确定性的 fallback 文件名顺序，使相同目录内容能够稳定生成相同输出，但不声称复现所有原版 PAK 的 Entry 顺序。使用 `--reference` 时，已有 Entry 会尽可能保留原 PAK 的顺序和元数据，新增 Entry 按 fallback 顺序追加，未修改文件则复用原压缩流。除非明确传入 `--force`，否则不会覆盖已有 PAK。

部分旧版 PAK 包含 packed size 为零、original size 非零的文件型 Entry。`unpack` 会跳过这类不透明的 zero-payload Entry，不会创建假的空文件，并会报告跳过数量；真实的 0-byte stored file 仍会正常创建。reference rebuild 会保留 zero-payload Entry 的位置和元数据。

### 分析归档格式

`atetc analyze archive.pak` 会报告观察到的 header 值、`field00` 和 `field10` 统计、payload 类型、LZSS profile、Entry 排序、数据布局、目录结构、filename field 特征和 zero-payload Entry。增加 `--json` 可获得适合诊断、研究或 CI 报告的结构化输出。

分析不会把观察结果自动定义为格式语义。未知字段继续使用 `field08`、`field0c` 和 `field10`；相关证据和限制记录在 [PAK 格式研究](docs/pak-format-analysis.md) 中。

### 理解 compare 结果

可以使用 `atetc compare original.pak rebuilt.pak --verbose` 查看前 20 个 Entry 顺序、元数据、大小和 offset 差异。Logical compare 按完整 path 比较，因此物理顺序不同不会导致内容一致的文件被判定为不匹配。

| 结果                           | 含义                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Logical match`                | 目录路径、文件路径和解包后的内容是否一致；zero-payload Entry 的路径和逻辑元数据也必须一致。这是判断两个归档在功能上是否等价的主要指标。 |
| `Structural match`             | Entry 的路径、类型、顺序、`field00`、`field10`、压缩/原始大小和数据 offset 是否一致；不要求压缩字节、header 或 padding 完全相同。       |
| `Binary identical`             | 两个 PAK 是否逐字节完全相同。这是最严格的结果。                                                                                         |
| `Files matched`                | 路径和解包后内容一致的可解包文件数量。                                                                                                  |
| `Zero-payload entries matched` | 路径和关键元数据一致的 opaque zero-payload Entry 数量。仅当任一归档包含此类 Entry 时显示。                                              |
| `Differences`                  | 检测到的差异摘要，例如 Entry 顺序、元数据、大小、offset、压缩流、解包内容、header 或 padding。                                          |

常见结果可以这样理解：

- 三项都是 `YES`：两个归档完全相同。
- Logical 为 `YES`，Structural 或 Binary 为 `NO`：可用内容一致，但压缩方式、Entry 顺序、元数据或物理布局不同。不使用参考归档重建时很常见。
- Logical 和 Structural 为 `YES`，Binary 为 `NO`：路径和索引布局一致，但 header 字节、padding 或压缩流字节可能不同。
- Logical 为 `NO`：文件路径、解包内容、目录或 zero-payload Entry 不一致，需要进一步检查。

只有 Logical 为 `NO` 时，`compare` 才返回非零退出状态。如果逻辑内容一致，Structural 或 Binary 为 `NO` 只会作为警告。`--verbose` 最多显示 20 个 Entry 顺序、元数据、大小和 offset 差异，不会改变比较规则。普通重建至少应达到 Logical `YES`；未修改内容的 `--reference` roundtrip 通常可以期待三项全部为 `YES`。

PAK 的 LZSS 解压格式一致，但不同资源包可能使用兼容的 `asktao-17` 或 `okumura-18` 编码 profile。使用 `--reference` 时，atetc 会尽可能检测并保留原 profile；未修改文件优先复用原压缩流，修改后的 stored reference 文件仍保持 stored。

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

核心 PAK 和 LZSS API 均处理 `Buffer`，不绑定文件 I/O。分析结果是不包含 payload `Buffer` 的结构化数据，可用于诊断、格式研究、CI 报告和归档比较工具。

## 格式研究

[PAK 格式研究](docs/pak-format-analysis.md) 将全部 12 个生产 fixture 的结论划分为 Confirmed、Strongly Supported 和 Unknown。特别是，类似 timestamp 的证据不会导致 `field10` 被重命名或定义最终语义。

## 开发检查

```bash
pnpm check
pnpm build
pnpm pack:check
```

[English](./README.md)
