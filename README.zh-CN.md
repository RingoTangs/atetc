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
