import { describe, expect, it } from 'vitest'
import { expandOperationShortcut } from './arguments'

describe('expandOperationShortcut', () => {
  it('expands the create shortcut in command position', () => {
    expect(
      expandOperationShortcut(['node', 'atetc', '-c', 'input', '-o', 'a.pak']),
    ).toEqual(['node', 'atetc', 'pack', 'input', '-o', 'a.pak'])
  })

  it('expands the extract shortcut in command position', () => {
    expect(
      expandOperationShortcut(['node', 'atetc', '-x', 'a.pak', '-o', 'output']),
    ).toEqual(['node', 'atetc', 'unpack', 'a.pak', '-o', 'output'])
  })

  it('does not reinterpret shortcuts outside command position', () => {
    const argv = ['node', 'atetc', 'pack', 'input', '-x']
    expect(expandOperationShortcut(argv)).toEqual(argv)
  })

  it('does not mutate the supplied argument array', () => {
    const argv = ['node', 'atetc', '-c', 'input']
    expandOperationShortcut(argv)
    expect(argv[2]).toBe('-c')
  })
})
