# dsh-code-finder 接入指南

Dev-only React「组件 → 源码」定位工具：按住 **Opt+Shift**（`Alt+Shift`）悬停任意
React 组件 → overlay 显示组件名 + `文件:行`；**点击**打开源码（动作可插拔）。
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
`文件:行`**（构建期注入的属性在 DOM 上，生产宿主也生效）；点按即复制
`path:line`。

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

## be-sider（better-sidebar）case：端到端试用

以 better-sidebar 为 case 的完整试用流程（开发机已装 DSH CLI：`dsh --version` 可用）：

### 一次性准备

```bash
# 1) 构建 code-finder 本体（be-sider 通过 workspace 链接引用 lib/）
cd ~/Documents/Projects/tools/DSH-code-finder
pnpm build

# 2) be-sider dev 构建——注入只在 NODE_ENV=development（或 CODE_FINDER=1）时发生
cd ~/Documents/Projects/tools/dsh-plugins/DSH-better-sidebar
NODE_ENV=development pnpm bundle
grep -c data-locatorjs lib/client.js     # 期望 > 0（元素级注入生效）
grep -c setupCodeFinder lib/client.js    # 期望 > 0（运行时已进 bundle）

# 3) 打包 dev 产物（NODE_ENV=development 防止 pack 前 prepublishOnly 覆盖回生产版）
NODE_ENV=development pnpm pack            # 产出 dsh-better-sidebar-0.14.0.tgz
tar -xOf dsh-better-sidebar-0.14.0.tgz package/lib/client.js | grep -c data-locatorjs  # > 0
```

### 挂载并启动（真实 DSH 宿主）

```bash
dsh plugin --profile web add file:dsh-better-sidebar-0.14.0.tgz
# 第④层源码搜索需要 dsh-code-finder host 半（be-sider 已不自带 /code-finder/api
# 路由，见需求 2026-08-20 待办 #3）；把 host 半装进 profile 并在 cordis.patch.yml
# 挂一行（或直接用下方 C-档两行配置，client 半可与 be-sider 的 overlay 并存——
# setupCodeFinder 是幂等单例，后挂者先 destroy 前者）：
dsh plugin --profile web add file:dsh-code-finder-0.1.0.tgz
dsh web    # keyless；浏览器打开日志里的 http://127.0.0.1:<port>
```

> 不想污染真实 `web` profile：用 scratch home（e2e-mount.sh 同款）——
> 先按 e2e-mount.sh 步骤 1 引导 `$DSH_HOME/profiles/web`（写含
> `allowBuilds: { node-pty: true }` 的 pnpm-workspace.yaml），再
> `DSH_HOME=... dsh plugin --profile web add file:...tgz && DSH_HOME=... dsh web`。

### 验证清单（plan §9.5）

| 操作 | 期望 |
|---|---|
| 按住 Opt+Shift 悬停 sidebar 组件 | 蓝色边框 + `<Sidebar> Sidebar.tsx:NN:CC`（元素级精确，真实组件名） |
| 按住 Opt+Shift 悬停宿主 UI（chat 区） | 组件名（生产宿主无行号）+ 搜索命中时 `文件名:行`（第④层，需 dsh-code-finder host 半在跑） |
| 点击 sidebar 组件 | 本地 IDE 打开（默认 `buddycn -g file:line:col`，可配 `code` 等） |
| 点击宿主组件（搜索也没命中） | 复制组件名到剪贴板 |
| 本地 IDE 未装 / 关闭本地打开 | 自动回退侧边栏编辑器打开 |
| 松开热键 / Esc | overlay 隐藏 |
| LocatorJS 浏览器扩展（可选） | dev 页面上对 sidebar 组件同样生效（格式兼容） |
| `pnpm build`（生产） | 产物无 `data-locatorjs`、无 runtime（零注入零负担） |

> **已完成（2026-08-20，真实浏览器复测 12/12 全过）**：Playwright 连真实
> `dsh web` 断言 `<Sidebar> Sidebar.tsx:NN:CC`（真实组件名 + 精确行列）、
> 点击载荷送达 `open.local`、宿主 UI 名字级提示。复测脚本保留在 be-sider
> `scripts/cf-recheck.mjs`，回归时
> `DSH_E2E_URL=http://127.0.0.1:3080 node scripts/cf-recheck.mjs` 一条命令复跑
> （前置：dev bundle + `dsh web` 起着 + profile link 挂载）。

### 打开方式（用户可配置）

点击「打开源码」的本地 IDE CLI 由 be-sider host 配置 `openCommand` 决定（默认
`buddycn`；空字符串 = 关闭本地打开、点击回退侧边栏编辑器）。在
`cordis.patch.yml` / profile 插件配置里设置，例如：

```yaml
- insert:
    - id: better-sidebar
      name: 'dsh-better-sidebar'
      config:
        openCommand: code        # VS Code；或 /abs/path/to/any/ide-cli
```

命令须支持 `-g <file:line[:col]>` 参数（`buddycn` / `code` 均支持）。

### 日常开发循环

改 code-finder 源码 → `pnpm build` → be-sider
`NODE_ENV=development pnpm bundle`（或后台 `NODE_ENV=development pnpm watch`）
→ 重打 tarball + `dsh plugin --profile web add file:...tgz`（或先 `remove` 再 `add`）
→ 刷新页面。

调试：`setupCodeFinder({ debug: true })` 开 console 日志；逃生门
`<html data-code-finder="off">` 完全关闭；试完清理
`dsh plugin --profile web remove dsh-better-sidebar`。

### 常见坑

- `pnpm build`（不带 NODE_ENV）会把 `lib/client*.js` 覆盖回**无注入**版本——试完
  生产构建要继续试用需重跑 dev 构建；
- 搜索层依赖 **dsh-code-finder host 半**路由在跑（be-sider 不自带 `/code-finder/api`；
  `dsh web` 起着 + profile 挂了 host 半）；首次搜索触发懒建索引——
  `~/.dsh/source/current` 不存在时宿主组件搜不到（插件自己的 src 始终可搜）；
- Opt+Shift 与 macOS 输入法切换冲突时：`hotkeys: 'cmd+shift'` 或 `null`。

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
