export function expandOperationShortcut(argv: readonly string[]): string[] {
  const expanded = [...argv]
  // Commander 会把以连字符开头的内容视为选项，因此在解析前转换操作简写。
  if (expanded[2] === '-c') expanded[2] = 'pack'
  else if (expanded[2] === '-x') expanded[2] = 'unpack'
  return expanded
}
