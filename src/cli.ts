#!/usr/bin/env node
import process from 'node:process'
import chalk from 'chalk'
import { expandOperationShortcut } from './cli/arguments'
import { failure } from './cli/output'
import { createCliProgram } from './cli/program'

createCliProgram()
  .parseAsync(expandOperationShortcut(process.argv))
  .catch((error: unknown) => {
    console.error(
      `${chalk.red.bold('Error:')} ${failure(error instanceof Error ? error.message : String(error))}`,
    )
    process.exitCode = 1
  })
