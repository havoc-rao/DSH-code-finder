# dsh-code-finder：React 组件 → 源码定位调试工具（独立项目）设计

> 目标：独立 npm 包 + 独立仓库，方便任何 React 前端（尤其 DSH 插件生态）插入即用；
> 首个接入 case：better-sidebar（be-sider）dev 构建。
> 关联：`@locator/babel-jsx`（构建期注入）、`@react-code-finder/core`（fiber 遍历借鉴）、
> `code-inspector-plugin`（对比过，不采用其运行时/跳转链路）、better-sidebar AGENTS.md §7（平台约束）。

## 1. 动机

better-sidebar 开发时反复需要「页面上这个元素是哪个组件、源码在哪」。现成工具（locatorjs /
code-inspector / react-code-finder）都有一块拼图但都不完整，且各自绑定打包器或运行环境：

| 工具 | 构建期注入 | fiber 兜底（宿主 UI） | 生产宿主下 file:line | 集成成本 |
|---|---|---|---|---|
| locatorjs（data-id） | ✓ 元素级 | ✗（DevTools 变体依赖 dev React） | ✓（属性随 bundle） | 中：transform 插件 |
| react-code-finder | ✗（仅 vite dev server） | ✓（`_debugSource`） | ✗（生产 React 无 `_debugSource`） | 中低，但不满足目标 |
| code-inspector | 需打包器插件 | ✗ | 属性可随构建走 | 高（600KB 客户端 + server 生态缺失） |

**关键事实**（已核实）：DSH web 宿主是 `react-dom.production.min.js` 生产构建（`dev:web` 是
`vite build --watch`，非 dev server），所以宿主 fiber 上**不存在 `_debugSource`**——任何纯 fiber
方案在宿主 UI 上只能拿到组件名、拿不到文件位置；而插件自己的组件（tsdown 构建）可以拿到**元素级
精确行号**。结论：**没有现成工具能同时满足「宿主 + 插件」精确标注**，值得自研一个组合工具。

## 2. 定位

**dsh-code-finder** —— 一个 dev-only 的 React「组件 → 源码」定位器：

- 按住 **Opt+Shift**（`Alt+Shift`）悬停任意 React 组件 → overlay 显示组件名 + `文件:行`（不显示列）；
- **点击** → 打开源码（IDE / 侧边栏编辑器 / 复制路径，可插拔动作）；
- 三层定位：**构建期注入（精确）→ fiber 兜底（全组件）→ 源码搜索（尽力而为）**；
- **插入式交付**：普通 React 项目用 vite/tsdown 插件 + 运行时一行启用；DSH 插件生态用 cordis
  包装，挂载即用、零代码；
- **仅 dev 构建生效**，生产零负担。

命名：仓库 `dsh-code-finder`（havocrao org），npm 包 `@havocrao/dsh-code-finder`。
核心 runtime 与构建插件是通用 React 工具，可独立用于任何 React 项目；cordis 包装与
`/sidebar` 风格路由是 DSH 生态附加面。

## 3. 架构总览

```
┌──────────────────────────── 构建期（dev only）────────────────────────────┐
│ dsh-code-finder/tsdown | vite 插件                                        │
│   transform 钩子 → @locator/babel-jsx（dataAttribute:'path'）              │
│   给「应用自己构建的组件」注入 data-locatorjs 属性 + __LOCATOR_DATA__ 注册表 │
└────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────── 运行时 overlay ───────────────────────────────┐
│ setupCodeFinder({ hotkeys, onClick })                                     │
│  Opt+Shift 悬停 → 解析链：                                                 │
│    ① data-locatorjs 属性 + __LOCATOR_DATA__   （应用自己的组件：精确行号）  │
│    ② fiber._debugSource / _debugInfo         （dev React 宿主：行号）      │
│    ③ fiber 组件名                              （任何 React：至少名字）      │
│    ④ /code-finder/api/search                   （源码搜索：尽力而为）      │
│  点击 → onClick({ path, line, column, name })（默认复制路径；可换 openFile/IDE）│
└────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────── 可选的 Node 侧 ───────────────────────────────┐
│ createSourceIndex({ roots }) → 组件名/文件名 → { file, line } 模糊搜索       │
│ cordis 包装：host 半挂路由 + client 半自动 setupCodeFinder                  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 解析链设计（核心）

hover 一个元素时，按优先级取「源码位置」：

1. **`data-locatorjs` 属性**（`<fullPath>:<line>:<col>` 内联，无需注册表即可解析）→ 应用自己
   构建的组件，元素级精确。属性名沿用 locatorjs 格式，**顺带兼容 LocatorJS 浏览器扩展**；
2. **fiber 遍历**：从 DOM 节点找 `__reactFiber$*` / DevTools hook 的 `findFiberByHostInstance`，
   向上找最近组件 fiber → 读 `_debugSource` / `_debugInfo`（宿主若跑 dev React 自动可用，零改动）；
3. **组件名兜底**：fiber.type.displayName / name，无位置信息时 overlay 显示 `<Name>` 并提示
   「生产构建无源码信息」；
4. **源码搜索**（可选，host 半）：把组件名发到 `/code-finder/api/search`，在配置的源码根目录
   （如 `~/.dsh/source/current`、插件仓库 `src/`）按「名称 = 函数/组件声明」模糊搜索出文件:行。

### 3.2 为什么不直接用 @locator/runtime 或 react-code-finder 客户端

- `@locator/runtime` 依赖 solid-js + tailwindcss + floating-ui，对 CJS closure factory bundle
  太重，且其点击→VSCode 链路依赖扩展；
- `@react-code-finder/core` 客户端（client-bundle.global.js）自带 chakra/monaco 重依赖，且
  **它的位置来源只有 `_debugSource`**（生产宿主没有），无法满足「宿主 UI 精确标注」；
- 我们的 overlay 是**薄层**（解析链 + 边框/标签/toast，无框架依赖，~300 行），解析逻辑可测。

## 4. 仓库/包结构

独立仓库 `DSH-code-finder`，**单包多入口**（降低接入成本，不搞 monorepo）：

```
dsh-code-finder/
├── package.json              # name: @havocrao/dsh-code-finder
├── tsdown.config.ts
├── src/
│   ├── index.ts              # 主入口：Node 侧源码索引 + 搜索（可选）
│   ├── client/
│   │   ├── index.ts          # setupCodeFinder()（runtime 入口）
│   │   ├── overlay.ts        # hover 边框/标签/点击（shadow DOM，无框架依赖）
│   │   ├── resolve.ts        # 解析链 ①②③（data 属性 + fiber + _debugSource）
│   │   ├── fiber.ts          # DOM → fiber 查找 + 组件名提取
│   │   └── locator-data.ts   # __LOCATOR_DATA__ 读取/解析
│   ├── cordis/
│   │   ├── host.ts           # cordis 插件 host 半：/code-finder/api/search 路由
│   │   └── client.ts         # cordis 插件 client 半：自动 setupCodeFinder + 设置开关
│   └── build/
│       ├── transform.ts      # 共享 transform 核心（包 @locator/babel-jsx）
│       ├── tsdown.ts         # tsdown/rolldown transform 插件
│       └── vite.ts           # vite transform 插件（同源薄封装）
├── tests/
│   ├── resolve.spec.ts       # 解析链优先级/回退（jsdom）
│   ├── fiber.spec.ts         # DOM→fiber 提取（fake fiber 注入）
│   ├── transform.spec.ts     # transform 注入产物断言（tsdown/vite 共用核心）
│   └── cordis.spec.ts        # 路由 + 开关
└── docs/README.md            # 接入指南（vite / tsdown / cordis / 纯 runtime）
```

`package.json` exports：

```jsonc
{
  "exports": {
    ".":                { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client":         { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./cordis":         { "types": "./lib/types/cordis/host.d.ts", "default": "./lib/cordis.js" },
    "./cordis/client":  { "types": "./lib/types/cordis/client.d.ts", "default": "./lib/cordis-client.js" },
    "./tsdown":         { "types": "./lib/types/build/tsdown.d.ts", "default": "./lib/tsdown.js" },
    "./vite":           { "types": "./lib/types/build/vite.d.ts", "default": "./lib/vite.js" },
    "./package.json":   "./package.json"
  }
}
```

## 5. 构建期注入（dev only）

tsdown/vite 插件统一封装 `@locator/babel-jsx`：

- **触发条件**：`process.env.NODE_ENV === 'development'`（或显式 `CODE_FINDER=1`）；生产构建
  transform 直接返回原文，零开销；
- **应用范围**：只处理应用自己的源码（`id` 不在 node_modules；DSH 场景即 `src/client/**`）；
- **数据格式**：`dataAttribute: 'path'` → 每个 JSX 元素内联
  `data-locatorjs="/abs/src/client/Sidebar.tsx:42:10"`（无需注册表即可解析，且兼容 LocatorJS
  扩展的 path 格式）；同时保留 `__LOCATOR_DATA__` 注册表注入（兼容扩展的 id 格式）；
- **实现**：rolldown transform 钩子内 `@babel/core.transformAsync(code, { presets:
  [preset-typescript], plugins: [[babelJsx, { dataAttribute: 'path' }]] })`；
  vite 插件同源薄封装。产物必须带 sourcemap 链（babel map → rolldown map）。

> 注入的是**属性 + 注册表**，不是 React 运行时信息，因此**生产宿主环境下依然精确**——这正是
> 本工具相对 react-code-finder 的关键差异点。

## 6. 运行时 overlay

`setupCodeFinder(options)`（幂等、单例、dev 构建才打包进 bundle）：

```ts
interface CodeFinderOptions {
  /** 触发键；默认 'alt+shift' */
  hotkeys?: 'alt+shift' | 'alt' | 'cmd+shift' | null
  /** 点击动作；默认复制 `path:line` 到剪贴板 */
  onClick?: (hit: CodeFinderHit) => void
  /** 源码搜索端点（host 半提供时传入）；默认 undefined = 关闭第④层 */
  searchEndpoint?: string
  /** 是否显示无源码信息的组件名（默认 true） */
  showNamesOnly?: boolean
  /** 调试日志（默认 false） */
  debug?: boolean
}
interface CodeFinderHit {
  name: string            // 组件名
  path?: string           // 相对/绝对路径
  line?: number
  column?: number
  source: 'data' | 'fiber' | 'search' | 'name-only'
}
```

行为：

- **键捕获**：`keydown` 记录按住状态（IME/输入框内不触发，复用 better-sidebar `ime-guard.ts`
  的判定思路），`mousemove` 时若按住且目标不在 overlay 自身 → 走解析链；
- **overlay**：shadow DOM 内固定定位 div（蓝色 2px 边框 + 左上角 `<Sidebar> path:42` 标签 +
  右下角 toast），`pointer-events: none`，z-index 接近最大值但不遮交互；
- **点击**：`click` 且按住热键 → 阻止默认行为 → 调 `onClick(hit)`；
- **生命周期**：`destroy()` 解绑全部监听；HMR 友好（重复调用先 destroy）。

## 7. Node 侧：源码索引与搜索（可选，第④层）

- `createSourceIndex({ roots, exts = ['.tsx','.ts','.jsx','.js'], exclude = ['node_modules'] })`：
  启动时扫目录建「组件声明名 → {file, line}」Map（`function Foo(` / `const Foo = (` /
  `export default function` / class 声明），带 mtime 增量更新；
- 搜索接口：按**精确名优先、包含名次之**返回候选列表（同名多文件 → 全部返回，overlay 里可切换）；
- cordis host 半注册 `POST /code-finder/api/search`，入参 `{ name }`，出参
  `[{ file, line, column? }]`；**安全**：只读、只扫配置 roots、拒绝越权路径（复用 better-sidebar
  `trust-fence.ts` 的鉴权模式——本工具作为独立包自带同款轻量 fence，或声明 peer 依赖）。

## 8. DSH 生态：cordis 插入包装（「方便其他人插入使用」的主面）

```ts
// host 半（Node）
export const name = 'dsh-code-finder'
export const inject = ['webServer', 'webRuntime']  // webRuntime 仅用于 trustedHosts 鉴权
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/code-finder/api',
    handler: fence(req) && handleSearch(createSourceIndex(ctx.config.roots)),
  }))
}

// client 半（浏览器）
export const inject = ['slots', 'settings']
export function apply(ctx) {
  if (process.env.NODE_ENV === 'development') {
    setupCodeFinder({ searchEndpoint: '/code-finder/api/search' })
  }
}
```

- **DSH 插件开发者接入**：`cordis.patch.yml` 挂 `@havocrao/dsh-code-finder` 一行 + 配置
  `roots`（默认 `~/.dsh/source/current` + 当前插件仓库 src），即获得全 UI Opt+Shift 定位；
- 与 better-sidebar 的集成（case）：不反向依赖——code-finder 只发 `onClick` 事件，be-sider
  侧把 `onClick` 接到 `ctx.betterSidebar.openFile(scope, path)`（打开侧边栏编辑器）或复制路径；
- **构建期注入**需要接入方在自己的构建里加一行插件（`plugins: [codeFinderTsdown()]`）——这是
  唯一需要接入方动手的地方，但**不加也不影响**（fiber 名字 + 搜索仍可用）。

## 9. be-sider case：接入与验证清单

better-sidebar（本仓库）作为 case 的具体动作：

1. devDependencies 加 `@havocrao/dsh-code-finder`（workspace/link 开发期）；
2. `tsdown.config.ts`：client bundle 的 `plugins` 数组加 `codeFinderTsdown()`（dev 构建注入
   `src/client/**`）；
3. `src/client/index.tsx`：dev 构建时 `setupCodeFinder({ onClick: (hit) => hit.path
   ? ctx.betterSidebar.openFile({ sessionId }, hit.path) : copy(hit) })`；
4. `src/index.ts`：挂 `/code-finder/api/search`（roots = `[本插件 src, ~/.dsh/source/current]`）；
5. 验证清单：
   - [ ] 按住 Opt+Shift 悬停 sidebar 组件 → 显示 `<Sidebar> src/client/Sidebar.tsx:NN:CC`；
   - [ ] 悬停宿主 UI 组件（chat 区）→ 显示组件名（生产宿主无行号，预期行为）+ 搜索命中时给位置；
   - [ ] 点击 sidebar 组件 → 侧边栏编辑器打开对应源文件；点击宿主组件 → 复制路径；
   - [ ] 生产构建（`pnpm build`）产物无 locator 属性、无 runtime 代码；
   - [ ] LocatorJS 浏览器扩展在 dev 页面上对 sidebar 组件同样生效（格式兼容验证）；
   - [ ] `pnpm typecheck && pnpm test` 全绿，`pnpm test:mount` 冒烟不受影响。

## 10. 里程碑

| M | 内容 | 产出 |
|---|---|---|
| M1 | 独立仓库骨架 + tsdown/vite 注入插件 + resolve ①③ | 包可构建、注入产物断言测试 |
| M2 | fiber 遍历 + overlay UI + 点击动作 + `setupCodeFinder` | 任意 React 页 Opt+Shift 定位（名字级） |
| M3 | Node 源码索引 + cordis host/client 包装 | DSH 插件一行接入 + be-sider case 接入 |
| M4 | 测试补全 + 接入文档 + 发布（v0.1.0） | npm 发布，README 三份接入指南 |

## 11. 风险与开放问题

- **`__LOCATOR_DATA__` 与多实例**：多个接入方（宿主 + 插件）各自注入注册表时 key 按绝对路径
  隔离，天然不冲突；overlay 读取时合并读取即可；
- **fiber 遍历跨 React 版本**：`__reactFiber$*` / hook 属性名在 React 18/19 有差异——用
  `findFiberByHostInstance` 优先、DOM 属性兜底（react-code-finder 同款双路径）；
- **生产宿主 UI 的精确标注本质上不可达**（无 `_debugSource`、无权改 DSH 构建）——文档里明示
  「名字级 + 搜索级」为预期行为，不承诺行号；
- **是否支持 Vue**：v1 只做 React；解析链的 data 属性层天然框架无关，后续可按需加 Vue adapter
  （`@locator` 有现成 vueAdapter 可借鉴）；
- **热键冲突**：`Alt+Shift` 与系统/宿主快捷键的冲突面（如 macOS 输入法切换）需在文档注明，
  并提供 `hotkeys: null` 完全关闭的逃生门。

## 12. 实施偏差记录

（按 better-sidebar 惯例，实施时如有偏离本设计，在此追加。）

### 2026-08-20 M2–M4 实施偏差（dsh-code-finder 独立仓库）

1. **相对导入去掉 `.ts` 后缀**：M1 的 `src/build/tsdown.ts`/`vite.ts` 用
   `./transform.ts` 导入——tsc 需要 `allowImportingTsExtensions`，且会让发布产物
   `lib/types/**/*.d.ts` 带 `.ts` 后缀（对消费方解析不友好）。全部改为 extensionless
   导入；并给 `package.json` 补了 `rolldown`/`vite` devDependencies（M1 的
   `import type { Plugin } from 'rolldown'/'vite'` 类型检查必需，原仓库 typecheck 本就挂）。

2. **解析链 ① 同时支持 `data-locatorjs-id`（注册表 id 格式）**：plan 只写了 path
   格式；id 格式是 @locator 默认格式且本包 transform 支持 `dataAttribute: 'id'`，
   所以 resolve 对两种属性都解析（id 通过 `__LOCATOR_DATA__` 反查）。

3. **`createSourceIndex` 新增 `lazy` 选项**：plan §7 写「启动时扫目录建 Map」；但
   cordis host / be-sider 的 roots 含 `~/.dsh/source/current`（可能数千文件），同步
   全扫会阻塞插件启动。新增 `lazy?: boolean`（首次 `search()`/`refresh()` 才建表），
   cordis host 与 be-sider 接入默认 `lazy: true`；默认行为仍是非 lazy（plan 语义保留）。

4. **排除规则改为路径段匹配**：字符串排除按「路径段精确匹配」而不是子串
   （`'out'` 会误伤 `layout.css`、`about/` 等合法路径），正则规则对完整路径测试。

5. **搜索返回「精确 + 包含」合并**：plan §7「精确名优先、包含名次之」实现为精确
   候选在前、包含候选在后合并返回（不是精确存在时只返回精确）。

6. **cordis host/client 不导出 Config schema**：避免引入 schemastery 重依赖；配置
   通过 `ctx.config` / `apply` 第二参读取，`resolveHostConfig` 补齐默认值（与
   be-sider `resolveSidebarConfig` 的「直接调用也默认」模式一致）。

7. **client 半 dev 判定用 `!== 'production'`（try/catch 包裹）**：比 plan 示例的
   `=== 'development'` 更宽容——未定义 NODE_ENV 的打包器默认启用（dev 场景），生产
   define 掉则禁用；另加 `data-code-finder="off"` 逃生门（plan §11 热键逃生门落地）。

8. **`setupCodeFinder` 内置生产防护**：`isProductionRuntime()` 双通道检查
   （`process.env.NODE_ENV` + `import.meta.env.MODE`），命中时返回空操作句柄——
   plan 未要求，作为「调用方忘记按环境懒加载」的双保险（生产零 runtime）。

9. **be-sider 接入用「NODE_ENV 守卫 + 动态 import」**：plan §9.3 只说 dev 时
   `setupCodeFinder`；为满足「生产零负担」硬约束，用 `if (process.env.NODE_ENV !==
   'development') return` + `import('@havocrao/dsh-code-finder/client')`，配合
   be-sider 的 NODE_ENV define 常量折叠，生产构建整块 dead-code 消除（已验证：
   生产 bundle 0 个 `data-locatorjs` / 0 个 `setupCodeFinder`）。

10. **be-sider 依赖用 workspace 链接**：`pnpm-workspace.yaml` 加
    `- ../../DSH-code-finder` + `"@havocrao/dsh-code-finder": "workspace:*"`
    （dev 期；发布时换 registry 版本）。lockfile 因新增 workspace 成员而重排
    （只增/重定位，无既有版本回退）。

11. **overlay z-index = 2147482999**：取 be-sider 错误条（2147483000）之下 1，
    接近最大值但不遮交互。

12. **测试补一个 `tests/index.spec.ts`**：plan 清单是 4 个 spec，额外加 index.spec
    覆盖 `createSourceIndex`（声明提取 / 排序 / mtime 增量 / lazy），cordis.spec
    覆盖 fence / 搜索 / 参数校验 / client 开关。

13. **npm 发布（v0.1.0）未执行**：plan M4 的发布一步留待后续（需要 npm 账号 /
    registry 配置）；本任务验收范围是 typecheck/test/build 全绿 + 三份接入文档。

### 2026-08-20 真实试用（be-sider case）发现的两处修复

14. **`createSourceIndex` 排除规则改为「相对扫描根」判定**（原为绝对路径子串/段
    匹配）：以包形式安装的插件，其自身 `src/` 在 `node_modules/<pkg>/src` 下——按
    绝对路径段匹配会把插件自己的源码排除掉，真实挂载后 `/code-finder/api/search`
    对插件组件永远返回空。改为相对每个 root 的路径做排除判定（`node_modules`
    等规则对 root 内部的目录仍生效），并补了对应测试。

15. **be-sider `src/index.ts` 的 `REPOSITORY_ROOT` 必须用 `new URL('..')` 而不是
    `'.'`**：源码文件里 `.` 指向仓库根是对的，但该常量被打包进 `lib/index.js`
    后，运行时 `import.meta.url` 指向 `lib/`，`.` 会解析成 `<pkg>/lib/`，导致
    roots[0] = `<pkg>/lib/src` 不存在、源码搜索永远为空（真实 `dsh web` 挂载
    curl 验证踩到）。`tsdown.config.ts` 里的同名常量是构建期用途（配置在仓库根），
    不受影响；`src/index.ts` 处已改为 `'..'` 并加注释防回归。

### 2026-08-20 打开动作定为「本地 IDE CLI，用户可配置」（plan §8 的 onClick 落地）

16. **be-sider 点击动作 = 本地 IDE CLI 打开（默认 `buddycn`，用户可配置）**：plan
    §8 说 be-sider 把 onClick 接到 `openFile`/复制；用户决定改为「类似 `code
    xxx` 的本地打开」——host 半新增 `open.local` API（`/sidebar/api/open.local`，
    fenced + path 限定在搜索 roots 内拒绝越权），spawn 配置的 CLI
    `-g <file>:<line>[:<col>]`；CLI 由 be-sider `SidebarConfig.openCommand`
    决定（默认 `buddycn`，可配 `code`/自定义/绝对路径，空字符串 = 关闭本地打开）。
    client 点击时优先调 `open.local`，失败/关闭回退 `ctx.betterSidebar.openFile`
    （侧边栏编辑器），无路径复制组件名。code-finder 包本身不动——onClick 是接入方
    自由实现，符合「动作可插拔」设计。

### 2026-08-20 需求 §5.1 落地：注册表反查真实组件名（`af` → `Sidebar`）

17. **`lookupComponentNameByPosition` 按 (path, line, column) 反查包裹组件名**：
    需求 §5.1 的 `<af>` → `<Sidebar>`。data-locatorjs 是 path 格式（无表达式
    id），按位置匹配注册表里最近的表达式，再沿 `wrappingComponentId` →
    `components` 链上溯到**最外层包裹组件**返回其名（hover 内部元素也显示
    `<Sidebar>` 而非 `<button>`）；无包裹组件/链断裂/成环回退表达式名（元素级）。
    同时把 `LocatorExpression`/`LocatorComponent` 位置读取修正为 @locator/babel-jsx
    真实注入形状（位置在 `loc.start`，兼容旧顶层 `start`），`components` 条目补全
    `name`/`wrappingComponentId` 类型。resolve.ts ① 分支命中 data 属性时用注册表
    名覆盖 minified fiber 名。**已验证（2026-08-20）：`pnpm test` 66 个全绿
    （resolve.spec 新增 4 个用例：位置反查覆盖 minified 名 / 多级链上溯 / 无条目
    回退 fiber 名 / 兼容旧形状）+ `pnpm build` + `pnpm typecheck` 全过。**
    真实浏览器复测（Opt+Shift 悬停显示 `<Sidebar> Sidebar.tsx:NN:CC`）按
    docs/README.md「be-sider case 端到端试用」流程执行。

### 2026-08-20 需求 §5.2 / §5.3 决策落地

18. **搜索统一由 dsh-code-finder host 半提供（需求 §5.3）**：be-sider
    `src/index.ts` 移除自身 `/code-finder/api` 搜索路由注册（`createSourceIndex` /
    `handleSearchRequest` 导入、`codeFinderIndex` 建表与 `webServer.register` 块），
    `CODE_FINDER_ROOTS` 保留（open.local 越权校验仍用，注释更新）；be-sider client
    的 `searchEndpoint: '/code-finder/api/search'` 指向不变——端点现由 dsh-code-finder
    host 半提供（挂载方式见 docs/README.md「be-sider case 端到端试用」）。消除
    「be-sider 与 dsh-code-finder 同时挂载 → 重复注册同前缀」冲突。验证：be-sider
    typecheck + 单测（见下）。

19. **宿主 UI 精确行号维持「名字级 + 搜索级」（需求 §5.2，用户决策）**：不改 DSH
    官方源码构建（AGENTS.md 硬约束 + 本机 `~/.dsh/source/current` checkout 不存在）；
    预期行为不变，文档已明示。

### 2026-08-20 需求 §6 验收：真实浏览器复测（全部通过）

20. **真实浏览器复测落地（需求 §6 五项验收全绿）**：用 Playwright（be-sider 仓库的
    `scripts/cf-recheck.mjs`，复用其 chromium 依赖）连真实 `dsh web`
    （`http://127.0.0.1:3080`，keyless + link 挂载），12/12 断言通过：
    - `__LOCATOR_DATA__` 67 条（含 Sidebar.tsx 表达式）、sidebar 内 166 个
      `data-locatorjs` 属性（此前实测为 223，随面板展开度/版本变化，属正常）；
    - 按住 Alt+Shift 悬停 sidebar 组件 → **`<Sidebar> Sidebar.tsx:1099:6`**：
      真实组件名（非 minified）✅ + 元素级精确行列 ✅（需求 §6 第一条）；
    - 多元素悬停 8 个样本均出标签（`<Sidebar> … | <svg> icons.tsx:80:2 | …`）；
    - 按住热键点击 → 拦截 `/sidebar/api/open.local`，载荷
      `{"path":"…/src/client/Sidebar.tsx","line":1099,"column":6}` ✅（§6 第三条）；
    - 宿主 UI 悬停 → 名字级提示（生产宿主预期行为，§6 第二条）；
    - 生产 `grep -c data-locatorjs|setupCodeFinder lib/client.js` = 0（§6 第四条）；
    - be-sider 788 + dsh-code-finder 66 单测全绿（§6 第五条）。
    前置要求：`NODE_ENV=development pnpm bundle`（dev 注入）+ `dsh web` 起着 +
    profile link 挂载 be-sider（`dsh web` 直接服务 `lib/client.js`，无需重启）。
    复测脚本保留在 be-sider `scripts/cf-recheck.mjs` 作为 case 回归工具。

