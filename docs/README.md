# dsh-code-finder 接入指南

Dev-only React「组件 → 源码」定位工具：按住 **Opt+Shift**（`Alt+Shift`）悬停任意
React 组件 → overlay 显示组件名 + `文件:行:列`；**点击**打开源码（动作可插拔）。
仅 dev 构建生效，生产零负担、零注入；运行时零框架依赖（不 import react）。

接入方式按集成深度分三档：

| 方式 | 构建期注入（元素级精确行号） | fiber 名字级 | 源码搜索（宿主 UI 兜底） | 改动量 |
|---|---|---|---|---|
| A. vite 项目 | ✓ | ✓ | 可选 | 插件一行 + 入口一行 |
| B. tsdown 项目（DSH 插件 client bundle） | ✓ | ✓ | 可选 | 插件一行 + 入口一行 |
| C. cordis 纯 runtime（DSH 插件生态） | 不加则无 | ✓ | ✓（host 半自动挂路由） | `cordis.patch.yml` 两行 |

> 三层定位（plan §3.1）：**①构建期注入的 `data-locatorjs` 属性（精确）→
> ②fiber `_debugSource`（dev React 宿主）→ ③组件名兜底 → ④源码搜索（尽力而为）**。
> 生产 React 没有 `_debugSource`，宿主 UI 的精确行号在**不修改宿主构建**的前提下
> 不可达——名字级 + 搜索级是预期行为（见下文「宿主 UI 的定位能力」）。

---

## A. vite 项目

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { codeFinderVite } from '@omdsh-dev/dsh-code-finder/vite'

export default defineConfig({
  plugins: [react(), codeFinderVite()], // 只加这一行；dev-only，生产构建是 no-op
})
```

```ts
// 应用入口（仅 dev 生效，生产 tree-shake 掉）
if (import.meta.env.DEV) {
  const { setupCodeFinder } = await import('@omdsh-dev/dsh-code-finder/client')
  setupCodeFinder({})
}
```

现在按住 Opt+Shift 悬停任意 React 组件：应用自己构建的组件显示**元素级
`文件:行:列`**（构建期注入的属性在 DOM 上，生产宿主也生效）；点按即复制
`path:line:column`。

## B. tsdown 项目（DSH 插件 client bundle 同款构建）

```ts
// tsdown.config.ts —— client bundle 的 plugins 数组里加：
import { codeFinderTsdown } from '@omdsh-dev/dsh-code-finder/tsdown'
// ...
plugins: [codeFinderTsdown()],   // dev-only 注入 src/client/**（node_modules 自动跳过）
```

```ts
// 插件 client 入口（src/client/index.tsx，仅 dev 构建生效）
if (process.env.NODE_ENV !== 'production') {
  const { setupCodeFinder } = await import('@omdsh-dev/dsh-code-finder/client')
  setupCodeFinder({ onClick: (hit) => { /* 打开/复制 hit.path */ } })
}
```

> **不加构建插件也能用**：fiber 名字级 + 源码搜索仍可用，只是没有元素级行号。

## C. cordis 纯 runtime（DSH 插件生态，零代码）

DSH 插件的 `cordis.patch.yml` 挂上 host/client 两个入口即可，全 UI 获得
Opt+Shift 定位 + 源码搜索路由：

```yaml
- insert:
    - id: code-finder
      name: '@omdsh-dev/dsh-code-finder'        # host 半：/code-finder/api/search 路由
      config: { roots: ['/abs/path/to/plugin/src', '~/.dsh/source/current'] }
    - id: code-finder-client
      name: '@omdsh-dev/dsh-code-finder/cordis/client'   # client 半：dev 自动启用 overlay
```

- host 半（`.../cordis`）：建源码索引（默认 roots `~/.dsh/source/current` +
  当前进程 `cwd/src`）+ 注册 `POST /code-finder/api/search`；自带 loopback
  信任 fence，只读、只扫配置 roots、拒绝越权；
- client 半（`.../cordis/client`）：仅 dev 构建（`process.env.NODE_ENV !==
  'production'`）自动 `setupCodeFinder({ searchEndpoint: '/code-finder/api/search' })`；
  逃生门：`<html data-code-finder="off">` 可完全关闭；
- 想给插件自己的组件加**元素级行号**：再在自己的构建里加 B 档的
  `codeFinderTsdown()`——不加也不影响名字级/搜索级。

## 纯 runtime（不装构建插件）

只 import client 入口即可（等价于 C 档 client 半）：

```ts
import { setupCodeFinder } from '@omdsh-dev/dsh-code-finder/client'

setupCodeFinder({
  hotkeys: 'alt+shift',              // 'alt+shift' | 'alt' | 'cmd+shift' | null（null 关闭）
  searchEndpoint: '/code-finder/api/search',  // 可选：第④层源码搜索
  onClick: (hit) => {
    if (hit.path) openFile(hit.path, hit.line) // 打开/跳转由你实现
    else copyName(hit)
  },
  showNamesOnly: true,               // 无源码信息时是否显示组件名
  debug: false,
})
// 返回 { destroy() }：HMR / 卸载时调用
```

## 宿主 UI 的定位能力（预期行为）

| 场景 | 元素级行号 | 组件名 | 搜索命中位置 |
|---|---|---|---|
| 应用自己构建（构建期注入） | ✓ `data-locatorjs` | ✓ | 不需要 |
| dev React 宿主（vite dev server） | ✓ fiber `_debugSource` | ✓ | 不需要 |
| 生产 React 宿主（`react-dom.production.min.js`） | ✗ 不可达 | ✓ 名字级 | ✓ 搜索级 |

生产宿主无 `_debugSource`、也无权改宿主构建——**「名字级 + 搜索级」是预期行为，
不承诺行号**。搜索命中的位置来自 host 半按 roots 扫出的「组件声明名 → file:line」。

## 兼容性与注意事项

- **LocatorJS 浏览器扩展兼容**：注入的属性沿用 locatorjs 格式
  （`data-locatorjs="<absPath>:<line>:<col>"` + `__LOCATOR_DATA__` 注册表），
  扩展在注入过的页面上同样生效；
- **热键冲突**：`Alt+Shift` 可能与系统/宿主快捷键冲突（macOS 输入法切换），
  可用 `hotkeys: null` 完全关闭，或换成 `cmd+shift`；
- **多实例**：多个接入方（宿主 + 插件）各自注入的 `__LOCATOR_DATA__` 按绝对
  路径隔离，overlay 读取时合并，天然不冲突；
- **IME**：中文输入法组合期间 / 输入框、textarea、contentEditable 内不触发；
- **生产零负担**：构建插件在生产构建是 no-op；运行时只在 dev 代码路径被 import。
