#!/usr/bin/env node
// dsh-code-finder CLI entry. Zero deps: boots the compiled CLI and forwards
// argv; exit code propagates.
import { runCli } from '../lib/cli.js'

void runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code
}).catch((error) => {
  console.error('dsh-code-finder:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})