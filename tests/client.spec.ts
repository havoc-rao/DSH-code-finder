/**
 * setupCodeFinder 运行时冒烟（M2 核心）：热键捕获、hover 解析链 → overlay、
 * click 默认复制 + toast、destroy 解绑、输入框/IME 内不触发。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupCodeFinder } from '../src/client/index'

function pressKeys(opts: { alt?: boolean; shift?: boolean; meta?: boolean; ctrl?: boolean }): void {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    altKey: opts.alt ?? false,
    shiftKey: opts.shift ?? false,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    key: opts.alt ? 'Alt' : 'Shift',
  }))
}

function hover(element: Element): void {
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }))
}

function click(element: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

/** jsdom 的 getBoundingClientRect 全零——overlay 的零尺寸守卫会隐藏，需 mock 尺寸。 */
function mockRect(element: Element): void {
  element.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 100, height: 24, right: 100, bottom: 24, x: 0, y: 0,
    toJSON: () => ({}),
  })
}

/** 找到 overlay 宿主（shadow root 持有边框/标签）。 */
function overlayHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>('div[style*="2147482999"]')
}

/** 命中层（热键按住时接管指针事件的全屏透明层）。 */
function pickLayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-dsh-code-finder-layer]')
}

/** 命中层落点反查的桩：真实浏览器里由 document.elementFromPoint 给出坐标下的元素。 */
function stubElementFromPoint(element: Element | null): void {
  Object.defineProperty(document, 'elementFromPoint', {
    value: vi.fn(() => element),
    configurable: true,
    writable: true,
  })
}

/** 在命中层上模拟真实指针事件（target 是层本身，坐标反查才是真实元素）。 */
function pointerOnLayer(type: string, x = 50, y = 50): MouseEvent {
  const layer = pickLayer()
  if (layer === null) throw new Error('pick layer not mounted')
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  layer.dispatchEvent(event)
  return event
}

/** 边框当前是否可见（宿主创建后常驻，可见性才是状态）。 */
function boxVisible(): boolean {
  return overlayHost()?.shadowRoot?.querySelector('.cf-box')?.classList.contains('visible') ?? false
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  // runtime 严格 dev 语义：只有 NODE_ENV=development 才启用（vitest 默认是 test）
  vi.stubEnv('NODE_ENV', 'development')
  document.body.innerHTML = ''
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  delete (document as unknown as Record<string, unknown>).elementFromPoint
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('setupCodeFinder', () => {
  it('幂等单例：重复 setup 先销毁旧实例', () => {
    const first = setupCodeFinder({})
    const host1 = overlayHost()
    const second = setupCodeFinder({})
    expect(overlayHost()).not.toBe(host1)
    expect(overlayHost()).not.toBeNull()
    first.destroy()
    second.destroy()
    expect(overlayHost()).toBeNull()
  })

  it('按住 Opt+Shift 悬停 → 解析 data-locatorjs 并显示 overlay；松开隐藏', () => {
    const handle = setupCodeFinder({})
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    mockRect(el)
    document.body.appendChild(el)

    pressKeys({ alt: true, shift: true })
    hover(el)
    expect(boxVisible()).toBe(true)
    const shadow = overlayHost()!.shadowRoot!
    const label = shadow.querySelector('.cf-label')
    expect(label!.textContent).toContain('/abs/src/Sidebar.tsx:42')
    // 两行结构：第一行 <组件名>，第二行完整路径:行（不显示列）。
    // jsdom 元素无 fiber/注册表 → 名字回退「未知组件」；真实名字由 fiber 提供。
    const nameEl = shadow.querySelector('.cf-name')
    const pathEl = shadow.querySelector('.cf-path')
    expect(nameEl!.textContent).toBe('<未知组件>')
    expect(pathEl!.textContent).toBe('/abs/src/Sidebar.tsx:42')
    // 挂上 fake fiber（type 为具名函数）→ 名字升级为真实组件名
    ;(el as unknown as Record<string, unknown>)['__reactFiber$smoke'] = { type: function Sidebar(): null { return null }, return: null }
    hover(el)
    expect(shadow.querySelector('.cf-name')!.textContent).toBe('<Sidebar>')

    // 松开热键 → 隐藏
    window.dispatchEvent(new KeyboardEvent('keyup', { altKey: false, shiftKey: true }))
    expect(boxVisible()).toBe(false)
    handle.destroy()
  })

  it('MODE 通道不再兜底判生产（wire bundle 的 import.meta 被替换为 {} 的回归）', () => {
    // DSH wire bundle 是 CJS 产物，rolldown 把 import.meta 替换成 {}，MODE 恒为
    // undefined——若 runtime 用「MODE !== development 即生产」兜底，宿主里会
    // 静默吞掉 overlay（曾实测：strict 化后 DSH 宿主蓝框消失）。process 通道
    // 判定后必须直接返回，MODE 不得参与。
    vi.stubEnv('MODE', 'production')
    const handle = setupCodeFinder({})
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/A.tsx:1:1')
    mockRect(el)
    document.body.appendChild(el)

    pressKeys({ alt: true, shift: true })
    hover(el)
    expect(boxVisible()).toBe(true)
    handle.destroy()
  })

  it('未按住热键不显示；仅 Alt 不满足 alt+shift', () => {
    const handle = setupCodeFinder({})
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/A.tsx:1:1')
    mockRect(el)
    document.body.appendChild(el)

    hover(el)
    expect(boxVisible()).toBe(false)
    pressKeys({ alt: true })
    hover(el)
    expect(boxVisible()).toBe(false)
    handle.destroy()
  })

  it('输入框 / contentEditable 内悬停不触发', () => {
    const handle = setupCodeFinder({})
    const input = document.createElement('input')
    mockRect(input)
    document.body.appendChild(input)
    pressKeys({ alt: true, shift: true })
    hover(input)
    expect(boxVisible()).toBe(false)
    handle.destroy()
  })

  it('click 默认动作：复制 path:line（无列）并 toast', async () => {
    const handle = setupCodeFinder({})
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    mockRect(el)
    document.body.appendChild(el)

    pressKeys({ alt: true, shift: true })
    hover(el)
    click(el)
    await flush()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/abs/src/Sidebar.tsx:42')
    const toast = overlayHost()!.shadowRoot!.querySelector('.cf-toast')
    expect(toast!.textContent).toContain('已复制')
    handle.destroy()
  })

  it('click 复制带父组件链（chain 长度 >1 时，`<链> path:line`，无列）', async () => {
    // 注册表形状与 resolve.spec ①f2 一致：表达式经 wrappingComponentId 指向
    // components 链（最外层 → 最内层；本例 App › Sidebar 两层包裹，各带
    // 组件声明 loc——复制时每层输出 `Name (path:line)`）。
    ;(window as unknown as { __LOCATOR_DATA__: Record<string, unknown> }).__LOCATOR_DATA__ = {
      '/abs/src/Sidebar.tsx': {
        filePath: '/abs/src/Sidebar.tsx',
        projectPath: '/abs',
        expressions: {
          '0': { name: 'button', loc: { start: { line: 42, column: 10 }, end: { line: 42, column: 30 } }, wrappingComponentId: 2 },
        },
        components: {
          '0': { name: 'App', loc: { start: { line: 5, column: 1 }, end: { line: 5, column: 20 } } },
          '2': { name: 'Sidebar', loc: { start: { line: 30, column: 2 }, end: { line: 30, column: 30 } }, wrappingComponentId: 0 },
        },
        styledDefinitions: {},
      },
    }
    const handle = setupCodeFinder({})
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    mockRect(el)
    document.body.appendChild(el)

    pressKeys({ alt: true, shift: true })
    hover(el)
    click(el)
    await flush()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '<App (/abs/src/Sidebar.tsx:5) › Sidebar (/abs/src/Sidebar.tsx:30)> /abs/src/Sidebar.tsx:42',
    )
    handle.destroy()
    delete (window as unknown as { __LOCATOR_DATA__?: unknown }).__LOCATOR_DATA__
  })

  it('onClick 覆盖默认动作，且阻止默认行为', () => {
    const onClick = vi.fn()
    const handle = setupCodeFinder({ onClick })
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    mockRect(el)
    document.body.appendChild(el)

    pressKeys({ alt: true, shift: true })
    hover(el)
    const event = click(el)
    expect(onClick).toHaveBeenCalledOnce()
    expect(onClick.mock.calls[0]?.[0]).toMatchObject({ path: '/abs/src/Sidebar.tsx', line: 42, source: 'data' })
    expect(event.defaultPrevented).toBe(true)
    handle.destroy()
  })

  it('热键按住挂载命中层，松开 / 失焦 / destroy 都撤掉', () => {
    const handle = setupCodeFinder({})
    expect(pickLayer()).toBeNull()

    pressKeys({ alt: true, shift: true })
    expect(pickLayer()).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keyup', { altKey: false, shiftKey: false }))
    expect(pickLayer()).toBeNull()

    // 切走窗口时 keyup 可能永远不来：失焦必须撤层，否则全屏层会吃掉整个页面交互
    pressKeys({ alt: true, shift: true })
    expect(pickLayer()).not.toBeNull()
    window.dispatchEvent(new Event('blur'))
    expect(pickLayer()).toBeNull()

    pressKeys({ alt: true, shift: true })
    handle.destroy()
    expect(pickLayer()).toBeNull()
  })

  it('disabled 按钮（click 被浏览器吞掉）经命中层坐标反查，仍能取到 path 并复制', async () => {
    // 真实浏览器里的复现：指针停在 disabled button 上时 document 捕获层收不到
    // click（Chrome 实测连 mousedown/mouseup 都没有），父级监听同样收不到。
    // 命中层把事件收过来后，用 elementFromPoint 反查回 disabled 按钮本身。
    const handle = setupCodeFinder({})
    const button = document.createElement('button')
    button.disabled = true
    button.setAttribute('data-locatorjs', '/abs/src/CommitAction.tsx:214:8')
    mockRect(button)
    document.body.appendChild(button)

    pressKeys({ alt: true, shift: true })
    stubElementFromPoint(button)

    pointerOnLayer('mousemove')
    expect(boxVisible()).toBe(true)
    const label = overlayHost()!.shadowRoot!.querySelector('.cf-label')!
    expect(label.textContent).toContain('/abs/src/CommitAction.tsx:214')

    pointerOnLayer('click')
    await flush()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('/abs/src/CommitAction.tsx:214')
    handle.destroy()
  })

  it('命中层反查到输入框时不触发（isEditableTarget 判定的是真实元素）', () => {
    const handle = setupCodeFinder({})
    const input = document.createElement('input')
    mockRect(input)
    document.body.appendChild(input)

    pressKeys({ alt: true, shift: true })
    stubElementFromPoint(input)
    pointerOnLayer('mousemove')
    expect(boxVisible()).toBe(false)
    handle.destroy()
  })

  it('searchEndpoint 打开时，名字级命中异步升级为 search 命中', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: [{ file: '/abs/src/ChatPanel.tsx', line: 12, column: 3 }] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const handle = setupCodeFinder({ searchEndpoint: '/code-finder/api/search' })
    const el = document.createElement('div')
    mockRect(el)
    document.body.appendChild(el)
    ;(el as unknown as Record<string, unknown>)['__reactFiber$smoke'] = { type: function ChatPanel(): null { return null }, return: null }

    pressKeys({ alt: true, shift: true })
    hover(el)
    await vi.waitFor(() => {
      expect(overlayHost()!.shadowRoot!.querySelector('.cf-label')!.textContent).toContain('ChatPanel.tsx:12')
    })
    expect(fetchMock).toHaveBeenCalledWith('/code-finder/api/search', expect.objectContaining({ method: 'POST' }))
    handle.destroy()
    vi.unstubAllGlobals()
  })

  it('sourcemapEndpoint 打开时，产物路径命中异步反查为 src 路径（第⑤层）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { path: '/abs/src/client/chat/MessageItem.tsx', line: 96, column: 12 } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const handle = setupCodeFinder({ sourcemapEndpoint: '/code-finder/api/sourcemap' })
    const el = document.createElement('div')
    // 产物坐标：lib/types/...js 的 1-based 行列（用户实测形状）
    el.setAttribute('data-locatorjs', '/abs/repo/packages/ui/lib/types/client/chat/MessageItem.js:2:5')
    mockRect(el)
    document.body.appendChild(el)

    pressKeys({ alt: true, shift: true })
    hover(el)
    await vi.waitFor(() => {
      expect(overlayHost()!.shadowRoot!.querySelector('.cf-label')!.textContent).toContain('MessageItem.tsx:96')
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/code-finder/api/sourcemap',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: '/abs/repo/packages/ui/lib/types/client/chat/MessageItem.js', line: 2, column: 5 }),
      }),
    )
    handle.destroy()
    vi.unstubAllGlobals()
  })

  it('源码路径命中不触发第⑤层（src 下无需反查）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const handle = setupCodeFinder({ sourcemapEndpoint: '/code-finder/api/sourcemap' })
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    mockRect(el)
    document.body.appendChild(el)

    pressKeys({ alt: true, shift: true })
    hover(el)
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    handle.destroy()
    vi.unstubAllGlobals()
  })

  it('hover 注入元素的内部子元素：上溯最近注入祖先显示 path（prod 宿主无 fiber 也能定位）', () => {
    const handle = setupCodeFinder({})
    // 生产 React 宿主：无 fiber key、无 DevTools hook——resolve 只能靠注入属性。
    const root = document.createElement('div')
    root.setAttribute('data-locatorjs', '/abs/src/CommitAction.tsx:214:8')
    mockRect(root)
    const mid = document.createElement('section')
    const leaf = document.createElement('span')
    leaf.textContent = '内部文本'
    mid.appendChild(leaf)
    root.appendChild(mid)
    mid.getBoundingClientRect = root.getBoundingClientRect
    leaf.getBoundingClientRect = root.getBoundingClientRect
    document.body.appendChild(root)

    pressKeys({ alt: true, shift: true })
    hover(leaf)
    expect(boxVisible()).toBe(true)
    const label = overlayHost()!.shadowRoot!.querySelector('.cf-label')!
    expect(label.textContent).toContain('/abs/src/CommitAction.tsx:214')
    // 蓝框框住的是注入祖先（其 rect 被 mock 成可见）——overlay 宿主 box 尺寸
    // 断言以 root 为基准即可（不直接断言像素）。
    handle.destroy()
  })

  it('click 落入注入元素的内部子元素：复制的是最近注入祖先的 path', async () => {
    const onClick = vi.fn()
    const handle = setupCodeFinder({ onClick })
    const root = document.createElement('div')
    root.setAttribute('data-locatorjs', '/abs/src/Sidebar.tsx:42:10')
    mockRect(root)
    const leaf = document.createElement('span')
    root.appendChild(leaf)
    leaf.getBoundingClientRect = root.getBoundingClientRect
    document.body.appendChild(root)

    pressKeys({ alt: true, shift: true })
    click(leaf)
    expect(onClick).toHaveBeenCalledOnce()
    expect(onClick.mock.calls[0]?.[0]).toMatchObject({ path: '/abs/src/Sidebar.tsx', line: 42, source: 'data' })
    handle.destroy()
  })

  it('hotkeys: null 关闭热键：按住 Alt+Shift 不挂命中层、不显示 overlay', () => {
    const handle = setupCodeFinder({ hotkeys: null })
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/A.tsx:1:1')
    mockRect(el)
    document.body.appendChild(el)

    pressKeys({ alt: true, shift: true })
    expect(pickLayer()).toBeNull()
    hover(el)
    expect(boxVisible()).toBe(false)
    handle.destroy()
  })

  it('destroy 解绑全部监听并移除 overlay', () => {
    const handle = setupCodeFinder({})
    const el = document.createElement('div')
    el.setAttribute('data-locatorjs', '/abs/src/A.tsx:1:1')
    mockRect(el)
    document.body.appendChild(el)
    handle.destroy()
    pressKeys({ alt: true, shift: true })
    hover(el)
    expect(overlayHost()).toBeNull()
    handle.destroy() // 幂等
  })
})
