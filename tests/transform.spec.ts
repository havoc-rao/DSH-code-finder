/**
 * 构建期注入产物断言（M1 核心 + M2 回归）：
 * - dev 注入 data-locatorjs 属性 + __LOCATOR_DATA__ 注册表 + sourcemap；
 * - 生产构建 / node_modules / 非 JS 文件原样返回（零注入、零开销）；
 * - transform 失败 warn + 返回 null，绝不让构建挂掉。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  codeFinderEnabled,
  shouldInstrument,
  transformWithCodeFinder,
} from '../src/build/transform'

const SAMPLE_TSX = `
export function Sidebar(props: { title: string }) {
  return <div className="side">{props.title}<Item /></div>
}
const Item = () => <span>item</span>
`

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('codeFinderEnabled', () => {
  it('NODE_ENV=development 默认开启', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CODE_FINDER', '')
    expect(codeFinderEnabled(undefined)).toBe(true)
  })

  it('NODE_ENV=production 默认关闭，CODE_FINDER=1 强制开启', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CODE_FINDER', '')
    expect(codeFinderEnabled(undefined)).toBe(false)
    vi.stubEnv('CODE_FINDER', '1')
    expect(codeFinderEnabled(undefined)).toBe(true)
  })

  it('显式 enabled 优先于环境变量', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(codeFinderEnabled(false)).toBe(false)
    vi.stubEnv('NODE_ENV', 'production')
    expect(codeFinderEnabled(true)).toBe(true)
  })
})

describe('shouldInstrument', () => {
  it('只处理应用自己的源码', () => {
    expect(shouldInstrument('/proj/src/App.tsx', {})).toBe(true)
    expect(shouldInstrument('/proj/src/App.ts', {})).toBe(true)
    expect(shouldInstrument('/proj/src/App.jsx', {})).toBe(true)
    expect(shouldInstrument('/proj/node_modules/pkg/dist/index.js', {})).toBe(false)
    expect(shouldInstrument('/proj/src/style.css', {})).toBe(false)
  })

  it('include / exclude 过滤', () => {
    const include = /src\/client\//u
    expect(shouldInstrument('/proj/src/client/Sidebar.tsx', { include })).toBe(true)
    expect(shouldInstrument('/proj/src/other/App.tsx', { include })).toBe(false)
    expect(shouldInstrument('/proj/src/client/Sidebar.tsx', { exclude: /Sidebar/u })).toBe(false)
  })
})

describe('transformWithCodeFinder', () => {
  it('dev 注入 data-locatorjs 属性 + __LOCATOR_DATA__ 注册表 + sourcemap', async () => {
    const result = await transformWithCodeFinder(SAMPLE_TSX, '/proj/src/Sidebar.tsx', { enabled: true })
    expect(result).not.toBeNull()
    expect(result!.code).toContain('data-locatorjs')
    expect(result!.code).toContain('__LOCATOR_DATA__')
    expect(result!.map).toBeDefined()
    // path 格式：<absPath>:<line>:<col>（兼容 LocatorJS 扩展；babel 输出 JSX 表达式容器）
    expect(result!.code).toMatch(/data-locatorjs=\{?"?[^"}]*Sidebar\.tsx:\d+:\d+/u)
  })

  it('dataAttribute: id 模式注入 data-locatorjs-id 属性', async () => {
    const result = await transformWithCodeFinder(SAMPLE_TSX, '/proj/src/Sidebar.tsx', {
      enabled: true,
      dataAttribute: 'id',
    })
    expect(result).not.toBeNull()
    expect(result!.code).toContain('data-locatorjs-id')
    expect(result!.code).not.toContain('data-locatorjs="')
  })

  it('生产构建原样返回（null）', async () => {
    const result = await transformWithCodeFinder(SAMPLE_TSX, '/proj/src/Sidebar.tsx', { enabled: false })
    expect(result).toBeNull()
  })

  it('node_modules 与 CSS 不注入', async () => {
    expect(await transformWithCodeFinder(SAMPLE_TSX, '/proj/node_modules/pkg/index.tsx', { enabled: true })).toBeNull()
    expect(await transformWithCodeFinder('body { color: red }', '/proj/src/style.css', { enabled: true })).toBeNull()
  })

  it('transform 失败 warn + 返回 null（绝不让构建挂掉）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await transformWithCodeFinder('function {', '/proj/src/Broken.tsx', { enabled: true })
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})
