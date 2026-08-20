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

/** 边框当前是否可见（宿主创建后常驻，可见性才是状态）。 */
function boxVisible(): boolean {
  return overlayHost()?.shadowRoot?.querySelector('.cf-box')?.classList.contains('visible') ?? false
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

afterEach(() => {
  document.body.innerHTML = ''
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

  it('click 默认动作：复制 path:line 并 toast', async () => {
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
