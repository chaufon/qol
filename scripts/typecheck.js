// Type-checks every tsconfig.json of the mods, one tsc run each, on any platform.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const configs = readdirSync('plugins')
  .flatMap(mod => [join('plugins', mod, 'tsconfig.json'), join('plugins', mod, 'tests', 'tsconfig.json')])
  .filter(config => existsSync(config))

let failed = false
for (const config of configs) {
  try {
    execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', config], { stdio: 'inherit' })
  } catch {
    failed = true
  }
}
process.exitCode = failed ? 1 : 0
