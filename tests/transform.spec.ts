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
    expect(codeFinderEnabled(undefined)).toBe(true)
  })

  it('未设 NODE_ENV 与 production 一样默认关闭', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(codeFinderEnabled(undefined)).toBe(false)
    vi.stubEnv('NODE_ENV', '')
    expect(codeFinderEnabled(undefined)).toBe(false)
  })

  it('显式 enabled 是唯一覆盖层（独立于 NODE_ENV）', () => {
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
    // 包裹组件链：Badge = components["ce-0"]，条目的 wrappingComponentId 指向它
    expect(code).toContain('"wrappingComponentId": "ce-0"')
    // createElement 通道的 components 链写入注册表（多层组件 path 的数据基础）：
    // components["ce-0"] = Badge，带声明位置；无外层包裹组件时不带 wrappingComponentId
    expect(code).toMatch(/"components":\s*\{\s*"ce-0":\s*\{\s*"name":\s*"Badge"/u)
  })

  it('箭头组件进入包裹链：嵌套声明可还原多层组件 path', async () => {
    const source = [
      "import React from 'react'",
      'export function Panel() {',
      "  const Header = (props) => React.createElement('h1', null, React.createElement('b', { k: 2 }, props.text))",
      "  return React.createElement('div', null, React.createElement(Header, null), React.createElement('span', { k: 1 }))",
      '}',
      '',
    ].join('\n')
    const result = await transformWithCodeFinder(source, FILE, { enabled: true })
    expect(result).not.toBeNull()
    const code = result!.code
    // 组件收集：Panel = components["ce-0"]（function 声明），嵌套箭头 Header = components["ce-1"]
    // （包裹组件 = ce-0）；Header 体内的 <b> 表达式 wrappingComponentId = "ce-1"，可上溯出
    // ["Panel", "Header"] 的多层 path。
    expect(code).toMatch(/"ce-0":\s*\{\s*"name":\s*"Panel"/u)
    expect(code).toMatch(/"ce-1":\s*\{\s*"name":\s*"Header"[\s\S]{0,400}"wrappingComponentId":\s*"ce-0"/u)
    expect(code).toMatch(/"wrappingComponentId":\s*"ce-1"/u)
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

describe('transformWithCodeFinder: React Fragment 绝不注入', () => {
  const FILE = '/proj/src/Frags.tsx'
  const RUN = (code: string, options: Parameters<typeof transformWithCodeFinder>[2] = {}) =>
    transformWithCodeFinder(code, FILE, { enabled: true, projectRoot: '/proj', ...options })

  /** data-locatorjs 出现次数（属性 + 注册表条目一并统计）。 */
  const count = (code: string): number => code.split('data-locatorjs').length - 1

  it('简写 <>...</>：fragment 自身与注册表零注入（JSXFragment 形态）', async () => {
    const source = [
      "import { Fragment } from 'react'",
      'export function A(props) {',
      '  return <>{props.fallback ?? null}</>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    expect(result).not.toBeNull()
    // fragment 无属性、子无元素 → 全文件一个 locator 属性都不该有（注册表 expressions 也为空）
    expect(result!.code).not.toContain('data-locatorjs')
  })

  it('简写 <>...</> 带子元素：子元素正常注入，fragment 自身不注入', async () => {
    const source = [
      "import { Fragment } from 'react'",
      'export function A(props) {',
      '  return <>',
      '    <div>a</div>',
      '    <span>b</span>',
      '  </>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    // 两个子元素注入；fragment 简写没有可挂属性的位置，字面断言 `<>` 后不出现 locator 值
    expect(count(code)).toBe(2)
    expect(code).not.toMatch(/<>\s*\{\s*"data-locatorjs"/u)
    expect(code).not.toContain('"name": "Fragment"')
  })

  it('显式 <Fragment>：openingElement 无 locator 属性、注册表无 Fragment 条目，子元素照常', async () => {
    const source = [
      "import { Fragment } from 'react'",
      'export function B() {',
      '  return <Fragment><div>b</div></Fragment>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(code).toContain('</Fragment>')
    expect(code).not.toMatch(/<Fragment\s+data-locatorjs/u)
    expect(code).not.toContain('"name": "Fragment"')
    expect(count(code)).toBe(1) // 仅子 div
  })

  it('显式 <React.Fragment>：同样跳过', async () => {
    const source = [
      "import React from 'react'",
      'export function C() {',
      '  return <React.Fragment><div>c</div></React.Fragment>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(code).toContain('</React.Fragment>')
    expect(code).not.toMatch(/<React\.Fragment\s+data-locatorjs/u)
    expect(code).not.toContain('"name": "React.Fragment"')
    expect(count(code)).toBe(1)
  })

  it('别名 <F>（const F = Fragment）：上游注入的属性被补偿剥离，注册表条目被清理', async () => {
    const source = [
      "import { Fragment } from 'react'",
      'export function D() {',
      '  const F = Fragment',
      '  return <><F marker={1} /><div marker={2} /></>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    // 只有子 div 注入
    expect(count(code)).toBe(1)
    expect(code).not.toMatch(/<F\s+[^>]*data-locatorjs/u)
    expect(code).not.toContain('"name": "F"')
    // 注册表 expressions：F 的条目被挖洞、div 条目保留（数组索引不被挤压）
    expect(code).toMatch(/"expressions": \[, \{\s*"name": "div"/s)
  })

  it('成员别名 <FR.Fragment>（const FR = React）：同样剥离且不残留条目', async () => {
    const source = [
      "import React, { Fragment } from 'react'",
      'export function E() {',
      '  const FR = React',
      '  return <><FR.Fragment marker={1} /><i marker={2} /></>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(count(code)).toBe(1)
    expect(code).not.toMatch(/<FR\.Fragment\s+[^>]*data-locatorjs/u)
    expect(code).not.toContain('"name": "FR.Fragment"')
    expect(code).toContain('"name": "i"')
  })

  it('id 模式：别名 fragment 同样无 data-locatorjs-id、无注册表残留', async () => {
    const source = [
      "import { Fragment } from 'react'",
      'export function D() {',
      '  const F = Fragment',
      '  return <><F marker={1} /><div marker={2} /></>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source, { dataAttribute: 'id' })
    const code = result!.code
    expect(code.split('data-locatorjs-id').length - 1).toBe(1) // 仅 div
    expect(code).not.toMatch(/<F\s+[^>]*data-locatorjs-id/u)
    expect(code).not.toContain('"name": "F"')
  })

  it('工厂 createElement(Fragment, ...)：不注入、不产生 expressionsCE 条目', async () => {
    const source = [
      "import React from 'react'",
      'export function G() {',
      "  return React.createElement(Fragment, { marker: 1 })",
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(code).not.toContain('data-locatorjs')
    expect(code).not.toContain('expressionsCE') // 零工厂条目 → 插件不追加 IIFE
  })

  it('工厂 jsx(Fragment, ...)（tsc 产物形态）：不注入、不产生 expressionsCE 条目', async () => {
    const source = [
      "import { jsx as _jsx } from 'react/jsx-runtime'",
      'export function H() {',
      "  return _jsx(Fragment, { children: 'hi' })",
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(code).not.toContain('data-locatorjs')
    expect(code).not.toContain('expressionsCE')
  })

  it('工厂别名 jsx(F, ...)（const F = Fragment）与解构 const { Fragment } = React：都跳过', async () => {
    const source = [
      "import React from 'react'",
      'export function H() {',
      '  const F = Fragment',
      "  return [F, React.createElement(Fragment, { marker: 1 })]",
      '}',
      'export function K() {',
      '  const { Fragment: G } = React',
      "  return React.createElement(G, { marker: 2 })",
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(code).not.toContain('data-locatorjs')
    expect(code).not.toContain('expressionsCE')
  })

  it('tsc 产物形态：import { Fragment as _Fragment, jsx as _jsx } from react/jsx-runtime 的 _jsx(_Fragment, ...) 跳过', async () => {
    // deepseek-harness 的 dev 管线在 tsc emit 上跑 transform——<>...</> 已被编译成
    // `_jsx(_Fragment, { children })`（别名 ImportSpecifier），是本问题的实测触发形态。
    const source = [
      'import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime"',
      'export function Slot({ children }) {',
      "  if (!children) return _jsx(_Fragment, { children: null })",
      "  return _jsx('div', { className: 'x', children: children })",
      '}',
      'export function List({ items }) {',
      "  return _jsxs(_Fragment, { children: items.map((item) => _jsx('span', { children: item })) })",
      '}',
      '',
    ].join('\n')
    const result = await RUN(source, { projectRoot: '/proj' })
    const code = result!.code
    // 两个 Fragment 调用零注入、零注册表条目；div/span 两个普通调用照常（各 1 个属性）
    expect(count(code)).toBe(2)
    expect(code).not.toMatch(/_jsx\(_Fragment, \{\s*children: null,\s*"data-locatorjs"/u)
    expect(code).not.toContain('"name": "_Fragment"')
    expect(code).toContain('"name": "div"')
  })

  it('JSX 侧别名 import { Fragment as F }：<F> 剥离且无注册表条目', async () => {
    const source = [
      'import { Fragment as F } from "react"',
      'export function A() {',
      '  return <><F marker={1} /><div marker={2} /></>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(count(code)).toBe(1) // 仅 div
    expect(code).not.toMatch(/<F\s+[^>]*data-locatorjs/u)
    expect(code).not.toContain('"name": "F"')
  })

  it('jsx.tsx 混编 + 对照组：普通 div/组件正常注入，fragment 形态全部干净', async () => {
    const source = [
      "import React, { Fragment } from 'react'",
      "import { jsx as _jsx } from 'react/jsx-runtime'",
      'export function M() {',
      '  const F = Fragment',
      '  return (',
      '    <>',
      '      <F marker={1} />',
      '      <Fragment marker={2} />',
      '      <React.Fragment marker={3} />',
      "      <div marker={4} />",
      "      {_jsx('span', { marker: 5 })}",
      "      {_jsx(F, { marker: 6 })}",
      '    </>',
      '  )',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    // div（JSX 属性）+ 工厂 span（对象属性）= 2 处注入；两个 _jsx(Fragment/F) 都跳过
    expect(count(code)).toBe(2)
    expect(code).not.toMatch(/<F\s+[^>]*data-locatorjs/u)
    expect(code).not.toMatch(/<Fragment\s+data-locatorjs/u)
    expect(code).not.toMatch(/<React\.Fragment\s+data-locatorjs/u)
    // 注册表：locator expressions 只有 div 一条（<F> 的条目已挖洞，div 是索引 1）；
    // expressionsCE 只有工厂 span 一条（c0）
    expect(code).toMatch(/"expressions": \[, \{\s*"name": "div"/s)
    expect(code).toMatch(/"expressionsCE": \{\s*"c0": \{\s*"name": "span"/s)
  })

  it('幂等收敛：老产物/stale 属性（<F data-locatorjs=...>、jsx(Fragment, {"data-locatorjs"})）被剥离', async () => {
    const source = [
      "import { Fragment } from 'react'",
      "import { jsx as _jsx } from 'react/jsx-runtime'",
      'export function W() {',
      '  const F = Fragment',
      '  return (',
      '    <>',
      '      <F data-locatorjs="stale:1:1" marker={1} />',
      '      {_jsx(Fragment, { children: "x", "data-locatorjs": "stale:2:2" })}',
      '    </>',
      '  )',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(code).not.toContain('stale:1:1')
    expect(code).not.toContain('stale:2:2')
    expect(code).not.toContain('data-locatorjs')
  })

  it('遮蔽守卫：本地同名组件（function F / const FR = MyLib）不是 react Fragment，照常注入', async () => {
    const source = [
      "import { Fragment } from 'react'",
      'function F() { return null }',
      'function MyLib() { return null }',
      'export function W() {',
      '  const FR = MyLib',
      '  return <><F marker={1} /><FR.Fragment marker={2} /></>',
      '}',
      '',
    ].join('\n')
    const result = await RUN(source)
    const code = result!.code
    expect(code).toMatch(/<F\s+[^>]*data-locatorjs/u)
    expect(code).toMatch(/<FR\.Fragment\s+[^>]*data-locatorjs/u)
    expect(code).toContain('"name": "F"')
    expect(code).toContain('"name": "FR.Fragment"')
    await expect(RUN(`export const N = () => null`)).resolves.not.toBeNull()
  })
})
