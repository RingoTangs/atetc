import { describe, expect, it, vi } from 'vitest'
import pkg from '../../package.json' with { type: 'json' }
import { createCliProgram } from './program'

describe('createCliProgram', () => {
  it('registers commands, aliases, and pack options without parsing', () => {
    const action = vi.fn()
    const program = createCliProgram().action(action)
    expect(action).not.toHaveBeenCalled()
    expect(program.version()).toBe(pkg.version)

    const commands = new Map(
      program.commands.map((command) => [command.name(), command]),
    )
    expect([...commands.keys()]).toEqual([
      'info',
      'list',
      'inspect',
      'verify',
      'unpack',
      'pack',
      'test-roundtrip',
      'compare',
    ])
    expect(commands.get('list')!.aliases()).toEqual(['ls'])
    expect(commands.get('verify')!.aliases()).toEqual(['check'])
    expect(commands.get('test-roundtrip')!.aliases()).toEqual(['rt'])
    expect(commands.get('compare')!.aliases()).toEqual(['cmp'])
    expect(commands.get('pack')!.options.map((option) => option.flags)).toEqual(
      ['-o, --output <pak>', '-r, --reference <pak>', '-f, --force'],
    )
  })
})
