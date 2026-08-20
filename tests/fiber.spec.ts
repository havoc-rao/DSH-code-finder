/**
 * fiber 提取测试（plan §3.2 双路径 + 组件名/调试源提取）：
 * - DevTools hook findFiberByHostInstance 优先，__reactFiber$* 属性兜底；
 * - findComponentFiber 沿 return 链跳过 host 组件；
 * - displayName / name / forwardRef / memo / lazy 的组件名提取；
 * - _debugSource 与 React 19 _debugInfo 读取。
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  findComponentFiber,
  findFiberByDomNode,
  getComponentName,
  getDebugSource,
  type FiberLike,
} from '../src/client/fiber'

/** 造一条 fiber 链：host('div') → 组件(Sidebar)。 */
function makeFiberChain(componentType: unknown): { host: FiberLike; component: FiberLike } {
  const component: FiberLike = {
    type: componentType,
    return: null,
    _debugSource: { fileName: '/abs/src/Sidebar.tsx', lineNumber: 12, columnNumber: 3 },
  }
  const host: FiberLike = { type: 'div', return: component }
  return { host, component }
}

afterEach(() => {
  delete (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__
})

describe('findFiberByDomNode', () => {
  it('__reactFiber$* 属性兜底（React 18/19 随机后缀）', () => {
    const el = document.createElement('div')
    const fiber = { type: 'div', return: null }
    ;(el as unknown as Record<string, unknown>)['__reactFiber$abc123'] = fiber
    expect(findFiberByDomNode(el)).toBe(fiber)
  })

  it('__reactInternalInstance$* 兼容旧版属性名', () => {
    const el = document.createElement('div')
    const fiber = { type: 'div', return: null }
    ;(el as unknown as Record<string, unknown>)['__reactInternalInstance$xyz'] = fiber
    expect(findFiberByDomNode(el)).toBe(fiber)
  })

  it('DevTools hook 的 findFiberByHostInstance 优先', () => {
    const el = document.createElement('div')
    const viaHook = { type: 'span', return: null }
    const viaKey = { type: 'div', return: null }
    ;(el as unknown as Record<string, unknown>)['__reactFiber$fallback'] = viaKey
    ;(window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map([[1, { findFiberByHostInstance: (dom: Element) => (dom === el ? viaHook : null) }]]),
    }
    expect(findFiberByDomNode(el)).toBe(viaHook)
  })

  it('hook renderers 是普通对象时也兼容（防御式遍历）', () => {
    const el = document.createElement('div')
    const viaHook = { type: 'span', return: null }
    ;(window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown }).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: { 1: { findFiberByHostInstance: (dom: Element) => (dom === el ? viaHook : null) } },
    }
    expect(findFiberByDomNode(el)).toBe(viaHook)
  })

  it('目标节点无 fiber 时沿 DOM 祖先上溯', () => {
    const wrapper = document.createElement('div')
    const child = document.createElement('span')
    wrapper.appendChild(child)
    const fiber = { type: 'div', return: null }
    ;(wrapper as unknown as Record<string, unknown>)['__reactFiber$up'] = fiber
    expect(findFiberByDomNode(child)).toBe(fiber)
  })

  it('无 fiber 返回 null', () => {
    expect(findFiberByDomNode(document.createElement('p'))).toBeNull()
  })
})

describe('findComponentFiber', () => {
  it('跳过 host 组件，返回最近的组件 fiber', () => {
    const { host, component } = makeFiberChain(function Sidebar(): null { return null })
    expect(findComponentFiber(host)).toBe(component)
  })

  it('对象包装（forwardRef/memo）也是组件', () => {
    const { host, component } = makeFiberChain({ render: function Wrapped(): null { return null } })
    expect(findComponentFiber(host)).toBe(component)
  })

  it('null 输入返回 null', () => {
    expect(findComponentFiber(null)).toBeNull()
  })
})

describe('getComponentName', () => {
  it('displayName 优先于函数名', () => {
    const type = Object.assign(function Inner(): null { return null }, { displayName: 'Sidebar' })
    expect(getComponentName({ type, return: null })).toBe('Sidebar')
  })

  it('匿名函数无名字 → undefined', () => {
    // 函数返回值位置的箭头函数不触发命名推断，name 为空。
    const makeAnon = (): (() => null) => () => null
    expect(getComponentName({ type: makeAnon(), return: null })).toBeUndefined()
  })

  it('forwardRef 取 displayName，再取 render 函数名', () => {
    const forwardRef = { displayName: 'Sidebar', render: function Inner(): null { return null } }
    expect(getComponentName({ type: forwardRef, return: null })).toBe('Sidebar')
    const noDisplay = { render: function Inner(): null { return null } }
    expect(getComponentName({ type: noDisplay, return: null })).toBe('Inner')
  })

  it('memo 取内层组件名', () => {
    const memo = { type: function Inner(): null { return null } }
    expect(getComponentName({ type: memo, return: null })).toBe('Inner')
  })

  it('React 19 elementType 保留原始类型名', () => {
    const fiber = {
      type: { $$typeof: Symbol.for('react.memo') },
      elementType: function Sidebar(): null { return null },
      return: null,
    }
    expect(getComponentName(fiber)).toBe('Sidebar')
  })

  it('host 组件（字符串 type）→ undefined', () => {
    expect(getComponentName({ type: 'div', return: null })).toBeUndefined()
  })
})

describe('getDebugSource', () => {
  it('直接读 _debugSource', () => {
    const { component } = makeFiberChain(function Sidebar(): null { return null })
    expect(getDebugSource(component)).toEqual({ fileName: '/abs/src/Sidebar.tsx', lineNumber: 12, columnNumber: 3 })
  })

  it('React 19 _debugInfo 数组条目带 _debugSource', () => {
    const fiber: FiberLike = {
      type: function Sidebar(): null { return null },
      return: null,
      _debugInfo: [{ _debugSource: { fileName: '/abs/src/Sidebar.tsx', lineNumber: 5, columnNumber: 1 } }],
    }
    expect(getDebugSource(fiber)).toEqual({ fileName: '/abs/src/Sidebar.tsx', lineNumber: 5, columnNumber: 1 })
  })

  it('生产 fiber 无 _debugSource → undefined', () => {
    const fiber: FiberLike = { type: function Sidebar(): null { return null }, return: null }
    expect(getDebugSource(fiber)).toBeUndefined()
  })
})
