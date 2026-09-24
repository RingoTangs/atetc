// PAK 固定布局：16 字节头部，后接若干个 64 字节索引项。
export const PAK_MAGIC = 0x11223344
export const HEADER_SIZE = 16
export const ENTRY_SIZE = 64
export const FILENAME_OFFSET = 20
export const FILENAME_SIZE = ENTRY_SIZE - FILENAME_OFFSET
export const FILENAME_ENCODING = 'gb18030'

// field00 的低 31 位表示条目种类，最高位表示文件 payload 未压缩存储。
export const ENTRY_KIND_FILE = 0
export const ENTRY_KIND_DIRECTORY = 1
export const ENTRY_FLAG_STORED = 0x80000000
export const ENTRY_KIND_MASK = 0x7fffffff

// 经典 LZSS 参数。初始写入位置特意留出最大匹配长度的空间。
export const LZSS_WINDOW_SIZE = 4096
export const LZSS_MAX_MATCH = 18
export const LZSS_THRESHOLD = 2
export const LZSS_MIN_MATCH = LZSS_THRESHOLD + 1
export const LZSS_INITIAL_BYTE = 0x20
export const LZSS_INITIAL_POSITION = LZSS_WINDOW_SIZE - LZSS_MAX_MATCH
