/**
 * 独立 instrument 入口：无 bundler 的零构建项目（如 dsh-remote 的 lib/ 经典
 * script，宿主直接 serve、没有 vite/tsdown 构建链）用 -- 直接对目录/文件执行
 * 与构建期完全相同的注入（transformWithCodeFinder 复用），dev 语义才写、
 * 生产语义 no-op。
 *
 *   import { instrumentDir } from '@havocrao/dsh-code-finder/instrument'
 *   await instrumentDir('lib', { write: true, projectRoot: process.cwd() })
 *
 * CLI 前缀：`dcf instrument lib --write`（见 src/cli/index.ts）。
 *
 * 语义与构建期逐条对齐：
 * - dev gating：codeFinderEnabled（NODE_ENV=development，CODE_FINDER 逃生门）；
 * - 只处理自身源码：shouldInstrument（node_modules / 扩展名 / include/exclude）；
 * - transform 失败不中断：内部 warn + 跳过该文件；
 * - 幂等：已注入（props 已有 data-locatorjs key）的文件重复跑不重复注入；
 * - 只把「真正命中注入」的文件算 changed 并落盘——babel 再输出的格式噪音
 *   （补分号/引号归一）不算 changed，绝不无故改写源码。
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import {
  codeFinderEnabled,
  shouldInstrument,
  transformWithCodeFinder,
  type CodeFinderBuildOptions,
} from './build/transform'

export interface InstrumentOptions extends CodeFinderBuildOptions {
  /** 落盘（写回源文件或镜像到 outDir）；默认 false：dry-run 只返回内容。 */
  write?: boolean
  /**
   * 镜像目录：保留相对 projectRoot（默认 process.cwd()）的路径写到该目录，
   * 源文件不被覆盖。例：`instrumentDir('lib', { write: true, outDir: '.dcf' })`
   * 产出 `<cwd>/.dcf/lib/...`——沙箱/profile 直接加载镜像目录即可。
   */
  outDir?: string
}

export interface InstrumentFileResult {
  /** 绝对路径。 */
  file: string
  /** 本次是否产生了注入版内容（生产语义 / 解析失败 / 无素材均为 false）。 */
  changed: boolean
  /** 注入后的代码（changed 时给出；dry-run 与 write 都有值）。 */
  code?: string
  /** 读/写失败信息（transform 失败不算 error：内部 warn + 跳过）。 */
  error?: string
}

export interface InstrumentDirResult {
  /** 绝对路径。 */
  dir: string
  outDir?: string
  /** 是否已落盘（= options.write，且非生产 no-op）。 */
  write: boolean
  /** 生产语义（非 dev 且无 CODE_FINDER 强制）整体跳过为 true。 */
  disabled: boolean
  files: InstrumentFileResult[]
  changed: number
  unchanged: number
  errors: number
}

/** 递归跳过：node_modules / .git / 隐藏目录（用户显式 instrument 的目录本身
 *  不在此列——比如 dsh-remote 的 lib/ 就是要 instrument 的目标）。 */
const SKIP_DIRS = new Set(['node_modules', '.git'])

/** 对单个文件执行注入：返回注入结果，write 时落盘（in-place 或镜像）。 */
export async function instrumentFile(
  file: string,
  options: InstrumentOptions = {},
): Promise<InstrumentFileResult> {
  const absFile = resolve(file)
  if (!codeFinderEnabled(options.enabled)) return { file: absFile, changed: false }
  if (!shouldInstrument(absFile, options)) return { file: absFile, changed: false }
  let source: string
  try {
    source = readFileSync(absFile, 'utf8')
  } catch (error) {
    return { file: absFile, changed: false, error: errorMessage(error) }
  }
  // 单文件默认以文件自身目录为 projectRoot：data-locatorjs 里就是文件自己的
  // 真实绝对路径（<dir>/<name>:<line>:<col>），自描述且与 dir 模式一致。
  const transformOptions: InstrumentOptions = options.projectRoot === undefined
    ? { ...options, projectRoot: dirname(absFile) }
    : options
  const result = await transformWithCodeFinder(source, absFile, transformOptions)
  if (result === null) return { file: absFile, changed: false }
  const code = result.code
  // 只认「新注入的标记增量」：已注入文件重跑（旧标记还在）与 babel 再输出的
  // 格式噪音（补分号/引号归一，无新标记）都不算 changed，绝不无故改写源码。
  if (markerCount(code) <= markerCount(source)) return { file: absFile, changed: false }
  if (options.write === true) {
    const dest = destinationPath(absFile, options)
    try {
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, code, 'utf8')
    } catch (error) {
      return { file: absFile, changed: true, code, error: errorMessage(error) }
    }
  }
  return { file: absFile, changed: true, code }
}

/** 对目录递归执行注入（跳过 node_modules/.git/隐藏目录），逐文件容错。 */
export async function instrumentDir(
  dir: string,
  options: InstrumentOptions = {},
): Promise<InstrumentDirResult> {
  const absDir = resolve(dir)
  const outDir = options.outDir === undefined ? undefined : resolve(options.outDir)
  const disabled = !codeFinderEnabled(options.enabled)
  // 目录模式默认以被注入的目录为 projectRoot：整次注入路径基准一致。
  const transformOptions: InstrumentOptions = options.projectRoot === undefined
    ? { ...options, projectRoot: absDir }
    : options
  const results: InstrumentFileResult[] = []
  let changed = 0
  let unchanged = 0
  let errors = 0
  if (!disabled) {
    for (const file of collectFiles(absDir)) {
      const result = await instrumentFile(file, transformOptions)
      results.push(result)
      if (result.error !== undefined) errors += 1
      else if (result.changed) changed += 1
      else unchanged += 1
    }
  }
  return {
    dir: absDir,
    outDir,
    write: options.write === true,
    disabled,
    files: results,
    changed,
    unchanged,
    errors,
  }
}

function collectFiles(dir: string): string[] {
  const files: string[] = []
  const visit = (current: string): void => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return // 目录不可读/不存在：跳过
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        visit(full)
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
  }
  visit(dir)
  return files
}

/** 落盘目标：outDir 镜像（相对 projectRoot ?? cwd 保留路径）或原文件。 */
function destinationPath(absFile: string, options: InstrumentOptions): string {
  if (options.outDir === undefined) return absFile
  const base = options.projectRoot !== undefined ? resolve(options.projectRoot) : process.cwd()
  return join(resolve(options.outDir), relative(base, absFile))
}

/** 注入标记（data-locatorjs 属性）出现次数。注意注册表 IIFE 不能当标记：
 *  @locator/babel-jsx 对每个自有文件都会追加 components 注册表 IIFE
 *  （上游既有行为，不表示该文件被注入）。 */
function markerCount(code: string): number {
  return code.split('data-locatorjs').length - 1
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}