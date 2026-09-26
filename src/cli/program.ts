import { Command } from 'commander'
import pkg from '../../package.json' with { type: 'json' }
import { analyzeArchive } from './analyze-command'
import { packDirectory } from './pack-command'
import {
  compareArchives,
  inspectArchive,
  listArchive,
  showInfo,
  testRoundtrip,
  verifyArchive,
} from './read-commands'
import { unpackArchive } from './unpack-command'

export function createCliProgram(): Command {
  const program = new Command()
    .name('atetc')
    .description(
      'Inspect, analyze, verify, unpack, compare, and rebuild AskTao PAK archives',
    )
    .version(pkg.version)
    .showSuggestionAfterError()
    .addHelpText(
      'after',
      `\nOperation shortcuts:\n  -c <directory> [options]  same as pack\n  -x <pak> [options]        same as unpack`,
    )

  program
    .command('info')
    .description('show archive metadata and compression statistics')
    .argument('<pak>')
    .action(showInfo)

  program
    .command('list')
    .alias('ls')
    .description('list files in archive order')
    .argument('<pak>')
    .option('-l, --long', 'show sizes and compression ratio')
    .action(listArchive)

  program
    .command('inspect')
    .description('inspect binary layout and unknown fields')
    .argument('<pak>')
    .action(inspectArchive)

  program
    .command('analyze')
    .description('analyze archive format characteristics')
    .argument('<pak>')
    .option('--json', 'output structured JSON')
    .action(analyzeArchive)

  program
    .command('verify')
    .alias('check')
    .description('validate archive structure and compressed streams')
    .argument('<pak>')
    .action(verifyArchive)

  program
    .command('unpack')
    .description('extract archive files into a directory')
    .argument('<pak>')
    .option('-o, --output <directory>')
    .action(unpackArchive)

  program
    .command('pack')
    .description('build an archive using deterministic fallback order')
    .argument('<directory>')
    .option('-o, --output <pak>')
    .option(
      '-r, --reference <pak>',
      'preserve existing entry order and metadata from a PAK',
    )
    .option('-f, --force', 'overwrite output PAK')
    .action(packDirectory)
    .addHelpText(
      'after',
      '\nWithout --reference, entries use deterministic fallback order.\nWith --reference, existing entries preserve the reference PAK order.',
    )

  program
    .command('test-roundtrip')
    .alias('rt')
    .description('rebuild in memory and compare all unpacked files')
    .argument('<pak>')
    .action(testRoundtrip)

  program
    .command('compare')
    .alias('cmp')
    .description('compare logical contents and binary representation')
    .argument('<original>')
    .argument('<generated>')
    .option('-v, --verbose', 'show detailed structural differences')
    .action(compareArchives)

  return program
}
