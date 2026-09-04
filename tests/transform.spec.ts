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

/** 纯 createElement 源码（零构建插件的典型形态：无 JSX、无 bundler）。 */
const SAMPLE_CREATE_ELEMENT = [
  "import React from 'react'",
  '',
  "export function Badge(props) {",
  "  return React.createElement('span', { className: 'b' }, props.label)",
  '}',
  '',
].join('\n')

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

  it('CODE_FINDER=0 在 dev 构建也强制关闭（总开关）', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('CODE_FINDER', '0')
    expect(codeFinderEnabled(undefined)).toBe(false)
    vi.stubEnv('CODE_FINDER', 'off')
    expect(codeFinderEnabled(undefined)).toBe(false)
    vi.stubEnv('CODE_FINDER', '')
    expect(codeFinderEnabled(undefined)).toBe(true)
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

describe('transformWithCodeFinder: createElement 模式', () => {
  const FILE = '/proj/src/Widget.js'

  it('dev 注入 React.createElement：props 对象字面量加 data-locatorjs（path 格式）', async () => {
    const result = await transformWithCodeFinder(SAMPLE_CREATE_ELEMENT, FILE, { enabled: true })
    expect(result).not.toBeNull()
    const code = result!.code
    // 与 JSX 模式相同的自描述格式 <absFile>:<line>:<col>（call 位于第 4 行；
    // 前缀不锚定——transform 的 cwd 默认 process.cwd()，测试里的假路径会拼接其后）
    expect(code).toMatch(/"data-locatorjs": "[^"]*Widget\.js:4:\d+"/u)
    // createElement 条目走 expressionsCE（c<n> 字符串 id，与 locator 数字 id 错开）
    expect(code).toContain('expressionsCE')
    expect(code).toContain('__LOCATOR_DATA__')
    // 包裹组件链：Badge = components[0]，条目的 wrappingComponentId 指向它
    expect(code).toContain('"wrappingComponentId": 0')
  })

  it('dataAttribute: id 模式注入 data-locatorjs-id + c0 注册表条目', async () => {
    const result = await transformWithCodeFinder(SAMPLE_CREATE_ELEMENT, FILE, {
      enabled: true,
      dataAttribute: 'id',
    })
    expect(result).not.toBeNull()
    expect(result!.code).toMatch(/"data-locatorjs-id": "[^"]*Widget\.js::c0"/u)
    expect(result!.code).toContain('"c0"')
    expect(result!.code).not.toContain('"data-locatorjs":')
  })

  it('createElement(Tag) 无 props / null props 生成新对象且不崩', async () => {
    const source = [
      "import React from 'react'",
      "React.createElement('div')",
      "React.createElement('div', null, React.createElement('span', { k: 1 }))",
      '',
    ].join('\n')
    const result = await transformWithCodeFinder(source, FILE, { enabled: true })
    expect(result).not.toBeNull()
    const code = result!.code
    // 无 props 调用插入新对象（源码单引号被 babel 原样保留）
    expect(code).toMatch(/createElement\(['"]div['"], \{\s*"data-locatorjs"/u)
    // 三处调用全部注入（外层无 props 插入、null 替换、内层对象追加）
    expect(code.match(/data-locatorjs/g)).toHaveLength(3)
  })

  it('props 为标识符/调用/spread 表达式时不注入', async () => {
    const source = [
      "import React from 'react'",
      "const shared = { className: 'x' }",
      "React.createElement('div', shared)",
      "React.createElement('div', getProps())",
      "React.createElement('div', ...spread)",
      '',
    ].join('\n')
    const result = await transformWithCodeFinder(source, FILE, { enabled: true })
    expect(result).not.toBeNull()
    // 不注入 data-locatorjs 属性（注意：@locator/babel-jsx 对每个自有文件都会
    // 追加 components 注册表 IIFE，__LOCATOR_DATA__ 是否存在不代表注入与否）
    expect(result!.code).not.toContain('data-locatorjs')
  })

  it('document.createElement 与本文件自定义 createElement 不注入', async () => {
    const source = [
      'function createElement(tag) { return document.createElement(tag) }',
      "createElement('div')",
      "document.createElement('div')",
      '',
    ].join('\n')
    const result = await transformWithCodeFinder(source, FILE, { enabled: true })
    expect(result!.code).not.toContain('data-locatorjs')
  })

  it('react import / require 绑定注入，其它来源 import 不注入', async () => {
    const named = [
      "import { createElement } from 'react'",
      "createElement('p', { id: 'a' })",
      '',
    ].join('\n')
    expect((await transformWithCodeFinder(named, FILE, { enabled: true }))!.code).toContain('data-locatorjs')

    const cjs = [
      "const React = require('react')",
      "React.createElement('p', { id: 'a' })",
      '',
    ].join('\n')
    expect((await transformWithCodeFinder(cjs, FILE, { enabled: true }))!.code).toContain('data-locatorjs')

    const other = [
      "import { createElement } from './dom'",
      "createElement('div')",
      '',
    ].join('\n')
    expect((await transformWithCodeFinder(other, FILE, { enabled: true }))!.code).not.toContain('data-locatorjs')

    // react 具名导入的被调用（非工厂）也不注入：useState({...}) 这类对象参数绝不能碰
    const hook = [
      "import { useState } from 'react'",
      'const [state] = useState({ a: 1 })',
      '',
    ].join('\n')
    expect((await transformWithCodeFinder(hook, FILE, { enabled: true }))!.code).not.toContain('data-locatorjs')
  })

  it('jsx/jsxs/_jsx 运行时风格变体注入（含命名空间成员形态）', async () => {
    const source = [
      "import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime'",
      "_jsx('a', { href: '#' })",
      "_jsxs('ul', { children: [] })",
      "jsx_runtime.jsx('b', {})",
      "jsx('c', {})",
      '',
    ].join('\n')
    const result = await transformWithCodeFinder(source, FILE, { enabled: true })
    expect(result).not.toBeNull()
    expect(result!.code.match(/data-locatorjs/g)).toHaveLength(4)
  })

  it('classic script 形态：全局 React / window.React 别名 / 成员取用别名都注入', async () => {
    const classic = [
      'var React = window.React;',
      "React.createElement('div', { a: 1 })",
      '',
      'var h = React.createElement;',
      "h('span', { b: 2 })",
      '',
      "window.React.createElement('p', { c: 3 })",
      '',
      'var R = globalThis.React;',
      "R.createElement('em', { d: 4 })",
      '',
    ].join('\n')
    const result = await transformWithCodeFinder(classic, FILE, { enabled: true })
    expect(result).not.toBeNull()
    // 4 处调用全部注入
    expect(result!.code.match(/data-locatorjs/g)).toHaveLength(4)
  })

  it('React 被本地遮蔽时成员形态不注入', async () => {
    const shadowed = [
      "import React from 'react'",
      'function wrap(React) {',
      "  return React.createElement('div')",
      '}',
      '',
    ].join('\n')
    const result = await transformWithCodeFinder(shadowed, FILE, { enabled: true })
    expect(result!.code).not.toContain('data-locatorjs')
  })

  it('重复 instrument 幂等：已注入 key 跳过、不重复注入', async () => {
    const once = await transformWithCodeFinder(SAMPLE_CREATE_ELEMENT, FILE, { enabled: true })
    const twice = await transformWithCodeFinder(once!.code, FILE, { enabled: true })
    // 已注入的调用不再注入：data-locatorjs 标记数量不变（注：@locator/babel-jsx
    // 的 components 注册表 IIFE 每次 transform 都会追加——上游既有行为，与本
    // 插件的幂等无关；字节级稳定由 instrument 层保证）。
    const count = (code: string): number => code.split('data-locatorjs').length - 1
    expect(count(twice!.code)).toBe(count(once!.code))
  })

  it('JSX 与 createElement 混用：两种注入并存，注册表不互相覆盖', async () => {
    const source = [
      "import React from 'react'",
      "export function View() {",
      "  return <div>{React.createElement('span', { k: 1 })}</div>",
      '}',
      '',
    ].join('\n')
    const result = await transformWithCodeFinder(source, '/proj/src/View.jsx', { enabled: true })
    expect(result).not.toBeNull()
    const code = result!.code
    // createElement 注入（对象属性形态）
    expect(code).toMatch(/"data-locatorjs": "[^"]*View\.jsx:\d+:\d+"/u)
    // JSX 注入（属性形态）仍然在
    expect(code).toContain('data-locatorjs={"')
    // 两个独立的注册表 IIFE（locator 完整文件项 + 我们的 expressionsCE 补丁）
    expect(code).toContain('__LOCATOR_DATA__')
    expect(code).toContain('expressionsCE')
  })

  it('生产语义与 node_modules 不注入 createElement', async () => {
    expect(await transformWithCodeFinder(SAMPLE_CREATE_ELEMENT, FILE, { enabled: false })).toBeNull()
    expect(await transformWithCodeFinder(
      SAMPLE_CREATE_ELEMENT,
      '/proj/node_modules/pkg/Widget.js',
      { enabled: true },
    )).toBeNull()
  })
})
