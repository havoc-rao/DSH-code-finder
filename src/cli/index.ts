/**
 * dsh-code-finder CLI — wire the component-locator into a target project.
 *
 *   npx @havocrao/dsh-code-finder init      detect project type → install
 *                                            dependency (unless --no-install)
 *                                            → wire build plugins / cordis row
 *   npx @havocrao/dsh-code-finder status    report current wiring + probe
 *                                            built artifacts for injection
 *   npx @havocrao/dsh-code-finder remove    exact self-removal of the injected
 *                                            lines (never overwrites user edits)
 *   npx @havocrao/dsh-code-finder instrument <dir...> [--write] [--out <dir>]
 *                                            standalone injection for bundler-
 *                                            less projects (no build to hook)
 *   dcf roots <list|add|remove> <profile> [root...]
 *                                            manage the config.roots override
 *                                            in a DSH profile's cordis.patch.yml
 *                                            (id-targeted patch block for the
 *                                            official bundle row `dsh-code-finder`)
 *   dcf ensure <dir> --profile <name>        one-stop chain: wire the project
 *                                            (init-style) → ensure the profile
 *                                            roots override → run the dev build
 *                                            (build:dev / --script / --no-build)
 *                                            → probe the host (client bundle URL
 *                                            + search API) and print the restart
 *                                            instructions (never restarts itself)
 *   dcf status --profile <name>              also check the profile patch, the
 *                                            built-artifact injection count and
 *                                            host reachability (--host <url>)
 *
 * Zero runtime deps; argv parsing is hand-rolled. Edits are idempotent; no
 * backup files are ever written (the audit snapshot was dropped as more
 * noise than value — remove() only strips what init() added).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  ensureClientConfigEntry,
  ensureCordisRow,
  ensureImport,
  ensurePluginsEntry,
  removeCordisRow,
  removeImport,
  removePluginsEntry,
  TSDOWN_IDENTIFIER,
  VITE_IDENTIFIER,
} from './config-edit'
import { cliVersion } from './version'
import { probeHost } from './host-probe'
import { instrumentDir } from '../instrument'
import {
  ensureRoots,
  findDcfMountRowIds,
  hasInvalidOverridesBlock,
  listRoots,
  normalizeLiteralRoot,
  profilePatchPath,
  removeRoots,
  ROOTS_TARGET_ID,
  RootsEditError,
} from './roots'

const PACKAGE = '@havocrao/dsh-code-finder'
const VITE_IMPORT = `import { codeFinderVite } from '${PACKAGE}/vite'`
const TSDOWN_IMPORT = `import { codeFinderTsdown } from '${PACKAGE}/tsdown'`
// Row id 刻意与包内官方 patch（cordis.patch.yml）错开：官方行 id 是
// `dsh-code-finder`。包声明 `dsh.bundle.patch`，被 bundle 栈 reconcile 时官方
// patch 会随包自动应用——若本行也用同一 id，loader 在 include 阶段直接抛
// "duplicate loader entry id"（disabled 是运行期评估，救不了 load 期重复 id）。
// 官方行的表达式（同名异 id 行启用时退避）会读本行的 disabled——所以本行
// 的 disabled 必须只读 process.env 的静态表达式，不可引用其他行的 disabled，
// 否则两行互相读对方会无限递归（Maximum call stack size exceeded）。
// 幂等/删除按 name（任何 id 的已有同类挂载都会被识别，避免 /code-finder/api 双注册）。
// disabled 与构建期 codeFinderEnabled（src/build/transform.ts）**同一判定**：
// `!!js` 在 node 端 loader 求值，读真实 process.env——只有明确的 dev 语义才
// 挂载：`NODE_ENV === 'development'`。未设 NODE_ENV（undefined）与 production
// 一样视为非 dev → disabled=true，entry 不 apply（host 半与 client 半都不
// 挂载）——空壳 overlay 完全不存在，与"构建期无注入"一致。production 语义
// 下要挂载的接入方改用构建侧 enabled 参数（client 半跟随 define，host 半
// 用 dcf 的 roots 覆盖即可）。单行静态 disabled（只读 env、不读其他行的
// disabled）不会递归。
const CORDIS_ROW = [
  "- id: dsh-code-finder-mount",
  "name: '@havocrao/dsh-code-finder'",
  'disabled: !!js "process.env.NODE_ENV !== \'development\'"',
].join('\n')

interface Options {
  readonly root: string
  readonly install: boolean
  readonly quiet: boolean
  readonly link: string | undefined
  readonly keepDeps: boolean
  /** instrument 的目标目录（位置参数，按 --cwd root 解析）。 */
  readonly dirs: string[]
  /** instrument 时落盘（默认 dry-run 只报告）。 */
  readonly write: boolean
  /** instrument 镜像输出目录（保留相对路径，不覆盖源文件）。 */
  readonly outDir: string | undefined
  /** roots 子命令组：`dcf roots <list|add|remove> <profile> [root...]`。 */
  readonly roots: {
    sub: 'list' | 'add' | 'remove' | undefined
    profile: string | undefined
    paths: string[]
    /** roots 补丁目标挂载行 id（默认官方行 dsh-code-finder；宿主自定义 id 时用 --entry-id）。 */
    entryId: string | undefined
  }
  /** ensure 的目标项目目录（位置参数，按进程 cwd 解析为绝对路径）。 */
  readonly ensureDir: string | undefined
  /** ensure/status 的目标 DSH profile 名。 */
  readonly profile: string | undefined
  /** 宿主 base URL（默认 http://127.0.0.1:3080）。 */
  readonly host: string | undefined
  /** ensure 跳过构建阶段。 */
  readonly noBuild: boolean
  /** ensure 指定 dev 构建脚本名（默认自动识别 build:dev 等）。 */
  readonly script: string | undefined
  /** ensure 额外追加的 profile roots（可重复；默认 <dir>/src）。 */
  readonly extraRoots: string[]
  /** 跳过宿主探测（client URL / search API）。 */
  readonly noHostCheck: boolean
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
  // 含共享 preset 命名：deepseek-harness 的 client 包共用 `tsdown.client.ts`
  // （`clientConfig()` 内编所有 client 插件），dcf 应对它做 clientConfig 精准注入。
  for (const name of ['tsdown.config.ts', 'tsdown.client.ts', 'tsdown.config.mjs', 'tsdown.config.js']) {
    if (existsSync(join(root, name))) tsdown.push(join(root, name))
  }
  for (const name of ['cordis.patch.yml', 'cordis.patch.yaml']) {
    if (existsSync(join(root, name))) cordis.push(join(root, name))
  }
  return { vite, tsdown, cordis }
}

/** Recursively find cordis.patch.yml under `root` (max 4 levels, skips heavy dirs). */
function scanCordisPatch(root: string): string[] {
  const found: string[] = []
  const skip = new Set(['node_modules', 'dist', 'lib', '.git', '.codebuddy', 'build', 'coverage'])
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (skip.has(entry)) continue
      const absolute = join(dir, entry)
      let stat
      try {
        stat = statSync(absolute)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(absolute, depth + 1)
      } else if (entry === 'cordis.patch.yml' || entry === 'cordis.patch.yaml') {
        found.push(absolute)
        // 不设数量上限：诊断（status --profile 的挂载行 id 检查）需要看到全部
        // 补丁——上限会截掉后续目录的 patch（如 harness 的 web-app 排在
        // acp-app/base/headless 之后）。扫描成本受 depth≤4 + skip 集合约束。
      }
    }
  }
  walk(root, 1)
  return found
}

function installDependency(options: Options, root: string): boolean {
  // 已装判定只查目标项目自己的 node_modules（link / workspace / registry
  // 安装都会落在这里）。不能用 require.resolve 沿上级链探测——它可能沿目录
  // 链命中 DSH-code-finder 源码仓库本身（如 be-sider 与 cf 同在 tools/ 下），
  // 造成"已装"误判而跳过真实安装。
  if (existsSync(join(root, 'node_modules', PACKAGE, 'package.json'))) return true
  const spec = options.link === undefined ? PACKAGE : `link:${options.link}`
  const runPnpm = (args: readonly string[]): { ok: boolean, output: string } => {
    // stdout+stderr 都 pipe 捕获（pnpm 的警告可能写 stdout，如
    // ERR_PNPM_ADDING_TO_ROOT），非 quiet 时手动回显，兼顾显示与检测。
    const result = spawnSync('pnpm', [...args, '-D', spec], {
      cwd: root,
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    if (!options.quiet) {
      if (result.stdout !== null && result.stdout !== '') process.stdout.write(result.stdout)
      if (result.stderr !== null && result.stderr !== '') process.stderr.write(result.stderr)
    }
    return { ok: result.status === 0, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` }
  }
  const first = runPnpm(['add'])
  if (first.ok) return true
  // Workspace 子目录（如 harness 的 packages/client 共享 preset）：pnpm 拒绝
  // 裸 add（ERR_PNPM_ADDING_TO_ROOT），显式 --workspace-root 重试——preset 的
  // import 本就由「仓库根启动的 tsdown」解析，装到根正是需要的。非 workspace
  // 项目里 `-w` 会报错，无害地落到下面的 postinstall / 404 / fallback 分支。
  if (runPnpm(['add', '--workspace-root']).ok) return true
  const message = first.output
  // 目标项目自身的 postinstall 脚本失败（如 monorepo 根的 install-lefthook）：
  // pnpm 会把本次 add 整体回滚（package.json 不残留），再试 yarn/npm 只会重蹈
  // 覆辙（link: 协议下 npm 还会直接 EUNSUPPORTEDPROTOCOL）。如实指引先修脚本。
  if (message.includes('postinstall: Failed') || message.includes('ELIFECYCLE')) {
    log(options, '⚠ pnpm 解析依赖成功，但目标项目（或 workspace 根）的 postinstall 脚本失败，依赖已被 pnpm 回滚。')
    log(options, '  请先修复 postinstall（例如删除残留的安装锁文件）再重跑：')
    log(options, `    dcf init --cwd ${root}${options.link === undefined ? '' : ` --link ${options.link}`}`)
    return false
  }
  if (message.includes('ERR_PNPM_FETCH_404') || message.includes('not in the npm registry') || message.includes(' 404 ')) {
    // 未发布 registry：再试 yarn/npm 只会触发 corepack 下载交互卡死——
    // 如实指引，让用户用 --link（发布前）或发布后重跑。
    log(options, '⚠ 依赖未安装：@havocrao/dsh-code-finder 尚未发布到 npm registry。')
    log(options, '  发布前请加 --link 指向本地仓库（或先手动 link 安装，再 init --no-install）：')
    log(options, `    dcf init --cwd . --link <DSH-code-finder 仓库路径>`)
    return false
  }
  // 其他错误：保守尝试 yarn / npm。`link:` 是 pnpm/yarn 专有协议，npm 不支持
  // （EUNSUPPORTEDPROTOCOL），link 模式下跳过 npm 只试 yarn。
  const fallbacks: ReadonlyArray<readonly [string, readonly string[]]> = options.link === undefined
    ? [['yarn', ['add', '-D', spec]], ['npm', ['install', '-D', spec]]]
    : [['yarn', ['add', '-D', spec]]]
  for (const [tool, args] of fallbacks) {
    try {
      execFileSync(tool, args, { cwd: root, stdio: options.quiet ? 'ignore' : 'inherit' })
      return true
    } catch {
      /* try the next */
    }
  }
  return false
}

function basenameDisplay(path: string): string {
  return path.split(/[/\\]/u).pop() ?? path
}

function wireViteFile(path: string): string {
  let source = readSource(path) ?? ''
  if (source.includes(`${VITE_IDENTIFIER}()`)) return `  ${basenameDisplay(path)}: 已接入（无改动）`
  source = ensureImport(source, VITE_IMPORT)
  const result = ensurePluginsEntry(source, VITE_IDENTIFIER, `${VITE_IDENTIFIER}()`)
  source = result.source
  writeSource(path, source)
  return `+ ${basenameDisplay(path)}: plugins 数组加入 codeFinderVite() 与 import`
}

function wireTsdownFile(path: string): string {
  let source = readSource(path) ?? ''
  if (source.includes(TSDOWN_IDENTIFIER)) return `  ${basenameDisplay(path)}: 已接入（无改动）`
  source = ensureImport(source, TSDOWN_IMPORT)
  // Shared-preset detection (deepseek-harness `packages/client/tsdown.client.ts`
  // shape): `function clientConfig(...)` is the plugins array every client
  // plugin package builds through. Inject ONLY that array so the preset's other
  // plugins arrays (`staticLinkedConfig`, ...) stay untouched.
  const isClientPreset = /(?:^|\n)\s*(?:export\s+)?function\s+clientConfig\s*\(/u.test(source)
  const result = isClientPreset
    ? ensureClientConfigEntry(source, TSDOWN_IDENTIFIER, `${TSDOWN_IDENTIFIER}()`)
    : ensurePluginsEntry(source, TSDOWN_IDENTIFIER, `${TSDOWN_IDENTIFIER}()`)
  if (!result.changed) {
    // No literal `plugins: [` array found (e.g. `plugins: cond ? [] : [...]`):
    // roll back the import we just added — a dangling unused import is worse
    // than no edit — and report truthfully.
    source = removeImport(result.source, TSDOWN_IMPORT)
    writeSource(path, source)
    return `  ${basenameDisplay(path)}: 未发现字面 plugins: [ 数组（条件式插件列表无法安全注入，未改动）`
  }
  writeSource(path, result.source)
  return isClientPreset
    ? `+ ${basenameDisplay(path)}: clientConfig() 的 plugins 数组加入 codeFinderTsdown() 与 import（共享 preset，覆盖所有 client 包）`
    : `+ ${basenameDisplay(path)}: 所有 plugins 数组加入 codeFinderTsdown() 与 import`
}

function wireCordisFile(path: string): string {
  let source = readSource(path) ?? ''
  if (source.includes("'@havocrao/dsh-code-finder'")) return `  ${basenameDisplay(path)}: 已接入（无改动）`
  // 宿主 / 插件区分：cordis.patch.yml 顶层存在 `- id:` override 行（不在 insert
  // 块内）= 页面宿主 / 聚合层（如 web-app），挂 overlay 行；只有 `- insert:` 块
  // = 插件型（如 better-sidebar），overlay 由宿主全局提供，跳过挂载防
  // "duplicate loader entry id"（同一 mount id 在 profile 里出现两次）。
  const isHostLayer = /^-(?:\s*id:| overrides:)/mu.test(source)
  if (!isHostLayer) {
    return `  ${basenameDisplay(path)}: 插件型 patch（仅 insert 块）——overlay 由宿主提供，跳过挂载（只做构建期注入即可）`
  }
  const result = ensureCordisRow(source, CORDIS_ROW, 'dsh-code-finder')
  source = result.source
  writeSource(path, source)
  return `+ ${basenameDisplay(path)}: 挂载一行 code-finder（双面插件）`
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

/** 对探测到的所有配置文件执行接线，返回实际改动数（报告逐文件输出）。 */
function wireProjectFiles(options: Options, root: string): number {
  const files = probeConfigFiles(root)
  let changed = 0
  for (const path of files.vite) { const report = wireViteFile(path); log(options, report); if (report.startsWith('+')) changed += 1 }
  for (const path of files.tsdown) { const report = wireTsdownFile(path); log(options, report); if (report.startsWith('+')) changed += 1 }
  for (const path of files.cordis) { const report = wireCordisFile(path); log(options, report); if (report.startsWith('+')) changed += 1 }
  return changed
}

function cmdInit(options: Options): number {
  log(options, `dsh-code-finder init @ ${options.root}`)
  if (options.install) {
    log(options, '安装依赖…')
    if (!installDependency(options, options.root)) log(options, '⚠ 依赖安装失败（尝试 pnpm/yarn/npm 都不行），请手动安装')
  }
  const files = probeConfigFiles(options.root)
  if (files.vite.length === 0 && files.tsdown.length === 0 && files.cordis.length === 0) {
    log(options, '⚠ 当前目录未发现 vite.config.* / tsdown.config.* / cordis.patch.yml。')
    // Monorepo 提示：不自动越界改子目录的 patch（多仓可能多个，歧义），
    // 列出检测到的深层位置让用户用 --cwd 精确指定目标。
    const deep = scanCordisPatch(options.root)
    if (deep.length > 0) {
      log(options, `  检测到 ${deep.length} 个深层 cordis.patch.yml，请用 --cwd 指定目标：`)
      for (const path of deep.slice(0, 5)) log(options, `    dcf init --cwd ${dirname(path)}`)
    } else {
      log(options, '  （若项目用其他 bundler，请手动加 codeFinderVite() / codeFinderTsdown()）')
    }
    return 1
  }
  let changed = wireProjectFiles(options, options.root)
  log(options, '')
  if (changed === 0) {
    // cordis-only 目录（如 bundle 聚合包）：挂载已完成，但没有本目录的
    // vite/tsdown 构建配置可注入——构建在上游目录进行，如实指引去向，
    // 避免"没有可注入的目标"被误读为"接线失败"。
    if (files.cordis.length > 0 && files.vite.length === 0 && files.tsdown.length === 0) {
      log(options, '✗ 本目录仅 cordis.patch.yml（已接入）；无 vite/tsdown 构建配置，构建期 data-locatorjs 注入无处可挂。')
      log(options, '  若需注入前端产物，请对实际构建目录（如含 vite.config.* / tsdown.config.* 的包）运行：')
      log(options, `    dcf init --cwd <构建配置所在目录> --link ${options.link ?? '<DSH-code-finder 仓库路径>'}`)
      return 0
    }
    log(options, '✗ 没有可注入的目标（配置已接入 / 字面 plugins: [ 数组不存在，如实未改动）。')
    // Monorepo：当前目录的 tsdown/vite 被拒绝，但深层可能有 cordis.patch.yml
    // ——列出它们，让用户 --cwd 到具体 bundle 目录执行（多仓 patch 不自动改）。
    if (files.cordis.length === 0) {
      const deep = scanCordisPatch(options.root)
      if (deep.length > 0) {
        log(options, `  检测到 ${deep.length} 个深层 cordis.patch.yml，请用 --cwd 指定目标：`)
        for (const path of deep.slice(0, 5)) log(options, `    dcf init --cwd ${dirname(path)}`)
      }
    }
    log(options, '  若目标构建配置是条件式/预设内建（如 monorepo 共享 preset），请手动接入：')
    log(options, `    vite:   plugins: [codeFinderVite()] + import '${PACKAGE}/vite'`)
    log(options, `    tsdown: plugins: [codeFinderTsdown()] + import '${PACKAGE}/tsdown'`)
    return 0
  }
  log(options, '✔ 接线完成。构建请用 dev 语义（NODE_ENV=development；vite dev 亦可），')
  log(options, '  生产构建不带 data-locatorjs 注入。取消接入：npx dsh-code-finder remove')
  return 0
}

async function cmdStatus(options: Options): Promise<number> {
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
    if (!isWired && basenameDisplay(path).startsWith('cordis.patch')) {
      // 插件型 patch（仅 insert 块，无顶层补丁项）：overlay 由宿主提供，无需挂载行——
      // 不是「未接线」，如实标注即可（与 wireCordisFile 的判定一致）。
      const isHostLayer = /^-(?:\s*id:| overrides:)/mu.test(source)
      if (!isHostLayer) {
        log(options, `  · ${basenameDisplay(path)} 插件型 patch（insert-only，overlay 由宿主提供）`)
        continue
      }
    }
    log(options, `  ${isWired ? '✔' : '✗'} ${basenameDisplay(path)} ${isWired ? '已接线' : '未接线'}`)
  }
  if (allPaths.length > 0 && !wired) log(options, '  → 运行 `npx @havocrao/dsh-code-finder init` 接线')
  const packageJson = readSource(join(options.root, 'package.json'))
  const depInstalled = packageJson?.includes(PACKAGE) === true
  log(options, `  ${depInstalled ? '✔' : '✗'} 依赖 ${PACKAGE} ${depInstalled ? '已安装' : '未安装'}`)
  const injected = probeArtifacts(options.root)
  log(options, `  ${injected > 0 ? '✔' : '✗'} 构建产物 data-locatorjs 注入: ${injected} 处${injected === 0 && wired ? '（需以 dev 语义构建后生效）' : ''}`)

  // --profile：附加 profile patch + 宿主可达性检查（端到端验证）。
  if (options.profile !== undefined) {
    let profile: string
    try {
      profile = requireProfile(options.profile)
    } catch (error) {
      if (error instanceof CliUsageError) {
        console.error(`dsh-code-finder: ${error.message}`)
        console.error(usage())
        return 2
      }
      throw error
    }
    const { dir, patchPath } = resolveProfile(profile)
    log(options, `dcf status --profile ${profile} @ ${dir}`)
    const source = existsSync(patchPath) ? readSource(patchPath) : undefined
    if (source === undefined) {
      log(options, `  ✗ ${basenameDisplay(patchPath)} 不存在（profile 未建 or patch 缺失）`)
    } else {
      const items = listRoots(source)
      if (items === null || items.length === 0) {
        log(options, `  ✗ ${basenameDisplay(patchPath)} 无 dcf roots 覆盖（host 半使用默认 roots）`)
      } else {
        log(options, `  ✔ ${basenameDisplay(patchPath)} dcf roots 覆盖（${items.length} 条）:`)
        for (const item of items) log(options, `      ${item.raw.trim()}`)
      }
      if (hasInvalidOverridesBlock(source)) {
        log(options, '  ⚠ 检测到无效的 `- overrides:` 包裹块（loader 不识别，boot 会告警并跳过）。')
      }
      // 宿主自定义挂载行 id 诊断：roots 补丁按 id 定位，若仓库里的生效挂载行
      // 不是官方行 id（如 harness 的 dsh-code-finder-mount），按官方行写的
      // 覆盖会落到被 double-mount 守卫禁用（或不存在）的行上——静默失效。
      // 深层扫描（最多 4 层，跳过 node_modules/lib 等）：harness 型仓库的
      // 挂载行在 packages/bundle/web-app/cordis.patch.yml，不在根目录。
      const patchFiles = [...files.cordis, ...scanCordisPatch(options.root)]
      const repoRows = patchFiles.flatMap(path => findDcfMountRowIds(readSource(path) ?? ''))
      const nonDefault = [...new Set(repoRows)].filter(id => id !== ROOTS_TARGET_ID)
      if (nonDefault.length > 0) {
        log(options, `  ⚠ 检测到自定义 id 的 dcf 挂载行: ${nonDefault.join(', ')}（≠ roots 补丁目标 ${ROOTS_TARGET_ID}）。`)
        log(options, `    若生效的是这些行：dcf roots add ${profile} <src> --entry-id ${nonDefault[0] ?? ''}`)
        log(options, '    （对已禁用行打 roots 补丁是静默 no-op：config 改了，行不挂载。）')
      }
    }
    if (options.noHostCheck) {
      log(options, '  - 宿主探测跳过（--no-host-check）')
    } else {
      let pluginName: string | undefined
      try {
        pluginName = packageJson === undefined ? undefined : (JSON.parse(packageJson) as { name?: string }).name
      } catch {
        pluginName = undefined
      }
      const base = hostBase(options)
      if (pluginName === undefined || pluginName === '') {
        log(options, `  - 项目 package.json 无 name，跳过宿主 client URL 探测（--cwd 目标需是插件包根目录）`)
      } else {
        const component = probeComponentName(options.root)
        const host = await probeHost(base, pluginName, component ?? 'App')
        const clientOk = host.client.ok
        log(options, `  ${clientOk ? '✔' : '✗'} 宿主 client bundle GET ${host.client.url} → ${host.client.status ?? '不可达'}${clientOk ? '（当前 boot 已挂该插件）' : '（当前 boot 未挂该插件 client）'}`)
        if (host.search.ok && host.search.hits.length > 0) {
          const hit = host.search.hits[0]
          if (hit !== undefined) log(options, `  ✔ search API POST ${base}/code-finder/api/search {name:${component ?? 'App'}} → 命中 ${hit.file}:${String(hit.line)}（path 可见 ✓）`)
          void hit
        } else {
          const why = host.search.status === undefined
            ? '不可达（宿主未启动/非 dcf 宿主？）'
            : host.search.status !== 200
              ? `HTTP ${String(host.search.status)}（host 半未挂载？）`
              : 'ok 但索引未命中（roots 未生效/旧 boot？）'
          log(options, `  ✗ search API POST ${base}/code-finder/api/search {name:${component ?? 'App'}} → ${host.search.detail}; ${why}`)
        }
        if (!clientOk || !host.search.ok || host.search.hits.length === 0) {
          for (const line of restartHint(options.root, profile, options.host)) log(options, `  ${line}`)
        }
      }
    }
  }
  return 0
}

function cmdRemove(options: Options): number {
  log(options, `dsh-code-finder remove @ ${options.root}`)
  const files = probeConfigFiles(options.root)
  // 只精确移除 CLI 自己加的东西（import 行 / plugins 条目 / cordis 行），
  // 用户对文件的所有其它修改原样保留；不写、不读、不还原任何备份文件。
  for (const path of [...files.vite, ...files.tsdown]) {
    const before = readSource(path) ?? ''
    let source = before
    source = removeImport(source, VITE_IMPORT)
    source = removeImport(source, TSDOWN_IMPORT)
    source = removePluginsEntry(source, VITE_IDENTIFIER)
    source = removePluginsEntry(source, TSDOWN_IDENTIFIER)
    if (source !== before) {
      writeSource(path, source)
      log(options, `- ${basenameDisplay(path)}: 已移除注入（保留你的其它修改）`)
    } else {
      log(options, `  ${basenameDisplay(path)}: 未发现注入（无改动）`)
    }
  }
  for (const path of files.cordis) {
    const before = readSource(path) ?? ''
    const next = removeCordisRow(before, CORDIS_ROW)
    if (next !== before) {
      writeSource(path, next)
      log(options, `- ${basenameDisplay(path)}: 已移除 code-finder 行（保留你的其它修改）`)
    } else {
      log(options, `  ${basenameDisplay(path)}: 未发现 code-finder 行（无改动）`)
    }
  }
  uninstallDependency(options, options.root)
  return 0
}

/**
 * Remove the dependency too: `remove` is a full uninstall, not just a wiring
 * rollback. Skips silently when the package is not installed in this project
 * (the exact install detection used by {@link installDependency}).
 * @param options - CLI options (`keepDeps` opts out).
 */
function uninstallDependency(options: Options, root: string): void {
  if (options.keepDeps) return
  const packageJson = readSource(join(root, 'package.json'))
  const declared = packageJson?.includes(`"${PACKAGE}"`) === true
  const linked = existsSync(join(root, 'node_modules', PACKAGE, 'package.json'))
  if (!declared && !linked) return
  const manager = existsSync(join(root, 'yarn.lock')) ? 'yarn'
    : existsSync(join(root, 'package-lock.json')) ? 'npm' : 'pnpm'
  try {
    execFileSync(manager, manager === 'npm' ? ['uninstall', PACKAGE] : ['remove', PACKAGE], {
      cwd: root,
      stdio: options.quiet ? 'ignore' : 'inherit',
    })
    log(options, `- 依赖 ${PACKAGE} 已移除`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(options, `⚠ 依赖移除失败（${message.slice(0, 80)}）；可手动：${manager} remove ${PACKAGE}`)
  }
}

/**
 * `dcf instrument <dir...> [--write] [--out <out>]`：无 bundler 项目的独立
 * 注入。默认 dry-run（只报告）；--write 落盘（或镜像到 --out）。非 dev 语义
 * （NODE_ENV 非 development 且未显式 enabled）整体 no-op。transform 异常逐文件 warn +
 * 跳过，不中断。
 */
async function cmdInstrument(options: Options): Promise<number> {
  if (options.dirs.length === 0) {
    console.error('dsh-code-finder: instrument 需要一个或多个目录（如：dcf instrument lib --write）')
    console.error(usage())
    return 2
  }
  const root = options.root
  let changed = 0
  let errors = 0
  let total = 0
  let disabled = false
  for (const dir of options.dirs) {
    const absDir = isAbsolute(dir) ? dir : join(root, dir)
    const result = await instrumentDir(absDir, { projectRoot: root, write: options.write, outDir: options.outDir })
    disabled = disabled || result.disabled
    changed += result.changed
    errors += result.errors
    total += result.files.length
    if (!options.quiet) {
      if (result.disabled) {
        log(options, `- ${displayPath(absDir, root)}: 非 dev 语义（NODE_ENV 非 development），未注入`)
      } else {
        log(options, `- ${displayPath(absDir, root)}: ${result.changed} 注入 / ${result.unchanged} 未变 / ${result.errors} 错误`
          + (result.write ? '（已写入）' : '（dry-run）'))
        for (const file of result.files) {
          if (file.changed && file.error === undefined) log(options, `    ${displayPath(file.file, root)}`)
        }
      }
    }
  }
  if (disabled) {
    log(options, '未注入：当前非 dev 语义。以 NODE_ENV=development 运行（或构建侧显式 enabled）才会注入。')
  } else {
    log(options, `instrument 完成：${changed}/${total} 个文件注入（${options.write ? '已写入' : 'dry-run，加 --write 落盘'}），${errors} 个错误`)
  }
  return errors === 0 ? 0 : 1
}

/** 项目内路径省略展示（root 之外显示绝对路径）。 */
function displayPath(absPath: string, root: string): string {
  const rel = relative(root, absPath)
  return rel === '' || rel.startsWith('..') ? absPath : rel
}

/** DSH home：$DSH_HOME 或 ~/.dsh。 */
function dshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  return env !== undefined && env !== '' ? env : join(homedir(), '.dsh')
}

/** profile 参数合法性：只允许简单名称（防路径穿越，DSH 官方同款约定）。 */
function assertProfileName(profile: string | undefined): string {
  if (profile === undefined || profile === '') throw new CliUsageError('缺少 profile 名（如 web）')
  if (!/^[\w.-]+$/u.test(profile) || profile === '.' || profile === '..') {
    throw new CliUsageError(`非法的 profile 名: ${profile}`)
  }
  return profile
}

/** 展示用路径：js 表达式原样，literal 归一化为绝对路径。 */
function displayRoot(value: string, root: string): string {
  return value.trim().startsWith('!!js') ? value.trim() : normalizeLiteralRoot(value, root)
}

/** profile 名 → 其目录与 patch 文件路径（.yml 优先，仅 .yaml 存在时用 .yaml）。 */
function resolveProfile(profile: string): { dir: string, patchPath: string } {
  const dir = join(dshHome(), 'profiles', profile)
  return { dir, patchPath: profilePatchPath(dir) }
}

/** 校验并解析 --profile 参数（失败抛 CliUsageError）。 */
function requireProfile(profile: string | undefined): string {
  return assertProfileName(profile)
}

/**
 * 识别目标项目的 dev 构建脚本（package.json scripts）：显式 `build:dev`
 * 优先，其次 build-dev / dev:build / dev-build 等精确形态，再其次任意
 * 含 build+dev 的脚本名（按 package.json 书写顺序）。永不选择 watch/dev
 * 这类长驻脚本（名称不含 build，天然排除）。
 */
export function pickDevBuildScript(scripts: Record<string, string> | undefined): string | undefined {
  if (scripts === undefined) return undefined
  const exact = [/^build:dev$/iu, /^build-dev$/iu, /^dev:build$/iu, /^dev-build$/iu]
  for (const pattern of exact) {
    const hit = Object.keys(scripts).find(name => pattern.test(name))
    if (hit !== undefined) return hit
  }
  return Object.keys(scripts).find(name => /build.*dev|dev.*build/iu.test(name))
}

/**
 * 扫 <root>/src 找一个**会被源码索引收录**的组件名（search API 探测用）：
 * 与 src/index.ts 的 DECLARATION_PATTERN 同构（PascalCase + function / 箭头
 * 函数 / class 形态——纯字符串常量如 GUIDE_STROKE 索引不到，不能当探测目标）。
 * 优先级：.tsx 里的导出声明 > .tsx 任意声明 > 任意文件的导出声明 > 任意声明。
 */
export function probeComponentName(root: string): string | undefined {
  const base = join(root, 'src')
  if (!existsSync(base)) return undefined
  const skip = new Set(['node_modules', 'dist', 'lib', 'build', '.git', 'test-results', 'playwright-report'])
  const exts = new Set(['.tsx', '.ts', '.jsx', '.js'])
  // 与索引 DECLARATION_PATTERN 对齐（少 class 的捕获组编号差异，统一用组 1）。
  const pattern = /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:function[ \t]+([A-Z][A-Za-z0-9_$]*)[ \t]*(?:<[^>]*>)?[ \t]*\(|(?:const|let|var)[ \t]+([A-Z][A-Za-z0-9_$]*)[ \t]*=[ \t]*(?:async[ \t]+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)[ \t]*=>|class[ \t]+([A-Z][A-Za-z0-9_$]*))/gu
  let tsxExport: string | undefined
  let tsxAny: string | undefined
  let anyExport: string | undefined
  let anyAny: string | undefined
  const walk = (dir: string, depth: number): void => {
    if (depth > 5 || tsxExport !== undefined) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (tsxExport !== undefined) return
      if (skip.has(entry)) continue
      const absolute = join(dir, entry)
      let stat
      try {
        stat = statSync(absolute)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(absolute, depth + 1)
        continue
      }
      const ext = entry.slice(entry.lastIndexOf('.'))
      if (!exts.has(ext) || entry.endsWith('.d.ts')) continue
      const source = readSource(absolute)
      if (source === undefined) continue
      for (const match of source.matchAll(pattern)) {
        const name = match[1] ?? match[2] ?? match[3]
        if (name === undefined) continue
        const isTsx = ext === '.tsx' || ext === '.jsx'
        const isExport = /(?:^|\n)[ \t]*export[ \t]+/u.test((match[0] ?? '').slice(0, (match[0] ?? '').indexOf(name)))
        anyAny ??= name
        if (isExport) anyExport ??= name
        if (isTsx) tsxAny ??= name
        if (isTsx && isExport) tsxExport ??= name
      }
    }
  }
  walk(base, 0)
  return tsxExport ?? tsxAny ?? anyExport ?? anyAny
}

/** 目标项目默认的 UI 源码根：<dir>/src 存在用它，否则用项目根（并提示）。 */
function defaultUiRoot(root: string): string {
  return existsSync(join(root, 'src')) ? join(root, 'src') : root
}

/** 宿主 base URL：--host 显式值优先，默认 http://127.0.0.1:3080。 */
function hostBase(options: Options): string {
  const explicit = options.host?.trim()
  return explicit !== undefined && explicit !== '' ? explicit : 'http://127.0.0.1:3080'
}

/**
 * 重启宿主提示（dcf 绝不代用户杀进程/重启——破坏性操作，只输出指令）。
 * 参数：目标项目目录、profile 名、可选 host 标志（--host 原样回显）。
 */
function restartHint(root: string, profile: string, hostFlag: string | undefined): string[] {
  return [
    '重启宿主是破坏性操作，dcf 不会代你执行；请自行重启后重新验证：',
    '    dsh web stop && dsh web        # 若实例由 dsh web 管理（detached，pid/log 在 ~/.dsh 下）',
    '    # 前台方式: dsh web --dev；或用宿主管理界面/你自己的进程管理器重启',
    '重启后验证（一条命令，全链路复检）：',
    `    dcf status --cwd ${root} --profile ${profile}${hostFlag === undefined ? '' : ` --host ${hostFlag}`}`,
  ]
}

/**
 * `dcf ensure <dir> --profile <name> [--root <path>...] [--no-build] [--script <name>]
 * [--host <url>] [--no-host-check] [--no-install]`：一站式走完
 * 「插件 → code-ref path 可见」链路：
 *   1. 接线（init 同款：装依赖 + vite/tsdown/cordis 注入，幂等）；
 *   2. profile roots（roots.ts 同款：播种默认根 + <dir>/src，幂等追加）；
 *   3. dev 构建（自动识别 build:dev 等，NODE_ENV=development 运行，--no-build 跳过）；
 *   4. 验证（产物 data-locatorjs 计数、profile 覆盖、宿主 client URL + search API）。
 * 宿主未加载新产物/新 roots 时不代用户重启——输出重启指令并提示重跑 status。
 */
async function cmdEnsure(options: Options): Promise<number> {
  const root = options.ensureDir
  if (root === undefined || root === '') {
    console.error('dsh-code-finder: ensure 需要一个目标目录（如：dcf ensure /path/to/plugin --profile web）')
    console.error(usage())
    return 2
  }
  let profile: string
  try {
    profile = requireProfile(options.profile)
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`dsh-code-finder: ${error.message}`)
      console.error(usage())
      return 2
    }
    throw error
  }
  log(options, `dsh-code-finder ensure @ ${root} --profile ${profile}`)
  const { dir: profileDir, patchPath } = resolveProfile(profile)
  const read = (): string | undefined => (existsSync(patchPath) ? readSource(patchPath) : undefined)

  // ── 1. 接线 ────────────────────────────────────────────────────────────────
  log(options, '[1/4] 接线（init 同款，幂等）…')
  if (options.install) {
    log(options, '安装依赖…')
    if (!installDependency(options, root)) log(options, '⚠ 依赖安装失败（尝试 pnpm/yarn/npm 都不行），请手动安装')
  }
  const files = probeConfigFiles(root)
  if (files.vite.length === 0 && files.tsdown.length === 0 && files.cordis.length === 0) {
    log(options, '  ⚠ 未发现 vite.config.* / tsdown.config.* / cordis.patch.yml（接线无可操作项，继续）')
  } else {
    const wired = wireProjectFiles(options, root)
    if (wired === 0) log(options, '  已全部接入（无改动）')
  }

  // ── 2. profile roots ───────────────────────────────────────────────────────
  const entryId = options.roots.entryId ?? ROOTS_TARGET_ID
  if (options.roots.entryId !== undefined) {
    log(options, `  roots 目标挂载行 id: ${entryId}`)
  }
  const additions = options.extraRoots.length > 0 ? options.extraRoots : [defaultUiRoot(root)]
  log(options, `[2/4] profile roots（${patchPath}）…`)
  let result: ReturnType<typeof ensureRoots>
  try {
    result = ensureRoots(read() ?? '', additions, root, entryId)
  } catch (error) {
    if (error instanceof RootsEditError) {
      console.error(`dsh-code-finder: ${error.message}`)
      return 1
    }
    throw error
  }
  if (result.changed) {
    mkdirSync(profileDir, { recursive: true })
    writeSource(patchPath, result.source)
  }
  for (const path of result.added) {
    log(options, `  + ${displayRoot(path, root)}`)
  }
  for (const path of result.skipped) log(options, `  · ${displayRoot(path, root)}（已在覆盖中，跳过）`)
  log(options, result.changed ? `  ✔ 已写入 ${patchPath}` : `  ✔ 覆盖已就绪（无改动，幂等）`)

  // ── 3. dev 构建 ────────────────────────────────────────────────────────────
  log(options, options.noBuild ? '[3/4] 构建（--no-build 跳过）…' : '[3/4] dev 构建…')
  let injected = probeArtifacts(root)
  if (!options.noBuild) {
    const manager = existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm'
      : existsSync(join(root, 'yarn.lock')) ? 'yarn'
      : existsSync(join(root, 'package-lock.json')) ? 'npm' : 'pnpm'
    const packageJson = readSource(join(root, 'package.json'))
    let scripts: Record<string, string> | undefined
    try {
      scripts = packageJson === undefined ? undefined : (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts
    } catch {
      scripts = undefined
    }
    let script = options.script
    if (script !== undefined && (scripts === undefined || scripts[script] === undefined)) {
      log(options, `  ✗ --script ${script} 不存在于 package.json scripts${scripts === undefined ? '（且 package.json 缺失/非法）' : ''}`)
      return 1
    }
    if (script === undefined) script = pickDevBuildScript(scripts)
    if (script === undefined) {
      log(options, '  ✗ 未找到 dev 构建脚本（build:dev / build-dev / dev:build…）。可用脚本：')
      for (const [name, command] of Object.entries(scripts ?? {})) log(options, `      ${name}: ${command}`)
      log(options, '    请用 --script <name> 指定，或 --no-build 跳过构建。')
      return 1
    }
    log(options, `  运行: ${manager} run ${script}（NODE_ENV=development）…`)
    const run = spawnSync(manager, ['run', script], {
      cwd: root,
      stdio: options.quiet ? 'ignore' : 'inherit',
      env: { ...process.env, NODE_ENV: 'development' },
    })
    if (run.status !== 0) {
      log(options, `  ✗ 构建失败（${manager} run ${script} 退出码 ${String(run.status)}）`)
      return 1
    }
    injected = probeArtifacts(root)
    if (injected === 0) {
      log(options, '  ⚠ 构建完成但产物无 data-locatorjs 注入（0 处）。')
      log(options, '    确认该脚本是 dev 语义构建（NODE_ENV=development）且构建配置已接 codeFinderTsdown/Vite；')
      log(options, '    或该插件没有前端 client bundle（无注入是正常的，搜索层仍可给出 path）。')
      return 1
    }
  }

  // ── 4. 验证 ────────────────────────────────────────────────────────────────
  log(options, '[4/4] 验证…')
  log(options, `  ${injected > 0 ? '✔' : '✗'} 构建产物 data-locatorjs 注入: ${injected} 处`)
  const after = read()
  if (after !== undefined) {
    const items = listRoots(after, root, entryId)
    if (items !== null && items.length > 0) {
      log(options, `  ✔ profile roots 覆盖（${patchPath}, id: ${entryId}）:`)
      for (const item of items) log(options, `      ${item.raw.trim()}`)
    } else {
      log(options, `  ✗ profile ${profile} 无 dcf roots 覆盖`)
    }
    if (hasInvalidOverridesBlock(after)) {
      log(options, '  ⚠ 检测到无效的 `- overrides:` 包裹块（loader 不识别，boot 会告警并跳过）。')
    }
  } else {
    log(options, `  ✗ ${patchPath} 不存在（roots 未写入）`)
  }

  const base = hostBase(options)
  if (options.noHostCheck) {
    log(options, `  - 宿主探测跳过（--no-host-check）`)
  } else {
    const packageJson = readSource(join(root, 'package.json'))
    let pluginName: string | undefined
    try {
      pluginName = packageJson === undefined ? undefined : (JSON.parse(packageJson) as { name?: string }).name
    } catch {
      pluginName = undefined
    }
    if (pluginName === undefined) {
      log(options, `  - 项目 package.json 无 name，跳过宿主 client URL 探测（--cwd 目标需是插件包根目录）`)
    }
    const component = probeComponentName(root)
    if (pluginName !== undefined) {
      const host = await probeHost(base, pluginName, component ?? 'App')
      const clientOk = host.client.ok
      log(options, `  ${clientOk ? '✔' : '✗'} 宿主 client bundle GET ${host.client.url} → ${host.client.status ?? '不可达'}${clientOk ? '（当前 boot 已挂该插件）' : '（当前 boot 未挂该插件 client）'}`)
      if (host.search.ok && host.search.hits.length > 0) {
        const hit = host.search.hits[0]
        if (hit !== undefined) log(options, `  ✔ search API POST ${base}/code-finder/api/search {name:${component ?? 'App'}} → 命中 ${hit.file}:${String(hit.line)}（path 可见 ✓）`)
      } else {
        const why = host.search.status === undefined
          ? '不可达（宿主未启动/非 dcf 宿主？）'
          : host.search.status !== 200
            ? `HTTP ${String(host.search.status)}（host 半未挂载？）`
            : 'ok 但索引未命中（roots 未生效/旧 boot？）'
        log(options, `  ✗ search API POST ${base}/code-finder/api/search {name:${component ?? 'App'}} → ${host.search.detail}; ${why}`)
      }
      if (!clientOk || !host.search.ok || host.search.hits.length === 0) {
        for (const line of restartHint(root, profile, options.host)) log(options, `  ${line}`)
      }
    }
  }
  log(options, '✔ ensure 完成（宿主侧未加载时请按上方提示重启后复检）。')
  return 0
}

/**
 * `dcf roots <list|add|remove> <profile> [root...]`：管理 DSH profile 的
 * cordis.patch.yml 里 dcf 的 config.roots 覆盖（id 定位补丁；完全替换语义，
 * 创建新块时播种两条默认根；幂等追加/精确移除，不写备份、不动其它条目）。
 */
function cmdRoots(options: Options): number {
  if (options.roots.sub === undefined) {
    console.error('dsh-code-finder: roots 需要子命令 list|add|remove')
    console.error(usage())
    return 2
  }
  let profile: string
  try {
    profile = requireProfile(options.roots.profile)
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(`dsh-code-finder: ${error.message}`)
      console.error(usage())
      return 2
    }
    throw error
  }
  const { dir, patchPath } = resolveProfile(profile)
  const entryId = options.roots.entryId ?? ROOTS_TARGET_ID
  if (options.roots.entryId !== undefined) {
    log(options, `dcf roots → 目标挂载行 id: ${entryId}`)
  }
  const read = (): string | undefined => (existsSync(patchPath) ? readSource(patchPath) : undefined)
  const report = (message: string): void => log(options, message)

  switch (options.roots.sub) {
    case 'list': {
      report(`dcf roots list ${profile} @ ${dir}`)
      const source = read()
      if (source === undefined) {
        report('  未配置 roots 覆盖（host 半使用默认 roots：~/.dsh/source/current + <host cwd>/src + monorepo packages/apps）')
        return 0
      }
      const items = listRoots(source, options.root, entryId)
      if (items === null || items.length === 0) {
        report(`  ${basenameDisplay(patchPath)}: 无 dcf roots 覆盖（${entryId}；host 半使用默认 roots）`)
      } else {
        report(`  ${basenameDisplay(patchPath)} 当前覆盖 (id: ${entryId}):`)
        for (const item of items) report(`    ${item.raw.trim()}`)
      }
      if (hasInvalidOverridesBlock(source)) {
        report('  ⚠ 检测到无效的 `- overrides:` 包裹块（当前 loader 不识别，boot 时会告警并跳过）；')
        report(`    正确写法是顶层补丁项 "- id: ${entryId}" + config.roots（本 CLI 即按此管理）。`)
      }
      return 0
    }
    case 'add': {
      report(`dcf roots add ${profile} @ ${dir}`)
      if (options.roots.paths.length === 0) {
        console.error('dsh-code-finder: roots add 需要至少一个路径参数')
        console.error(usage())
        return 2
      }
      const created = read() === undefined
      const source = read() ?? ''
      let result
      try {
        result = ensureRoots(source, options.roots.paths, options.root, entryId)
      } catch (error) {
        if (error instanceof RootsEditError) {
          console.error(`dsh-code-finder: ${error.message}`)
          return 1
        }
        throw error
      }
      if (result.changed) {
        mkdirSync(dir, { recursive: true })
        writeSource(patchPath, result.source)
      }
      if (created) {
        report('  ✔ 已创建 roots 覆盖并播种两条默认根（config.roots 是完全替换，默认 roots 不会自动合并，')
        report('    需要保留的默认根必须显式列出——已按「无覆盖时行为」播种）')
      }
      for (const path of result.added) {
        const display = displayRoot(path, options.root)
        report(`  + ${display}`)
        if (display !== path.trim() && !existsSync(display)) {
          report(`    ! 目录当前不存在（索引会静默跳过；确认路径拼写，目录出现后生效）`)
        }
      }
      for (const path of result.skipped) report(`  · ${displayRoot(path, options.root)}（已存在，跳过）`)
      if (result.changed && hasInvalidOverridesBlock(result.source)) {
        report('  ⚠ 文件中仍存在无效的 `- overrides:` 包裹块（loader 不识别，boot 会告警并跳过）；')
        report(`    可手动删除旧块，或确认其内容已由上方 "- id: ${entryId}" 补丁项取代。`)
      }
      report(result.changed ? `  ✔ 已写入 ${patchPath}` : `  ✔ 无改动（${basenameDisplay(patchPath)} 已含全部目标 roots）`)
      return 0
    }
    case 'remove': {
      report(`dcf roots remove ${profile} @ ${dir}`)
      const source = read()
      if (source === undefined) {
        report('  未配置 roots 覆盖，无可移除')
        return 0
      }
      const result = removeRoots(source, options.roots.paths, options.root, entryId)
      if (result.changed) writeSource(patchPath, result.source)
      for (const path of result.removed) report(`  - ${displayRoot(path, options.root)} 已移除`)
      for (const path of result.missing) report(`  · ${path}（未在覆盖中找到）`)
      if (result.changed) {
        const after = readSource(patchPath)
        if (after === undefined || listRoots(after, options.root, entryId) === null) {
          report('  ✔ 覆盖已清空并删除整块（host 半恢复默认 roots）')
        } else {
          report(`  ✔ 已写入 ${patchPath}`)
        }
      } else {
        report(`  ✔ 无改动（${basenameDisplay(patchPath)} 中不存在这些 roots）`)
      }
      return 0
    }
  }
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
  let quiet = false
  let link: string | undefined
  let keepDeps = false
  const dirs: string[] = []
  let write = false
  let outDir: string | undefined
  let ensureDir: string | undefined
  let profile: string | undefined
  let host: string | undefined
  let noBuild = false
  let script: string | undefined
  const extraRoots: string[] = []
  let noHostCheck = false
  const roots: Options['roots'] = { sub: undefined, profile: undefined, paths: [], entryId: undefined }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue
    // roots 子命令的关键字（list|add|remove）必须先于顶层命令关键字被认领：
    // `roots remove ...` 里的 remove 不是顶层 remove 命令。
    if (command === 'roots' && (arg === 'list' || arg === 'add' || arg === 'remove')) {
      roots.sub = arg
      continue
    }
    switch (arg) {
      case 'init': case 'status': case 'remove': case 'instrument': case 'ensure':
        command = arg
        break
      case 'roots':
        command = 'roots'
        break
      case '--help': case '-h': printHelp(); return { command: '__help__', options: { root, install, quiet, link, keepDeps, dirs, write, outDir, roots, ensureDir, profile, host, noBuild, script, extraRoots, noHostCheck } }
      case '--version': case '-v': console.log(cliVersion()); return { command: '__version__', options: { root, install, quiet, link, keepDeps, dirs, write, outDir, roots, ensureDir, profile, host, noBuild, script, extraRoots, noHostCheck } }
      case '--no-install': install = false; break
      case '--keep-deps': keepDeps = true; break
      case '--quiet': quiet = true; break
      case '--write': write = true; break
      case '--no-build': noBuild = true; break
      case '--no-host-check': noHostCheck = true; break
      case '--profile': {
        const value = args[index + 1]
        if (value === undefined) throw new CliUsageError('--profile 需要一个值（DSH profile 名，如 web）')
        profile = value
        index += 1
        break
      }
      case '--host': {
        const value = args[index + 1]
        if (value === undefined) throw new CliUsageError('--host 需要一个值（宿主 base URL，如 http://127.0.0.1:3080）')
        host = value
        index += 1
        break
      }
      case '--script': {
        const value = args[index + 1]
        if (value === undefined) throw new CliUsageError('--script 需要一个值（dev 构建脚本名，如 build:dev）')
        script = value
        index += 1
        break
      }
      case '--root': {
        const value = args[index + 1]
        if (value === undefined) throw new CliUsageError('--root 需要一个值（额外 profile root 路径）')
        extraRoots.push(value)
        index += 1
        break
      }
      case '--entry-id': {
        if (command !== 'roots' && command !== 'ensure') {
          throw new CliUsageError('--entry-id 只适用于 roots 子命令（roots 补丁的目标挂载行 id）')
        }
        const value = args[index + 1]
        if (value === undefined || value.trim() === '' || value.startsWith('-')) {
          throw new CliUsageError('--entry-id 需要一个值（挂载行 id，如 dsh-code-finder-mount）')
        }
        roots.entryId = value
        index += 1
        break
      }
      case '--out': {
        // 相对路径先按字面保存，解析完 --cwd 后再以 root 为基准解析。
        const value = args[index + 1]
        if (value === undefined) throw new CliUsageError('--out 需要一个值（镜像输出目录）')
        outDir = value
        index += 1
        break
      }
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
        if (arg.startsWith('-')) throw new CliUsageError(`未知参数: ${arg}`)
        if (command === 'instrument') {
          dirs.push(arg)
          break
        }
        if (command === 'ensure') {
          if (ensureDir === undefined) ensureDir = arg
          else throw new CliUsageError('ensure 只接受一个目标目录参数')
          break
        }
        if (command === 'roots') {
          // roots 的固定位置参数：<list|add|remove> <profile> [root...]。
          if (roots.sub === undefined) {
            if (arg !== 'list' && arg !== 'add' && arg !== 'remove') {
              throw new CliUsageError(`roots 子命令必须是 list|add|remove，得到: ${arg}`)
            }
            roots.sub = arg
          } else if (roots.profile === undefined) {
            roots.profile = arg
          } else if (roots.sub === 'list') {
            throw new CliUsageError(`roots list 不接受多余参数: ${arg}`)
          } else {
            roots.paths.push(arg)
          }
          break
        }
        throw new CliUsageError(`未知参数: ${arg}`)
    }
  }
  // --out 相对路径以最终 root（--cwd）为基准；ensure 的目标目录按进程 cwd 解析。
  outDir = outDir === undefined ? undefined : isAbsolute(outDir) ? resolve(outDir) : join(root, outDir)
  ensureDir = ensureDir === undefined ? undefined : resolveRoot(ensureDir)
  return { command, options: { root, install, quiet, link, keepDeps, dirs, write, outDir, roots, ensureDir, profile, host, noBuild, script, extraRoots, noHostCheck } }
}

/** Argument parsing failure: exits 2 at the process boundary, code-2 within runCli. */
class CliUsageError extends Error {}

/** usage line shared by parse errors and missing subcommand. */
function usage(): string {
  return 'usage: dcf (dsh-code-finder) <init|status [--profile <name>]|ensure <dir> --profile <name>|remove|roots <list|add|remove <profile> [root...]>|instrument [dir...] [--write] [--out <dir>]> [--cwd <dir>] [--no-install] [--keep-deps] [--link <path>] [--no-build] [--script <name>] [--root <path>] [--entry-id <id>] [--host <url>] [--no-host-check] [--quiet]'
}

/** --help / -h output. */
function printHelp(): void {
  console.log('dcf — dsh-code-finder 组件定位注入一键接线 / 诊断 / 回滚')
  console.log('')
  console.log(usage())
  console.log('')
  console.log('子命令:')
  console.log('  init        检测项目类型并接线（vite/tsdown/cordis），不产生任何备份文件')
  console.log('  status      诊断接线状态、依赖、产物 data-locatorjs 注入；')
  console.log('              加 --profile <name> 附加 profile patch / 宿主可达性检查')
  console.log('  ensure      一站式驱动「插件 → code-ref path 可见」整条链路（见下）')
  console.log('    ensure <dir> --profile <name>')
  console.log('      [1/4] 接线：装依赖（--no-install 跳过）+ vite/tsdown/cordis 注入（幂等）')
  console.log('      [2/4] profile roots：确保 <name> 的 patch 含 dcf config.roots')
  console.log('            （播种两条默认根 + <dir>/src；--root <path> 可重复追加）')
  console.log('      [3/4] dev 构建：自动识别 build:dev 等脚本并以 NODE_ENV=development 运行')
  console.log('            （--script <name> 指定；--no-build 跳过）')
  console.log('      [4/4] 验证：产物 data-locatorjs 计数 + profile 覆盖 + 宿主探测')
  console.log('            宿主未加载新产物/roots 时输出重启指令（绝不代你重启）')
  console.log('  remove      完整卸载：精确移除注入（保留你的其它修改）+ 移除依赖（--keep-deps 保留）')
  console.log('  instrument  无 bundler 项目的独立注入：对目录内源码执行 codeFinder 注入')
  console.log('              （默认 dev 语义才注入、dry-run 只报告；--write 落盘 / --out 镜像）')
  console.log('  roots       管理 DSH profile 的 cordis.patch.yml 里 dcf 的 config.roots 覆盖：')
  console.log('    roots list <profile>                     列出当前覆盖（无覆盖显示默认语义）')
  console.log('    roots add <profile> <root...>            幂等追加 roots（~ 与相对路径按 --cwd 归一化）')
  console.log('    roots remove <profile> <root...>         移除指定 roots；清空时删除整块恢复默认')
  console.log('    覆盖是完全替换（非合并）：创建新块时自动播种两条默认根')
  console.log('    --entry-id <id>   roots 补丁的目标挂载行 id（默认 dsh-code-finder；')
  console.log('                       宿主自定义挂载行 id 时用，如 dsh-code-finder-mount）')
  console.log('    （默认 roots：~/.dsh/source/current + <host cwd>/src + monorepo packages/apps；')
  console.log('     profile 位于 $DSH_HOME/profiles）')
  console.log('')
  console.log('选项:')
  console.log('  --cwd <dir>          目标项目根目录（默认当前目录；roots 的相对路径按它解析）')
  console.log('  --link <path>        以 link: 协议安装依赖（包未发布 registry 时指向本地仓库）')
  console.log('  --no-install         跳过依赖安装（只改配置）')
  console.log('  --keep-deps          卸载时保留依赖（只回滚接线）')
  console.log('  --no-build           ensure 跳过构建阶段')
  console.log('  --script <name>      ensure 指定 dev 构建脚本名（默认自动识别 build:dev 等）')
  console.log('  --root <path>        ensure 额外追加的 profile root（可重复；默认 <dir>/src）')
  console.log('  --entry-id <id>     roots/ensure 的 roots 补丁目标挂载行 id（默认 dsh-code-finder）')
  console.log('  --profile <name>     ensure 必需；status 附加 profile/宿主检查')
  console.log('  --host <url>         宿主 base URL（默认 http://127.0.0.1:3080）')
  console.log('  --no-host-check      跳过宿主探测（client URL / search API，离线场景）')
  console.log('  --write              instrument 时写入产物（默认 dry-run 只报告）')
  console.log('  --out <dir>          instrument 镜像输出到 <dir>（保留相对路径，不覆盖源文件）')
  console.log('  --quiet              静默输出')
  console.log('  -v, --version        显示版本（渠道标注 + 构建信息）')
  console.log('  -h, --help           显示本帮助')
  console.log('')
  console.log('接线后需以 dev 语义构建（NODE_ENV=development）才产生 data-locatorjs 注入；')
  console.log('instrument 同理：NODE_ENV=development 才注入（enabled 参数可覆盖）。')
  console.log('ensure 的宿主探测只读：GET /plugins/<name>/client.js + POST /code-finder/api/search。')
  console.log('重启宿主是破坏性操作，dcf 只输出指令（如 dsh web stop && dsh web），不代你执行。')
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
    case '__version__': return 0
    case 'init': return cmdInit(options)
    case 'status': return cmdStatus(options)
    case 'remove': return cmdRemove(options)
    case 'instrument': return cmdInstrument(options)
    case 'roots': return cmdRoots(options)
    case 'ensure': return cmdEnsure(options)
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