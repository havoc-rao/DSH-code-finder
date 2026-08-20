/**
 * 解析链测试（plan §3.1）：优先级 ①data 属性 → ②fiber._debugSource →
 * ③组件名兜底；data-locatorjs / data-locatorjs-id 两种属性格式；
 * Windows 盘符冒号的路径切分。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { FiberLike } from '../src/client/fiber'
import { parseLocatorPath, resolveHit } from '../src/client/resolve'

/** 造一个最小 fiber（type 用真函数，让组件名可提取）。 */
function makeFiber(partial: Partial<FiberLike> = {}): FiberLike {
  const type = partial.type ?? function Sidebar(): null { return null }
  return { type, return: partial.return ?? null, ...partial }
}

beforeEach(() => {
  delete (window as unknown as { __LOCATOR_DATA__?: unknown }).__LOCATOR_DATA__
})

describe('parseLocatorPath', () => {
  it('解析 <absPath>:<line>:<col>', () => {
    expect(parseLocatorPath('/abs/src/Sidebar.tsx:42:10')).toEqual({
      path: '/abs/src/Sidebar.tsx',
      line: 42,
      column: 10,
    })
  })

  it('Windows 盘符冒号不干扰切分', () => {
    expect(parseLocatorPath('C:\\proj\\src\\A.tsx:10:4')).toEqual({
      path: 'C:\\proj\\src\\A.tsx',
      line: 10,
      column: 4,
    })
  })

  it('非法格式返回 undefined', () => {
    expect(parseLocatorPath('')).toBeUndefined()
    expect(parseLocatorPath('no-colons-here')).toBeUndefined()
    expect(parseLocatorPath('/a.tsx:xx:10')).toBeUndefined()
    expect(parseLocatorPath('/a.tsx:10')).toBeUndefined()
  })
})

describe('resolveHit 解析链', () => {
  it('① data-locatorjs 属性优先（与 fiber 位置并存时属性赢）', () => {
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    const fiber = makeFiber({
      type: function Sidebar(): null { return null },
      _debugSource: { fileName: '/abs/src/Other.tsx', lineNumber: 99, columnNumber: 1 },
    })
    const hit = resolveHit(element, fiber)
    expect(hit).toEqual({
      name: 'Sidebar',
      path: '/abs/src/Sidebar.tsx',
      line: 42,
      column: 10,
      source: 'data',
    })
  })

  it('①b data-locatorjs-id 通过 __LOCATOR_DATA__ 注册表反查', () => {
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/Sidebar.tsx': {
        filePath: '/abs/src/Sidebar.tsx',
        projectPath: '/abs',
        expressions: {
          '0': { name: 'Sidebar', start: { line: 7, column: 2 }, end: { line: 7, column: 20 } },
        },
        components: {},
        styledDefinitions: {},
      },
    }
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs-id', '/abs/src/Sidebar.tsx::0')
    const hit = resolveHit(element, makeFiber())
    expect(hit).toEqual({
      name: 'Sidebar',
      path: '/abs/src/Sidebar.tsx',
      line: 7,
      column: 2,
      source: 'data',
    })
  })

  it('② 无属性时用 fiber._debugSource（dev React 宿主）', () => {
    const element = document.createElement('div')
    const fiber = makeFiber({
      type: function Foo(): null { return null },
      _debugSource: { fileName: '/abs/src/Foo.tsx', lineNumber: 3, columnNumber: 5 },
    })
    const hit = resolveHit(element, fiber)
    expect(hit).toEqual({
      name: 'Foo',
      path: '/abs/src/Foo.tsx',
      line: 3,
      column: 5,
      source: 'fiber',
    })
  })

  it('②b React 19 的 _debugInfo 数组条目携带 _debugSource 也能用', () => {
    const element = document.createElement('div')
    const fiber = makeFiber({
      type: function Foo(): null { return null },
      _debugInfo: [{ _debugSource: { fileName: '/abs/src/Foo.tsx', lineNumber: 8, columnNumber: 1 } }],
    })
    const hit = resolveHit(element, fiber)
    expect(hit?.source).toBe('fiber')
    expect(hit?.path).toBe('/abs/src/Foo.tsx')
    expect(hit?.line).toBe(8)
  })

  it('③ 生产宿主（无 _debugSource）→ 组件名兜底', () => {
    const element = document.createElement('div')
    const hit = resolveHit(element, makeFiber({ type: function ChatPanel(): null { return null } }))
    expect(hit).toEqual({ name: 'ChatPanel', source: 'name-only' })
  })

  it('displayName 优先于函数名', () => {
    const element = document.createElement('div')
    const type = Object.assign(function Inner(): null { return null }, { displayName: 'Sidebar' })
    const hit = resolveHit(element, makeFiber({ type }))
    expect(hit?.name).toBe('Sidebar')
  })

  it('连名字都没有（非组件 / 无 fiber）→ null（overlay 隐藏）', () => {
    const element = document.createElement('div')
    expect(resolveHit(element, null)).toBeNull()
    expect(resolveHit(element, makeFiber({ type: 'div' }))).toBeNull()
  })
})
