/**
 * dcf ensure / status --profile 测试。
 *
 * - 纯函数：dev 构建脚本识别（pickDevBuildScript）、探测组件名提取
 *   （probeComponentName）、宿主 URL 拼接（joinHostUrl）；
 * - runCli 层端到端：临时 DSH_HOME + 假插件项目（tsdown.config.ts 可接线、
 *   build:dev 脚本产出 data-locatorjs 产物），驱动 ensure 全链路 →
 *   接线 + roots + 构建 + 验证，二次执行字节级幂等；status --profile
 *   附加 profile 检查；--no-build / --script / --root / 缺脚本等分支。
 * 宿主探测在单测里一律 --no-host-check（真实宿主留待手工/集成验证）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { joinHostUrl } from '../src/cli/host-probe'
import { pickDevBuildScript, probeComponentName, runCli } from '../src/cli/index'

const home = homedir()
const seededHome = join(home, '.dsh', 'source', 'current')
const seededCwd = "!!js \"process.cwd() + '/src'\""

const dirs: string[] = []
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cf-ensure-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 搭一个可被 ensure 全链路服务的假插件项目。 */
function fakePlugin(root: string, scripts: Record<string, string> = { 'build:dev': 'node build-dev.mjs' }): void {
  mkdirSync(join(root, 'src', 'client'), { recursive: true })
  writeFileSync(join(root, 'src', 'client', 'Widget.tsx'), 'export function Widget() { return null }\n')
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fake-plugin', version: '0.0.1', scripts }, null, 2)}\n`)
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: "9.0"\n')
  writeFileSync(join(root, 'tsdown.config.ts'), 'export default { plugins: [] }\n')
  writeFileSync(join(root, 'build-dev.mjs'), [
    "import { mkdirSync, writeFileSync } from 'node:fs'",
    "mkdirSync('lib', { recursive: true })",
    "writeFileSync('lib/client.js', 'var a = 1; data-locatorjs=\"/x:1:1\"; data-locatorjs=\"/y:2:2\"')",
    '',
  ].join('\n'))
}

describe('ensure: 纯函数', () => {
  it('pickDevBuildScript：build:dev 优先，形态各异，长驻脚本不选', () => {
    expect(pickDevBuildScript(undefined)).toBeUndefined()
    expect(pickDevBuildScript({})).toBeUndefined()
    expect(pickDevBuildScript({ build: 'tsdown', dev: 'tsdown --watch', watch: 'tsdown --watch' })).toBeUndefined()
    expect(pickDevBuildScript({ build: 'tsdown', 'build:dev': 'tsdown' })).toBe('build:dev')
    expect(pickDevBuildScript({ 'build-dev': 'x' })).toBe('build-dev')
    expect(pickDevBuildScript({ 'dev:build': 'x' })).toBe('dev:build')
    expect(pickDevBuildScript({ 'dev-build': 'x' })).toBe('dev-build')
    // 宽松形态按 package.json 书写顺序。
    expect(pickDevBuildScript({ 'build:prod': 'x', 'build:dev:web': 'y' })).toBe('build:dev:web')
    // 含 'dev' 但非构建脚本不选。
    expect(pickDevBuildScript({ dev: 'tsdown --watch' })).toBeUndefined()
    expect(pickDevBuildScript({ setup: 'node x.js', 'dev-setup': 'node y.js' })).toBeUndefined()
  })

  it('probeComponentName：优先 export function，次选 const；无 src 返回 undefined', () => {
    const root = sandbox()
    expect(probeComponentName(root)).toBeUndefined()
    mkdirSync(join(root, 'src', 'client'), { recursive: true })
    writeFileSync(join(root, 'src', 'client', 'A.tsx'), 'export function Alpha() { return null }\n')
    writeFileSync(join(root, 'src', 'client', 'B.tsx'), 'const Beta = () => null\n')
    expect(probeComponentName(root)).toBe('Alpha')
    writeFileSync(join(root, 'src', 'client', 'C.ts'), 'export function Gamma() { return null }\n')
    expect(probeComponentName(root)).toBe('Alpha') // 字母序第一个 export function
    // 无导出时退回 const。
    const root2 = sandbox()
    mkdirSync(join(root2, 'src'), { recursive: true })
    writeFileSync(join(root2, 'src', 'x.tsx'), 'const Delta = () => null\n')
    expect(probeComponentName(root2)).toBe('Delta')
  })

  it('joinHostUrl：拼路径并去重斜杠', () => {
    expect(joinHostUrl('http://127.0.0.1:3080/', '/plugins/a/client.js')).toBe('http://127.0.0.1:3080/plugins/a/client.js')
    expect(joinHostUrl('http://127.0.0.1:3080', 'code-finder/api/search')).toBe('http://127.0.0.1:3080/code-finder/api/search')
  })
})

describe('runCli: ensure 端到端（临时 DSH_HOME）', () => {
  const previousHome = process.env.DSH_HOME

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  })

  it('ensure 一站到底：接线 + roots + dev 构建 + 验证；重复执行字节级幂等', async () => {
    const dshHome = sandbox()
    process.env.DSH_HOME = dshHome
    const project = sandbox()
    fakePlugin(project)

    expect(await runCli(['ensure', project, '--profile', 'web', '--no-install', '--no-host-check'])).toBe(0)

    // 1) 接线：tsdown.config.ts 注入 codeFinderTsdown。
    const tsdown = readFileSync(join(project, 'tsdown.config.ts'), 'utf8')
    expect(tsdown).toContain("import { codeFinderTsdown } from '@havocrao/dsh-code-finder/tsdown'")
    expect(tsdown).toContain('codeFinderTsdown()')

    // 2) roots：profile patch 播种默认根 + <dir>/src。
    const patch = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
    expect(existsSync(patch)).toBe(true)
    let content = readFileSync(patch, 'utf8')
    expect(content).toContain('- id: dsh-code-finder')
    expect(content).toContain(`- ${seededHome}`)
    expect(content).toContain(`- ${seededCwd}`)
    expect(content).toContain(`- ${join(project, 'src')}`)
    // 用户内容外无残留（整块即三行 roots；`- id:` 行不算列表项）。
    expect(content.match(/^\s+- (?!id:)/gmu) ?? []).toHaveLength(3)

    // 3) 构建：build:dev 脚本被触发，产物注入计数 > 0。
    const client = readFileSync(join(project, 'lib', 'client.js'), 'utf8')
    expect(client.match(/data-locatorjs/gu)).toHaveLength(2)

    // 幂等：二跑字节级零改动。
    const snapshot: Array<[string, string]> = [patch, join(project, 'tsdown.config.ts'), join(project, 'lib', 'client.js')]
      .map(path => [path, readFileSync(path, 'utf8')] as [string, string])
    expect(await runCli(['ensure', project, '--profile', 'web', '--no-install', '--no-host-check'])).toBe(0)
    for (const [path, bytes] of snapshot) expect(readFileSync(path, 'utf8')).toBe(bytes)

    // 4) status --profile：profile 检查 + 宿主探测跳过。
    expect(await runCli(['status', '--cwd', project, '--profile', 'web', '--no-host-check'])).toBe(0)
    expect(await runCli(['status', '--cwd', project, '--profile', 'web', '--host', 'http://127.0.0.1:9', '--quiet'])).toBe(0)
  })

  it('ensure --no-build 跳过构建；产物缺失时如实报告但仍完成 roots', async () => {
    const dshHome = sandbox()
    process.env.DSH_HOME = dshHome
    const project = sandbox()
    fakePlugin(project)
    expect(await runCli(['ensure', project, '--profile', 'web', '--no-install', '--no-build', '--no-host-check'])).toBe(0)
    // build:dev 未被触发。
    expect(existsSync(join(project, 'lib'))).toBe(false)
    // roots 依然写入。
    const patch = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
    expect(readFileSync(patch, 'utf8')).toContain(`- ${join(project, 'src')}`)
  })

  it('ensure --script 指定脚本；--root 追加额外 root', async () => {
    const dshHome = sandbox()
    process.env.DSH_HOME = dshHome
    const project = sandbox()
    fakePlugin(project, { 'build:dev': 'node build-dev.mjs', 'custom:build': 'node build-dev.mjs' })
    expect(await runCli(['ensure', project, '--profile', 'web', '--no-install', '--no-host-check', '--script', 'custom:build', '--root', '/extra/root'])).toBe(0)
    const patch = join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
    expect(readFileSync(patch, 'utf8')).toContain('- /extra/root')
    // 默认 <dir>/src 不再自动加入（--root 显式接管）。
    expect(readFileSync(patch, 'utf8')).not.toContain(`- ${join(project, 'src')}`)
  })

  it('ensure 无 dev 构建脚本 → 列出脚本并退出 1；--script 缺失同样退出 1', async () => {
    const dshHome = sandbox()
    process.env.DSH_HOME = dshHome
    const project = sandbox()
    fakePlugin(project, { build: 'tsdown' })
    expect(await runCli(['ensure', project, '--profile', 'web', '--no-install', '--no-host-check'])).toBe(1)
    expect(await runCli(['ensure', project, '--profile', 'web', '--no-install', '--no-host-check', '--script', 'nope'])).toBe(1)
  })

  it('构建完成但零注入 → 退出 1（dev 语义未生效）', async () => {
    const dshHome = sandbox()
    process.env.DSH_HOME = dshHome
    const project = sandbox()
    fakePlugin(project, { 'build:dev': 'node -e "require(\'node:fs\').mkdirSync(\'lib\',{recursive:true});require(\'node:fs\').writeFileSync(\'lib/client.js\',\'var a=1\')"' })
    expect(await runCli(['ensure', project, '--profile', 'web', '--no-install', '--no-host-check'])).toBe(1)
  })

  it('ensure 用法错误 → 退出 2（缺 --profile / 缺目录 / 非法 profile 名）', async () => {
    process.env.DSH_HOME = sandbox()
    const project = sandbox()
    fakePlugin(project)
    expect(await runCli(['ensure'])).toBe(2)
    expect(await runCli(['ensure', project])).toBe(2)
    expect(await runCli(['ensure', project, '--profile', '../evil'])).toBe(2)
    expect(await runCli(['ensure', project, 'x', '--profile', 'web'])).toBe(2)
  })
})