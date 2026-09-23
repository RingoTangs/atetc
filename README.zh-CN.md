# atetc

`atetc` 是用于分析、验证、解包和重新封装特定游戏 `etc.pak` 的 Node.js CLI 与 TypeScript 库。

该格式使用 16 字节小端 Header、64 字节 Index Entry、GB18030 文件名以及 4096 字节窗口的经典 LZSS 压缩。同时支持 `etc.pak` 这类单层归档，以及 `lib_gs32.pak` 这类递归目录归档。

## 环境要求

- Node.js 22 或更高版本
- 开发时使用 pnpm 10

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

`unpack` 只输出归档内的实际文件，同时还原目录 Entry 和空目录。它允许安全合并到已有目录，但会在写入前检查全部目标；已有文件、类型冲突或符号链接都会使操作整体失败。`pack` 会递归扫描输入目录、生成真实目录 Entry，并复现游戏使用的大小写不敏感文件名顺序，其中下划线排在字母之后。使用 `--reference` 可以从原始 PAK 保留目录树、匹配条目的顺序和元数据；未修改文件还会复用原压缩流，使未修改归档能够逐字节重建。除非明确传入 `--force`，否则不会覆盖已有 PAK。

新增或修改的文件使用最接近原游戏工具的经典 Okumura 二叉树 LZSS 编码器。

## 库 API

```ts
import {
  buildPak,
  compressLzss,
  decompressLzss,
  parsePak,
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
