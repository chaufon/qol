import type { EngineInterface } from 'claude-code'

/**
 * The Python commands to try, in order: `python3` on Linux and macOS, then the `py` launcher and `python` on Windows.
 * The first one that starts and is Python 3 runs the scripts; lib/__init__.py reports one older than 3.10.
 */
const PYTHONS: readonly (readonly string[])[] = [['python3'], ['py', '-3'], ['python']]
const PYTHON_PROBE = ['-c', 'import sys; print(sys.version_info[0])']
const NO_PYTHON = 'Grammar tracker needs Python 3.10 or newer as python3, py or python on the PATH'
const TIMEOUT_MS = 10_000

/**
 * The Python command found, kept while the module is loaded. A failed search is not kept, so a Python installed later
 * is found on the next run.
 */
let python: Promise<readonly string[]> | undefined

async function findPython($: EngineInterface): Promise<readonly string[]> {
  for (const candidate of PYTHONS) {
    try {
      const ran = await $.process.run([...candidate, ...PYTHON_PROBE], { timeoutMs: TIMEOUT_MS })
      if (ran.exitCode === 0 && ran.stdout.trim() === '3') return candidate
    } catch {
      // The command does not exist on this machine: try the next one.
    }
  }
  throw new Error(NO_PYTHON)
}

function pythonCommand($: EngineInterface): Promise<readonly string[]> {
  python ??= findPython($).catch((error: unknown) => {
    python = undefined
    throw error
  })
  return python
}

/**
 * Runs one of the mod's Python scripts and returns its standard output. The script finds the data folder in Claude
 * Code's plugins folder (PLUGIN_DATA in scripts/lib/config.py).
 */
export async function runScript(
  $: EngineInterface,
  script: string,
  args: string[] = [],
  stdin?: string,
): Promise<string> {
  const command = [...(await pythonCommand($)), `${$.plugin.root}/scripts/${script}`, ...args]
  const ran = await $.process.run(
    command,
    stdin === undefined ? { timeoutMs: TIMEOUT_MS } : { stdin, timeoutMs: TIMEOUT_MS },
  )
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `exit code ${ran.exitCode}`)
  return ran.stdout
}
