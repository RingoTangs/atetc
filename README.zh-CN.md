# atetc

`atetc` 是用于分析、验证、解包和重新封装特定游戏 `etc.pak` 的 Node.js CLI 与 TypeScript 库。

该格式使用 16 字节小端 Header、64 字节 Index Entry、GB18030 文件名以及 4096 字节窗口的经典 LZSS 压缩。

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

`unpack` 只输出归档内的实际文件。`pack` 会递归扫描输入目录，并复现游戏使用的大小写不敏感文件名顺序，其中下划线排在字母之后。使用 `--reference` 可以从原始 PAK 保留匹配条目的顺序和未知字段。除非明确传入 `--force`，否则不会覆盖已有 PAK。

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
