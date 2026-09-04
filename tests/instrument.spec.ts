/**
 * 独立 instrument 入口（src/instrument.ts + CLI instrument 子命令）测试：
 * - dev 语义 dry-run / --write 落盘 / outDir 镜像；
 * - 生产语义整体 no-op（write 也不落盘）；
 * - node_modules 与解析失败文件跳过、不中断；
 * - 幂等：重复 instrument 不重复注入、磁盘字节稳定；
 * - runCli：instrument [dir...] [--write] [--out] 的退出码与落盘行为。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli/index'
import { instrumentDir, instrumentFile } from '../src/instrument'

/** 零构建插件典型源码：纯 React.createElement、无 JSX。 */
const CE_FILE = [
  "import React from 'react'",
  '',
  "export const Btn = () => React.createElement('button', { type: 'button' }, 'go')",
  '',
].join('\n')

const dirs: string[] = []
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cf-instrument-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('instrumentFile', () => {
  it('dev 语义 dry-run：返回注入代码，不落盘', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    const file = join(dir, 'client.js')
    writeFileSync(file, CE_FILE)
    const result = await instrumentFile(file)
    expect(result.changed).toBe(true)
    // 属性是文件自身的绝对路径（单文件默认 projectRoot = 文件所在目录）
    expect(result.code).toMatch(/"data-locatorjs": ".+client\.js:\d+:\d+"/u)
    expect(readFileSync(file, 'utf8')).toBe(CE_FILE)
  })

  it('write 落盘 + 幂等：重复执行不重复注入、磁盘字节稳定', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    const file = join(dir, 'client.js')
    writeFileSync(file, CE_FILE)
    const first = await instrumentFile(file, { write: true })
    expect(first.changed).toBe(true)
    const onDisk = readFileSync(file, 'utf8')
    expect(onDisk).not.toBe(CE_FILE)
    expect(onDisk).toContain('data-locatorjs')
    const second = await instrumentFile(file, { write: true })
    expect(second.changed).toBe(false)
    expect(second.code).toBeUndefined()
    expect(readFileSync(file, 'utf8')).toBe(onDisk)
  })

  it('outDir 镜像输出：源文件不动，镜像目录保留相对路径', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    const sub = join(dir, 'lib')
    mkdirSync(sub)
    const file = join(sub, 'client.js')
    writeFileSync(file, CE_FILE)
    const outDir = join(dir, '.dcf')
    const result = await instrumentFile(file, { write: true, outDir, projectRoot: dir })
    expect(result.changed).toBe(true)
    expect(result.error).toBeUndefined()
    expect(readFileSync(file, 'utf8')).toBe(CE_FILE)
    expect(readFileSync(join(outDir, 'lib', 'client.js'), 'utf8')).toContain('data-locatorjs')
  })

  it('dataAttribute: id 模式注入 data-locatorjs-id', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    const file = join(dir, 'client.js')
    writeFileSync(file, CE_FILE)
    const result = await instrumentFile(file, { write: true, dataAttribute: 'id', projectRoot: dir })
    expect(result.changed).toBe(true)
    const onDisk = readFileSync(file, 'utf8')
    expect(onDisk).toContain('data-locatorjs-id')
    expect(onDisk).not.toContain('"data-locatorjs":')
  })

  it('生产语义整体 no-op（write 也不落盘）', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const dir = sandbox()
    const file = join(dir, 'client.js')
    writeFileSync(file, CE_FILE)
    const result = await instrumentFile(file, { write: true })
    expect(result.changed).toBe(false)
    expect(result.code).toBeUndefined()
    expect(readFileSync(file, 'utf8')).toBe(CE_FILE)
  })

  it('node_modules 内文件不注入', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    const file = join(dir, 'node_modules', 'pkg', 'client.js')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, CE_FILE)
    const result = await instrumentFile(file, { write: true })
    expect(result.changed).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(CE_FILE)
  })

  it('transform 失败 warn + 跳过文件，不中断（不算 error）', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dir = sandbox()
    const file = join(dir, 'broken.js')
    writeFileSync(file, 'function {')
    const result = await instrumentFile(file, { write: true })
    expect(result.changed).toBe(false)
    expect(result.error).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('读取失败返回 error 字段', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    const result = await instrumentFile(join(dir, 'missing.js'))
    expect(result.changed).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('instrumentDir', () => {
  it('递归注入、跳过 node_modules/.git/隐藏目录、逐文件容错', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    writeFileSync(join(dir, 'a.js'), CE_FILE)
    writeFileSync(join(dir, 'b.ts'), 'export const x = 1\n')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'c.js'), CE_FILE)
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'd.js'), CE_FILE)
    mkdirSync(join(dir, '.hidden'))
    writeFileSync(join(dir, '.hidden', 'e.js'), CE_FILE)
    writeFileSync(join(dir, 'broken.js'), 'function {')
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'f.js'), CE_FILE)

    const result = await instrumentDir(dir, { write: true })
    expect(result.disabled).toBe(false)
    expect(result.write).toBe(true)
    expect(result.changed).toBe(2) // a.js + sub/c.js
    expect(result.unchanged).toBe(2) // b.ts（无素材）+ broken.js（解析失败）
    expect(result.errors).toBe(0)
    const names = result.files.map((file) => file.file.replace(`${dir}/`, ''))
    expect(names).toContain('a.js')
    expect(names).toContain('b.ts')
    expect(names).toContain('sub/c.js')
    expect(names).toContain('broken.js')
    expect(names).not.toContain('node_modules/d.js')
    expect(names).not.toContain('.hidden/e.js')
    expect(names).not.toContain('.git/f.js')
    expect(readFileSync(join(dir, 'a.js'), 'utf8')).toContain('data-locatorjs')
    expect(readFileSync(join(dir, 'sub', 'c.js'), 'utf8')).toContain('data-locatorjs')
    // 无素材文件绝不因 babel 再输出格式噪音被改写
    expect(readFileSync(join(dir, 'b.ts'), 'utf8')).toBe('export const x = 1\n')
    expect(readFileSync(join(dir, 'broken.js'), 'utf8')).toBe('function {')
  })

  it('生产语义 disabled：一个文件都不处理', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const dir = sandbox()
    writeFileSync(join(dir, 'a.js'), CE_FILE)
    const result = await instrumentDir(dir, { write: true })
    expect(result.disabled).toBe(true)
    expect(result.changed).toBe(0)
    expect(result.files).toHaveLength(0)
    expect(readFileSync(join(dir, 'a.js'), 'utf8')).toBe(CE_FILE)
  })
})

describe('runCli instrument', () => {
  it('dev 语义 --write：退出 0 且落盘注入（目录相对 --cwd 解析）', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'lib', 'client.js'), CE_FILE)
    const code = await runCli(['instrument', 'lib', '--write', '--cwd', dir])
    expect(code).toBe(0)
    expect(readFileSync(join(dir, 'lib', 'client.js'), 'utf8')).toContain('data-locatorjs')
  })

  it('dry-run（无 --write）：退出 0 但文件不动', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'lib', 'client.js'), CE_FILE)
    const code = await runCli(['instrument', 'lib', '--cwd', dir])
    expect(code).toBe(0)
    expect(readFileSync(join(dir, 'lib', 'client.js'), 'utf8')).toBe(CE_FILE)
  })

  it('--out 镜像输出：源码不动、镜像目录注入', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'lib', 'client.js'), CE_FILE)
    const code = await runCli(['instrument', 'lib', '--write', '--out', 'mirror', '--cwd', dir])
    expect(code).toBe(0)
    expect(readFileSync(join(dir, 'lib', 'client.js'), 'utf8')).toBe(CE_FILE)
    expect(readFileSync(join(dir, 'mirror', 'lib', 'client.js'), 'utf8')).toContain('data-locatorjs')
  })

  it('缺目录参数：退出 2；非 dev 语义整体 no-op：退出 0', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const dir = sandbox()
    const missingArgs = await runCli(['instrument', '--cwd', dir])
    expect(missingArgs).toBe(2)
    vi.stubEnv('NODE_ENV', 'production')
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'lib', 'client.js'), CE_FILE)
    const prodCode = await runCli(['instrument', 'lib', '--write', '--cwd', dir])
    expect(prodCode).toBe(0)
    expect(readFileSync(join(dir, 'lib', 'client.js'), 'utf8')).toBe(CE_FILE)
  })
})