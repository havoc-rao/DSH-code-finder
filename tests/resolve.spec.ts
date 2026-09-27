/**
 * 解析链测试（plan §3.1）：优先级 ①data 属性 → ②fiber._debugSource →
 * ③组件名兜底；data-locatorjs / data-locatorjs-id 两种属性格式；
 * Windows 盘符冒号的路径切分。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { FiberLike } from '../src/client/fiber'
import { isBuildArtifactPath, findLocatorElement, parseLocatorPath, resolveHit } from '../src/client/resolve'

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

describe('isBuildArtifactPath（第⑤层触发判定）', () => {
  it('产物路径命中：lib/dist/out/build 段（含 Windows 反斜杠）与产物 js 扩展名', () => {
    expect(isBuildArtifactPath('/repo/packages/ui/lib/types/client/chat/MessageItem.js')).toBe(true)
    expect(isBuildArtifactPath('/repo/dist/bundle.mjs')).toBe(true)
    expect(isBuildArtifactPath('C:\\repo\\out\\app.cjs')).toBe(true)
    expect(isBuildArtifactPath('/repo/build/renderer.js')).toBe(true)
    expect(isBuildArtifactPath('/repo/node_modules/x/lib/index.js')).toBe(true) // 有 /lib/ 段即产物
  })

  it('源码路径不命中：src 下的 js、tsx/ts 源文件', () => {
    expect(isBuildArtifactPath('/repo/src/foo.js')).toBe(false)
    expect(isBuildArtifactPath('/repo/packages/ui/src/client/index.ts')).toBe(false)
    expect(isBuildArtifactPath('/repo/packages/ui/src/client/chat/MessageItem.tsx')).toBe(false)
  })
})

describe('findLocatorElement（最近注入祖先上溯）', () => {
  it('自身带属性 → 返回自身', () => {
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/A.tsx:1:1')
    expect(findLocatorElement(element)).toBe(element)
  })

  it('内部子元素 → 上溯到最近带属性的祖先（path 格式）', () => {
    const root = document.createElement('div')
    root.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    const mid = document.createElement('section')
    const leaf = document.createElement('span')
    mid.appendChild(leaf)
    root.appendChild(mid)
    expect(findLocatorElement(leaf)).toBe(root)
  })

  it('data-locatorjs-id 格式同样命中', () => {
    const root = document.createElement('div')
    root.setAttribute('data-locatorjs-id', '/abs/src/Sidebar.tsx::c0')
    const leaf = document.createElement('span')
    root.appendChild(leaf)
    expect(findLocatorElement(leaf)).toBe(root)
  })

  it('无属性 → null（含超出深度上限）', () => {
    const leaf = document.createElement('span')
    expect(findLocatorElement(leaf)).toBeNull()
    // 深度上限：属性挂在 64 层之外时不再上溯
    const deepRoot = document.createElement('div')
    deepRoot.setAttribute('data-locatorjs', '/abs/src/A.tsx:1:1')
    let node = deepRoot
    for (let i = 0; i < 80; i += 1) {
      const child = document.createElement('div')
      node.appendChild(child)
      node = child
    }
    expect(findLocatorElement(node)).toBeNull()
    expect(findLocatorElement(node, 200)).toBe(deepRoot)
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
        // 真实注入形状：位置在 loc.start（@locator/babel-jsx）
        expressions: {
          '0': { name: 'Sidebar', loc: { start: { line: 7, column: 2 }, end: { line: 7, column: 20 } } },
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

  it('①b2 createElement 模式的 data-locatorjs-id（expressionsCE / c<n> id）反查', () => {
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/client.js': {
        filePath: '/abs/src/client.js',
        projectPath: '/abs/src',
        expressions: {},
        components: {},
        styledDefinitions: {},
        // createElement 插件注入形状：c<n> 字符串 id + wrappingComponentId
        expressionsCE: {
          c0: {
            name: 'button',
            loc: { start: { line: 12, column: 5 }, end: { line: 12, column: 30 } },
            wrappingComponentId: 0,
          },
        },
      },
    }
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs-id', '/abs/src/client.js::c0')
    const hit = resolveHit(element, makeFiber())
    expect(hit).toEqual({
      name: 'button',
      path: '/abs/src/client.js',
      line: 12,
      column: 5,
      source: 'data',
    })
  })

  it('①c data-locatorjs（path 格式）用注册表包裹组件名覆盖 minified fiber 名', () => {
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/Sidebar.tsx': {
        filePath: '/abs/src/Sidebar.tsx',
        projectPath: '/abs',
        // 真实注入形状：位置在 loc.start；表达式经 wrappingComponentId 指向包裹组件
        expressions: {
          '0': { name: 'button', loc: { start: { line: 42, column: 10 }, end: { line: 42, column: 30 } }, wrappingComponentId: 3 },
          '1': { name: 'ToggleCluster', loc: { start: { line: 100, column: 4 }, end: { line: 100, column: 40 } }, wrappingComponentId: 3 },
        },
        components: {
          '3': { name: 'Sidebar', locString: '207:7' },
        },
        styledDefinitions: {},
      },
    }
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    // 生产 React：fiber 组件名被压缩成 af
    const fiber = makeFiber({ type: function af(): null { return null } })
    const hit = resolveHit(element, fiber)
    // 最近表达式是 button（元素级），但链上溯到包裹组件 → Sidebar
    expect(hit).toEqual({
      name: 'Sidebar',
      path: '/abs/src/Sidebar.tsx',
      line: 42,
      column: 10,
      source: 'data',
    })
  })

  it('①f wrappingComponentId 链多级上溯取最外层包裹组件', () => {
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/Sidebar.tsx': {
        filePath: '/abs/src/Sidebar.tsx',
        projectPath: '/abs',
        expressions: {
          '0': { name: 'button', loc: { start: { line: 42, column: 10 }, end: { line: 42, column: 30 } }, wrappingComponentId: 0 },
        },
        components: {
          '0': { name: 'Tooltip', wrappingComponentId: 1 },
          '1': { name: 'Sidebar' },
        },
        styledDefinitions: {},
      },
    }
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    const hit = resolveHit(element, makeFiber({ type: function af(): null { return null } }))
    expect(hit?.name).toBe('Sidebar')
  })

  it('①f2 链上溯输出完整多层组件路径（chain 从最外层到最内层）', () => {
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/Sidebar.tsx': {
        filePath: '/abs/src/Sidebar.tsx',
        projectPath: '/abs',
        expressions: {
          '0': { name: 'button', loc: { start: { line: 42, column: 10 }, end: { line: 42, column: 30 } }, wrappingComponentId: 2 },
        },
        components: {
          '2': { name: 'Tooltip', wrappingComponentId: 1 },
          '1': { name: 'Sidebar', wrappingComponentId: 0 },
          '0': { name: 'App' },
        },
        styledDefinitions: {},
      },
    }
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    const hit = resolveHit(element, makeFiber({ type: function af(): null { return null } }))
    expect(hit?.chain).toEqual([
      { name: 'App', path: '/abs/src/Sidebar.tsx' },
      { name: 'Sidebar', path: '/abs/src/Sidebar.tsx' },
      { name: 'Tooltip', path: '/abs/src/Sidebar.tsx' },
    ])
    expect(hit?.name).toBe('App') // 单名查询仍取最外层（原语义）
  })

  it('①f3 单层包裹（链长 1）不携带 chain，name 保持包裹组件名', () => {
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/Sidebar.tsx': {
        filePath: '/abs/src/Sidebar.tsx',
        projectPath: '/abs',
        expressions: {
          '0': { name: 'button', loc: { start: { line: 42, column: 10 }, end: { line: 42, column: 30 } }, wrappingComponentId: 0 },
        },
        components: {
          '0': { name: 'Sidebar' },
        },
        styledDefinitions: {},
      },
    }
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    const hit = resolveHit(element, makeFiber({ type: function af(): null { return null } }))
    expect(hit?.chain).toBeUndefined()
    expect(hit?.name).toBe('Sidebar')
  })

  it('①f4 渲染树链优先：dev React 的 _debugOwner 上溯出跨文件组件路径', () => {
    // 注册表只有单层声明（FileTree 文件内无嵌套），但运行时 FileTree 被宿主
    // 侧边栏面板渲染——dev React 下 _debugOwner 链给出真实渲染树路径。
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/FileTree.tsx': {
        filePath: '/abs/src/FileTree.tsx',
        projectPath: '/abs',
        expressions: {
          '0': { name: 'div', loc: { start: { line: 1198, column: 4 }, end: { line: 1198, column: 20 } }, wrappingComponentId: 0 },
        },
        components: { '0': { name: 'FileTree' } },
        styledDefinitions: {},
      },
    }
    const fixture = makeFiber({
      type: function FileTree(): null { return null },
      _debugSource: { fileName: '/abs/src/FileTree.tsx', lineNumber: 1198, columnNumber: 8 },
      _debugOwner: makeFiber({
        type: function SidebarRightPanel(): null { return null },
        _debugSource: { fileName: '/abs/src/SidebarRightPanel.tsx', lineNumber: 88, columnNumber: 4 },
      }),
    })
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/FileTree.tsx:1198:4')
    const hit = resolveHit(element, fixture)
    // 链节点携带每层组件的声明位置（dev React _debugSource 的 file/line/col）
    expect(hit?.chain).toEqual([
      { name: 'SidebarRightPanel', path: '/abs/src/SidebarRightPanel.tsx', line: 88, column: 4 },
      { name: 'FileTree', path: '/abs/src/FileTree.tsx', line: 1198, column: 8 },
    ])
    expect(hit?.name).toBe('FileTree') // 名字仍取注册表反查（压缩名覆盖）
    expect(hit?.path).toBe('/abs/src/FileTree.tsx') // 位置仍来自构建期注入
  })

  it('渲染树链过滤宿主外壳包装（SlotOutlet/SlotErrorBoundary/RootEntry/RootOutlet 不进链）', () => {
    // DSH Slot 结构：业务组件外围交替嵌套 SlotErrorBoundary → RootEntry →
    // SlotOutlet；外壳 AppFrame 保留（提供上下文），包装层全部剔除。
    const fixture = makeFiber({
      type: function H5(): null { return null },
      _debugSource: { fileName: '/abs/src/H5.tsx', lineNumber: 10 },
      _debugOwner: makeFiber({
        type: function TreeRow(): null { return null },
        _debugSource: { fileName: '/abs/src/TreeRow.tsx', lineNumber: 20 },
        _debugOwner: makeFiber({
          type: function SlotOutlet(): null { return null },
          _debugSource: { fileName: '/abs/src/SlotOutlet.tsx', lineNumber: 5 },
          _debugOwner: makeFiber({
            type: function RootEntry(): null { return null },
            _debugSource: { fileName: '/abs/src/RootEntry.tsx', lineNumber: 8 },
            _debugOwner: makeFiber({
              type: function AppFrame(): null { return null },
              _debugSource: { fileName: '/abs/src/AppFrame.tsx', lineNumber: 44 },
            }),
          }),
        }),
      }),
    })
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/TreeRow.tsx:10:2')
    const hit = resolveHit(element, fixture)
    // 带位置的渲染链被采用（符合 renderChainLocated 条件），外壳包装被过滤
    expect(hit?.chain).toEqual([
      { name: 'AppFrame', path: '/abs/src/AppFrame.tsx', line: 44 },
      { name: 'TreeRow', path: '/abs/src/TreeRow.tsx', line: 20 },
      { name: 'H5', path: '/abs/src/H5.tsx', line: 10 },
    ])
    expect(hit?.chain?.some(node => node.name === 'SlotOutlet' || node.name === 'RootEntry')).toBe(false)
  })

  it('production React（fiber 无 _debugSource）裸渲染链不压制带位置的声明链', () => {
    // 宿主前端是 production React：fiber 无 _debugSource（链节点全裸名），但
    // 注入注册表里有同文件的 components 声明链（带 loc）——链应取声明链。
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/FileTree.tsx': {
        filePath: '/abs/src/FileTree.tsx',
        projectPath: '/abs',
        expressions: {
          '0': { name: 'li', loc: { start: { line: 1198, column: 4 }, end: { line: 1198, column: 20 } }, wrappingComponentId: 2 },
        },
        components: {
          '0': { name: 'App', loc: { start: { line: 5, column: 1 }, end: { line: 5, column: 20 } } },
          '2': { name: 'FileTree', loc: { start: { line: 30, column: 2 }, end: { line: 30, column: 40 } }, wrappingComponentId: 0 },
        },
        styledDefinitions: {},
      },
    }
    // 压缩名 fiber（af/bf...）沿 return 链兜底的渲染链：无 _debugSource → 节点裸名
    const fixture = makeFiber({
      type: function af(): null { return null },
      return: makeFiber({ type: function bf(): null { return null } }),
    })
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/FileTree.tsx:1198:4')
    const hit = resolveHit(element, fixture)
    // 声明链胜出：带位置的 App › FileTree（而非裸名 af › bf）
    expect(hit?.chain).toEqual([
      { name: 'App', path: '/abs/src/FileTree.tsx', line: 5, column: 1 },
      { name: 'FileTree', path: '/abs/src/FileTree.tsx', line: 30, column: 2 },
    ])
  })

  it('①d 注册表无该文件条目时回退 fiber 名（不吞掉位置）', () => {
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {}
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    const hit = resolveHit(element, makeFiber({ type: function af(): null { return null } }))
    expect(hit).toEqual({
      name: 'af',
      path: '/abs/src/Sidebar.tsx',
      line: 42,
      column: 10,
      source: 'data',
    })
  })

  it('①e 兼容旧 start 形状；无包裹组件时回退表达式名', () => {
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/Sidebar.tsx': {
        filePath: '/abs/src/Sidebar.tsx',
        projectPath: '/abs',
        expressions: {
          '0': { name: 'Sidebar', start: { line: 42, column: 10 }, end: { line: 42, column: 30 } },
        },
        components: {},
        styledDefinitions: {},
      },
    }
    const element = document.createElement('div')
    element.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    const hit = resolveHit(element, makeFiber({ type: function af(): null { return null } }))
    expect(hit?.name).toBe('Sidebar')
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
