/**
 * dsh-code-finder CLI — wire the component-locator into a target project.
 *
 *   npx @omdsh-dev/dsh-code-finder init      detect project type → install
 *                                            dependency (unless --no-install)
 *                                            → wire build plugins / cordis row
 *   npx @omdsh-dev/dsh-code-finder status    report current wiring + probe
 *                                            built artifacts for injection
 *   npx @omdsh-dev/dsh-code-finder remove    roll back all edits (backup
 *                                            restore, unless --no-backup)
 *
 * Zero runtime deps; argv parsing is hand-rolled. Every file edit is
 * idempotent and snapshotted to `<file>.code-finder.bak`.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import {
  ensureCordisRow,
  ensureImport,
  ensurePluginsEntry,
  removeCordisRow,
  removeImport,
  removePluginsEntry,
  restoreBackup,
  TSDOWN_IDENTIFIER,
  VITE_IDENTIFIER,
} from './config-edit'

const PACKAGE = '@omdsh-dev/dsh-code-finder'
const VITE_IMPORT = `import { codeFinderVite } from '${PACKAGE}/vite'`
const TSDOWN_IMPORT = `import { codeFinderTsdown } from '${PACKAGE}/tsdown'`
// Row id 与包内官方 patch（cordis.patch.yml）一致；幂等/删除按 name（任何 id 的
// 已有同类挂载都会被识别，避免 /code-finder/api 双注册）。disabled 表达式与
// 包内 patch 同款：宿主树里已有启用态的 dsh-code-finder 行时本行自动退避。
const CORDIS_ROW = [
  "- id: dsh-code-finder",
  "name: '@omdsh-dev/dsh-code-finder'",
  'disabled: !!js "[...ctx.loader.entries()].some((e) => e.options.name === \'@omdsh-dev/dsh-code-finder\' && e.options.id !== \'dsh-code-finder\' && !e.disabled)"',
].join('\n')

interface Options {
  readonly root: string
  readonly install: boolean
  readonly backup: boolean
  readonly quiet: boolean
  readonly link: string | undefined
}

function log(options: Options, message: string): void {
  if (!options.quiet) console.log(message)
}

function readSource(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

function writeSource(path: string, source: string): void {
  writeFileSync(path, source, 'utf8')
}

function probeConfigFiles(root: string): { readonly vite: string[], readonly tsdown: string[], readonly cordis: string[] } {
  const vite: string[] = []
  const tsdown: string[] = []
  const cordis: string[] = []
  for (const name of ['vite.config.ts', 'vite.config.mts', 'vite.config.mjs', 'vite.config.js']) {
    if (existsSync(join(root, name))) vite.push(join(root, name))
  }
  for (const name of ['tsdown.config.ts', 'tsdown.config.mjs', 'tsdown.config.js']) {
    if (existsSync(join(root, name))) tsdown.push(join(root, name))
  }
  for (const name of ['cordis.patch.yml', 'cordis.patch.yaml']) {
    if (existsSync(join(root, name))) cordis.push(join(root, name))
  }
  return { vite, tsdown, cordis }
}

function installDependency(options: Options, root: string): boolean {
  // 已装判定只查目标项目自己的 node_modules（link / workspace / registry
  // 安装都会落在这里）。不能用 require.resolve 沿上级链探测——它可能沿目录
  // 链命中 DSH-code-finder 源码仓库本身（如 be-sider 与 cf 同在 tools/ 下），
  // 造成"已装"误判而跳过真实安装。
  if (existsSync(join(root, 'node_modules', PACKAGE, 'package.json'))) return true
  const spec = options.link === undefined ? PACKAGE : `link:${options.link}`
  try {
    execFileSync('pnpm', ['add', '-D', spec], { cwd: root, stdio: options.quiet ? 'ignore' : 'inherit' })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('ERR_PNPM_FETCH_404') || message.includes('not in the npm registry') || message.includes(' 404 ')) {
      // 未发布 registry：再试 yarn/npm 只会触发 corepack 下载交互卡死——
      // 如实指引，让用户用 --link（发布前）或发布后重跑。
      log(options, '⚠ 依赖未安装：@omdsh-dev/dsh-code-finder 尚未发布到 npm registry。')
      log(options, '  发布前请加 --link 指向本地仓库（或先手动 link 安装，再 init --no-install）：')
      log(options, `    dcf init --cwd . --link <DSH-code-finder 仓库路径>`)
      return false
    }
    // 其他错误：保守尝试 yarn / npm。
    for (const [tool, args] of [['yarn', ['add', '-D', spec]], ['npm', ['install', '-D', spec]]] as const) {
      try {
        execFileSync(tool, args, { cwd: root, stdio: options.quiet ? 'ignore' : 'inherit' })
        return true
      } catch {
        /* try the next */
      }
    }
    return false
  }
}

function snapshotFile(path: string, source: string, options: Options): void {
  if (!options.backup) return
  const backup = `${path}.code-finder.bak`
  if (!existsSync(backup)) writeFileSync(backup, source, 'utf8')
}

function basenameDisplay(path: string): string {
  return path.split(/[/\\]/u).pop() ?? path
}

function wireViteFile(options: Options, path: string): string {
  let source = readSource(path) ?? ''
  if (source.includes(`${VITE_IDENTIFIER}()`)) return `  ${basenameDisplay(path)}: 已接入（无改动）`
  snapshotFile(path, source, options)
  source = ensureImport(source, VITE_IMPORT)
  const result = ensurePluginsEntry(source, VITE_IDENTIFIER, `${VITE_IDENTIFIER}()`)
  source = result.source
  writeSource(path, source)
  return `+ ${basenameDisplay(path)}: plugins 数组加入 codeFinderVite() 与 import（已备份）`
}

function wireTsdownFile(options: Options, path: string): string {
  let source = readSource(path) ?? ''
  if (source.includes(TSDOWN_IDENTIFIER)) return `  ${basenameDisplay(path)}: 已接入（无改动）`
  snapshotFile(path, source, options)
  source = ensureImport(source, TSDOWN_IMPORT)
  const result = ensurePluginsEntry(source, TSDOWN_IDENTIFIER, `${TSDOWN_IDENTIFIER}()`)
  if (!result.changed) {
    // No literal `plugins: [` array found (e.g. `plugins: cond ? [] : [...]`):
    // roll back the import we just added — a dangling unused import is worse
    // than no edit — and report truthfully.
    source = removeImport(result.source, TSDOWN_IMPORT)
    writeSource(path, source)
    return `  ${basenameDisplay(path)}: 未发现字面 plugins: [ 数组（条件式插件列表无法安全注入，未改动）`
  }
  writeSource(path, result.source)
  return `+ ${basenameDisplay(path)}: 所有 plugins 数组加入 codeFinderTsdown() 与 import（已备份）`
}

function wireCordisFile(options: Options, path: string): string {
  let source = readSource(path) ?? ''
  if (source.includes("'@omdsh-dev/dsh-code-finder'")) return `  ${basenameDisplay(path)}: 已接入（无改动）`
  snapshotFile(path, source, options)
  const result = ensureCordisRow(source, CORDIS_ROW, 'dsh-code-finder')
  source = result.source
  writeSource(path, source)
  return `+ ${basenameDisplay(path)}: 挂载一行 code-finder（双面插件）（已备份）`
}

function countInjection(source: string): number {
  return (source.match(/data-locatorjs/gu) ?? []).length
}

function probeArtifacts(root: string): number {
  let count = 0
  for (const dir of ['lib', 'dist', 'build']) {
    const base = join(root, dir)
    if (!existsSync(base)) continue
    let entries: string[]
    try {
      entries = readdirSync(base)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue
      const absolute = join(base, name)
      let stat
      try {
        stat = statSync(absolute)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      const source = readSource(absolute)
      if (source !== undefined) count += countInjection(source)
    }
  }
  return count
}

function cmdInit(options: Options): number {
  log(options, `dsh-code-finder init @ ${options.root}`)
  if (options.install) {
    log(options, '安装依赖…')
    if (!installDependency(options, options.root)) log(options, '⚠ 依赖安装失败（尝试 pnpm/yarn/npm 都不行），请手动安装')
  }
  const files = probeConfigFiles(options.root)
  if (files.vite.length === 0 && files.tsdown.length === 0 && files.cordis.length === 0) {
    log(options, '⚠ 未发现 vite.config.* / tsdown.config.* / cordis.patch.yml，无法自动接线。')
    log(options, '  （若项目用其他 bundler，请手动加 codeFinderVite() / codeFinderTsdown()）')
    return 1
  }
  for (const path of files.vite) log(options, wireViteFile(options, path))
  for (const path of files.tsdown) log(options, wireTsdownFile(options, path))
  for (const path of files.cordis) log(options, wireCordisFile(options, path))
  log(options, '')
  log(options, '✔ 接线完成。构建请用 dev 语义（NODE_ENV=development；vite dev 亦可），')
  log(options, '  生产构建不带 data-locatorjs 注入。取消接入：npx dsh-code-finder remove')
  return 0
}

function cmdStatus(options: Options): number {
  log(options, `dsh-code-finder status @ ${options.root}`)
  const files = probeConfigFiles(options.root)
  let wired = false
  const allPaths = [...files.vite, ...files.tsdown, ...files.cordis]
  if (allPaths.length === 0) {
    log(options, '  ✗ 未发现 vite.config.* / tsdown.config.* / cordis.patch.yml')
  }
  for (const path of allPaths) {
    const source = readSource(path) ?? ''
    const isWired = source.includes(VITE_IDENTIFIER) || source.includes(TSDOWN_IDENTIFIER) || source.includes('code-finder')
    wired = wired || isWired
    log(options, `  ${isWired ? '✔' : '✗'} ${basenameDisplay(path)} ${isWired ? '已接线' : '未接线'}`)
  }
  if (allPaths.length > 0 && !wired) log(options, '  → 运行 `npx @omdsh-dev/dsh-code-finder init` 接线')
  const packageJson = readSource(join(options.root, 'package.json'))
  const depInstalled = packageJson?.includes(PACKAGE) === true
  log(options, `  ${depInstalled ? '✔' : '✗'} 依赖 ${PACKAGE} ${depInstalled ? '已安装' : '未安装'}`)
  const injected = probeArtifacts(options.root)
  log(options, `  ${injected > 0 ? '✔' : '✗'} 构建产物 data-locatorjs 注入: ${injected} 处${injected === 0 && wired ? '（需以 dev 语义构建后生效）' : ''}`)
  return 0
}

function cmdRemove(options: Options): number {
  log(options, `dsh-code-finder remove @ ${options.root}`)
  const files = probeConfigFiles(options.root)
  for (const path of [...files.vite, ...files.tsdown]) {
    const backup = `${path}.code-finder.bak`
    if (options.backup && existsSync(backup)) {
      restoreBackup(path)
      log(options, `- ${basenameDisplay(path)}: 从备份还原（原样恢复）`)
      continue
    }
    const before = readSource(path) ?? ''
    let source = before
    source = removeImport(source, VITE_IMPORT)
    source = removeImport(source, TSDOWN_IMPORT)
    source = removePluginsEntry(source, VITE_IDENTIFIER)
    source = removePluginsEntry(source, TSDOWN_IDENTIFIER)
    if (source !== before) {
      writeSource(path, source)
      log(options, `- ${basenameDisplay(path)}: 已移除注入代码`)
    } else {
      log(options, `  ${basenameDisplay(path)}: 未发现注入（无改动）`)
    }
  }
  for (const path of files.cordis) {
    const backup = `${path}.code-finder.bak`
    if (options.backup && existsSync(backup)) {
      restoreBackup(path)
      log(options, `- ${basenameDisplay(path)}: 从备份还原（原样恢复）`)
      continue
    }
    const before = readSource(path) ?? ''
    const next = removeCordisRow(before, CORDIS_ROW)
    if (next !== before) {
      writeSource(path, next)
      log(options, `- ${basenameDisplay(path)}: 已移除 code-finder 行`)
    } else {
      log(options, `  ${basenameDisplay(path)}: 未发现 code-finder 行（无改动）`)
    }
  }
  log(options, '  依赖未自动卸载（保险）；需移除时执行：')
  log(options, `    pnpm remove ${PACKAGE}  # 或对应包管理器`)
  return 0
}

function resolveRoot(explicit: string | undefined): string {
  if (explicit === undefined) return resolve(process.cwd())
  if (isAbsolute(explicit)) return explicit
  return resolve(process.cwd(), explicit)
}

function parseArgs(args: readonly string[]): { command: string | undefined, options: Options } {
  let command: string | undefined
  let root = resolve(process.cwd())
  let install = true
  let backup = true
  let quiet = false
  let link: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue
    switch (arg) {
      case 'init': case 'status': case 'remove':
        command = arg
        break
      case '--help': case '-h': printHelp(); return { command: '__help__', options: { root, install, backup, quiet, link } }
      case '--no-install': install = false; break
      case '--no-backup': backup = false; break
      case '--quiet': quiet = true; break
      case '--link': {
        const value = args[index + 1]
        if (value === undefined) throw new CliUsageError('--link 需要一个值（本地 DSH-code-finder 仓库路径）')
        link = resolveRoot(value)
        index += 1
        break
      }
      case '--cwd': {
        const value = args[index + 1]
        if (value === undefined) throw new CliUsageError('--cwd 需要一个值')
        root = resolveRoot(value)
        index += 1
        break
      }
      default:
        throw new CliUsageError(`未知参数: ${arg}`)
    }
  }
  return { command, options: { root, install, backup, quiet, link } }
}

/** Argument parsing failure: exits 2 at the process boundary, code-2 within runCli. */
class CliUsageError extends Error {}

/** usage line shared by parse errors and missing subcommand. */
function usage(): string {
  return 'usage: dcf (dsh-code-finder) <init|status|remove> [--cwd <dir>] [--no-install] [--no-backup] [--quiet]'
}

/** --help / -h output. */
function printHelp(): void {
  console.log('dcf — dsh-code-finder 组件定位注入一键接线 / 诊断 / 回滚')
  console.log('')
  console.log(usage())
  console.log('')
  console.log('子命令:')
  console.log('  init     检测项目类型并接线（vite/tsdown/cordis），自动备份')
  console.log('  status   诊断接线状态、依赖、产物 data-locatorjs 注入')
  console.log('  remove   回滚接线（优先从备份原样还原）')
  console.log('')
  console.log('选项:')
  console.log('  --cwd <dir>          目标项目根目录（默认当前目录）')
  console.log('  --link <path>        以 link: 协议安装依赖（包未发布 registry 时指向本地仓库）')
  console.log('  --no-install         跳过依赖安装（只改配置）')
  console.log('  --no-backup          不写 .code-finder.bak 备份')
  console.log('  --quiet              静默输出')
  console.log('  -h, --help           显示本帮助')
  console.log('')
  console.log('接线后需以 dev 语义构建（NODE_ENV=development）才产生 data-locatorjs 注入。')
}

/**
 * Programmatic entry: parse `argv` (without the node/script prefix) and run
 * the requested subcommand. Returns the process exit code.
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  let command: string | undefined
  let options: Options
  try {
    ({ command, options } = parseArgs(argv))
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`dsh-code-finder: ${error.message}`)
      console.error(usage())
      return 2
    }
    throw error
  }
  switch (command) {
    case '__help__': return 0
    case 'init': return cmdInit(options)
    case 'status': return cmdStatus(options)
    case 'remove': return cmdRemove(options)
    case undefined:
      console.error('dsh-code-finder: 缺少子命令')
      console.error(usage())
      return 2
    default:
      console.error(`dsh-code-finder: 未知子命令 "${command}"`)
      return 2
  }
}

// Direct execution (bin entry / `tsx src/cli/index.ts`): boot the CLI. Under
// vitest the module is imported instead, so the loop only runs when this file
// is the entry point.
const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === new URL(`file://${invokedPath}`).href) {
  void runCli(process.argv.slice(2)).then(code => { process.exitCode = code }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}