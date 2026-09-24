# atetc

`atetc` 是用于分析、验证、解包和重新封装特定游戏 `etc.pak` 的 Node.js CLI 与 TypeScript 库。

该格式使用 16 字节小端 Header、64 字节 Index Entry、GB18030 文件名，以及 raw/store 或 4096 字节窗口的经典 LZSS 压缩。同时支持 `etc.pak` 这类单层归档，以及 `lib_gs32.pak` 这类递归目录归档。

## 环境要求

- Node.js 22 或更高版本
- 开发时使用 pnpm 10

## 安装

当前版本为预发布版本，通过 `alpha` dist-tag 发布：

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

`unpack` 只输出归档内的实际文件，同时还原目录 Entry 和空目录。它允许安全合并到已有目录，但会在写入前检查全部目标；已有文件、类型冲突或符号链接都会使操作整体失败。不使用 `--reference` 时，`pack` 会递归扫描输入目录并采用确定性的 fallback 文件名顺序，使相同目录内容能够稳定生成相同输出，但不声称复现所有原版 PAK 的 Entry 顺序。使用 `--reference` 时，已有条目会尽可能保留原 PAK 的顺序和元数据，新增条目按 fallback 顺序追加，未修改文件则复用原压缩流。除非明确传入 `--force`，否则不会覆盖已有 PAK。

可以使用 `atetc compare original.pak rebuilt.pak --verbose` 查看前 20 个 Entry 顺序、元数据、大小和偏移差异。Logical compare 按完整 path 比较，因此物理顺序不同不会导致内容一致的文件被判定为不匹配。

### 理解 compare 结果

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

PAK 的 LZSS 解压格式一致，但不同资源包可能使用兼容的 `asktao-17` 或 `okumura-18` 编码 profile。使用 `--reference` 时，atetc 会尽可能检测并保留原 profile；未修改文件优先复用原压缩流，修改后的 stored/raw reference 文件仍保持 raw 存储。

部分旧版 PAK 还包含 packed size 为零、original size 非零的文件型条目。这类不透明的 zero-payload 条目不会被解包成假的空文件，但使用 reference 重建时会保留其位置和元数据。

## 库 API

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

核心 PAK 和 LZSS API 均处理 `Buffer`，不绑定文件 I/O。

## 开发检查

```bash
pnpm check
pnpm build
pnpm pack:check
```

[English](./README.md)
