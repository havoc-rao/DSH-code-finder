# dsh-code-finder 接入指南

Dev-only React「组件 → 源码」定位工具：按住 **Opt+Shift**（`Alt+Shift`）悬停任意
React 组件 → overlay 显示组件名 + `文件:行`；**点击**打开源码（动作可插拔）。
仅 dev 构建生效，生产零负担、零注入；运行时零框架依赖（不 import react）。



接入方式按集成深度分三档：

| 方式 | 构建期注入（元素级精确行号） | fiber 名字级 | 源码搜索/反查（宿主 UI 兜底） | 改动量 |
|---|---|---|---|---|
| A. vite 项目 | ✓ | ✓ | 可选 | 插件一行 + 入口一行 |
| B. tsdown 项目（DSH 插件 client bundle） | ✓ | ✓ | 可选 | 插件一行 + 入口一行 |
| C. cordis 纯 runtime（DSH 插件生态） | 不加则无 | ✓ | ✓（host 半自动挂路由） | `cordis.patch.yml` 两行 |

> 五层定位（plan §3.1）：**①构建期注入的 `data-locatorjs` 属性（精确）→
> ②fiber `_debugSource`（dev React 宿主）→ ③组件名兜底 → ④源码搜索（尽力而为）
> → ⑤sourcemap 反查（产物坐标 → 源码坐标）**。
> 生产 React 没有 `_debugSource`，宿主 UI 的精确行号在**不修改宿主构建**的前提下
> 不可达——名字级 + 搜索级是预期行为；但**构建期注入在产物上同样生效**，两段式
> 构建（tsc → lib → tsdown 打包）的插件借 ⑤ 把 `lib/**/*.js` 坐标反查回
> `src/**/*.tsx`（见下文「宿主 UI 的定位能力」与 `src/sourcemap.ts`）。

---

## 0. npx CLI 一键接入 / 诊断 / 回滚

发布后无需手动编辑任何文件，`npx` 直接接线、诊断、回滚：

```bash
npx @havocrao/dsh-code-finder init      # 自动装依赖 + 接线（vite/tsdown/cordis 自动检测）
npx @havocrao/dsh-code-finder status    # 诊断：接线状态 + 依赖 + 产物 data-locatorjs 注入抽查
dcf status --cwd <dir> --profile web    # 端到端验证：+ profile patch / 宿主 client URL / search API
dcf ensure <dir> --profile web          # 一站式：接线 + profile roots + dev 构建 + 宿主验证（见下节）
npx @havocrao/dsh-code-finder remove    # 完整卸载：精确移除注入 + 移除依赖
# DSH profile 的配置 roots 覆盖（C 档源码搜索目录）：
dcf roots list web                      # 列出 web profile 当前覆盖（无覆盖显示默认语义）
dcf roots add web /abs/path/to/UI/src   # 幂等追加（~ 展开、相对路径按 --cwd 归一化、去重）
dcf roots remove web /abs/path/to/UI/src
# roots 补丁按「挂载行 id」定位（默认官方行 dsh-code-finder）；宿主侧自定义
# 挂载行 id 时（如 deepseek-harness 的 dsh-code-finder-mount，官方行会被其
# double-mount 守卫禁用）必须指向实际生效行：
dcf roots add web /abs/path/to/UI/src --entry-id dsh-code-finder-mount
# 可选: --cwd <dir>  --no-install  --keep-deps  --link <path>  --no-build  --script <name>
#       --root <path>  --host <url>  --no-host-check  --quiet
```

- **零备份**：不写任何 `.code-finder.bak` 文件（无残留副作用）；`remove` 走
  精确逆向删除，只移除 CLI 自己加的 import 行 / plugins 条目 / cordis 行，
  接线后你的手动修改原样保留——不存在"过期备份还原冲掉修改"的风险；
- **幂等**：重复 `init` 无副作用；接线检测/删除都按完整调用表达式（不会被
  import 行字样误判）；
- **覆盖三种接线**：`vite.config.*`（plugins 数组插 `codeFinderVite()`）、
  `tsdown.config.*`（每个 plugins 数组插 `codeFinderTsdown()`）、
  `cordis.patch.yml`（一行双面插件，缩进随块对齐）；
- **roots 覆盖是「完全替换」**：profile 里一旦写了 `config.roots`，host 半
  默认 roots（`~/.dsh/source/current` + 宿主进程 `cwd/src`，外加 **monorepo
  布局补位**：`cwd/packages`、`cwd/apps` 存在时自动加入——deepseek-harness
  型 `packages/client/<name>/src/client/...` 无需配置即可被搜索命中）不再并入
  （见 `src/cordis/host.ts` 的 `config?.roots ?? defaultRoots()`）。所以
  `dcf roots add` 在**创建新覆盖块时自动播种这两条默认根**（写全语义），
  已有列表只幂等追加；清空后 `dcf roots remove` 会删除整块、恢复默认；
- **roots 补丁的 id 必须指向实际生效的挂载行**：profile patch 层按
  `- id: <行 id>` 定位（`applyEntryPatches`，找不到 id 会告警跳过；对**被
  double-mount 守卫禁用**的行打补丁同样静默无效——config 改了，行不挂载）。
  官方 bundle 行 id 是 `dsh-code-finder`；聚合层/宿主若用自定义 id 挂载
  （如 harness 的 `dsh-code-finder-mount`），用 `--entry-id` 指过去：
  `dcf roots add web <src> --entry-id dsh-code-finder-mount`。`dcf status
  --profile web` 会在仓库里检测到自定义挂载行时自动给出提示；
- 接线后仍需 **dev 语义构建**（见「构建期注入生效机制」）才产生注入；
- `remove` 连带卸载依赖（`--keep-deps` 保留）；手动 `pnpm remove @havocrao/dsh-code-finder`。

### 一站式：从零到「code-ref path 可见」（dcf ensure）

DSH 插件场景（B 档构建注入 + C 档搜索兜底组合）的整条链路——「构建产物带
`data-locatorjs` 注入 → profile roots 覆盖 → 宿主挂载 → 源码搜索返回
`file:line`」——由一条命令驱动，无需手工拼步骤：

```bash
dcf ensure /path/to/plugin --profile web
```

| 环节 | 命令 | 说明 |
|---|---|---|
| 接线（装依赖 + vite/tsdown/cordis 注入） | `dcf ensure <dir>` [1/4]（或 `dcf init --cwd <dir>`） | 幂等；已接入则零改动；`--no-install` 跳过装依赖 |
| profile roots 覆盖 | `dcf ensure <dir>` [2/4]（或 `dcf roots add <profile> <src>`） | 播种两条默认根 + `<dir>/src`（`--root <path>` 可重复追加）；已有条目跳过 |
| dev 构建 | `dcf ensure <dir>` [3/4] | 自动识别 `build:dev` / `build-dev` / `dev:build` 等脚本，以 `NODE_ENV=development` 运行；`--script <name>` 指定、`--no-build` 跳过 |
| 宿主重启（破坏性，不代执行） | 输出指令 | 旧 boot 不加载新产物 / 新 roots；`dsh web stop && dsh web`（或 `dsh web --dev` 前台） |
| 端到端验证 | `dcf ensure <dir>` [4/4]（或 `dcf status --cwd <dir> --profile <name>`） | 产物 data-locatorjs 计数、profile patch 覆盖、宿主 client bundle URL、search API 命中 |

「从零到 path 可见」完整命令序列（web profile、宿主 127.0.0.1:3080）：

```bash
# 0) 前提：宿主起着（dsh web），插件包已进 profile 的 bundle 栈
#    （dsh plugin --profile web add <路径或 tgz>，或 link 依赖）。
#    下面一条命令完成：接线 → roots → dev 构建 → 验证：
dcf ensure /path/to/plugin --profile web
# ⚠ 若出现「当前 boot 未挂该插件 / 索引未命中」——旧进程不读新补丁/新产物，
#    重启宿主（dcf 只提示、绝不代你杀进程）：
dsh web stop && dsh web
# 1) 重启后一条命令复检（期望：client bundle 200 + search API 命中组件 → file:line）：
dcf status --cwd /path/to/plugin --profile web
```

`dcf status --profile` 的宿主检查（只读探测，`--host <url>` 指定宿主、默认
`http://127.0.0.1:3080`、`--no-host-check` 离线跳过）：

- `GET /plugins/<包名>/client.js` → 200 = 当前 boot 已挂插件 client（旧 boot 404）；
- `POST /code-finder/api/search` `{name: <组件名>}` → `data[]` 非空即「组件名 →
  file:line」索引命中，是 path 可见的直接证据；探测组件名由 CLI 从 `<dir>/src`
  自动提取，且只选**源码索引同构的声明形态**（PascalCase 的 function / 箭头
  函数 / class——纯字符串常量如 `GUIDE_STROKE` 不会被索引，也不作探测目标）；
- `POST /code-finder/api/sourcemap` `{path, line, column}`（产物坐标）→
  `data` 为源码坐标对象或 `null`——host 半读取产物旁 `*.js.map` 反查（第⑤层，
  见 src/sourcemap.ts），两段式构建（tsc → lib → tsdown）的插件 hover 也能落回
  `src/**/*.tsx`。

> ensure 全程幂等：接线与 roots 只做最小文本手术，已就绪时零写入；构建环节
> 以 `NODE_ENV=development` 调用项目自己的 dev 脚本（如 `build:dev`），产物
> 逐字节一致性取决于构建工具本身（如 lightningcss 的 CSS class-map 键序随
> 进程随机），dcf 侧文件两次执行字节级一致。

## A. vite 项目

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { codeFinderVite } from '@havocrao/dsh-code-finder/vite'

export default defineConfig({
  plugins: [react(), codeFinderVite()], // 只加这一行；dev-only，生产构建是 no-op
})
```

```ts
// 应用入口（仅 dev 生效，生产 tree-shake 掉）
if (import.meta.env.DEV) {
  const { setupCodeFinder } = await import('@havocrao/dsh-code-finder/runtime')
  setupCodeFinder({})
}
```

现在按住 Opt+Shift 悬停任意 React 组件：应用自己构建的组件显示**元素级
`文件:行`**（构建期注入的属性在 DOM 上，生产宿主也生效）；点按即复制
`path:line`。

## B. tsdown 项目（DSH 插件 client bundle 同款构建）

```ts
// tsdown.config.ts —— client bundle 的 plugins 数组里加：
import { codeFinderTsdown } from '@havocrao/dsh-code-finder/tsdown'
// ...
plugins: [codeFinderTsdown()],   // dev-only 注入 src/client/**（node_modules 自动跳过）
```

```ts
// 插件 client 入口（src/client/index.tsx，仅 dev 语义生效：
// NODE_ENV=development；未设 NODE_ENV 一律不挂载）
if (process.env.NODE_ENV === 'development') {
  const { setupCodeFinder } = await import('@havocrao/dsh-code-finder/runtime')
  setupCodeFinder({ onClick: (hit) => { /* 打开/复制 hit.path */ } })
}
```

> **不加构建插件也能用**：fiber 名字级 + 源码搜索仍可用，只是没有元素级行号。

## C. cordis 纯 runtime（DSH 插件生态，零代码）

DSH 插件的 `cordis.patch.yml` **挂一行**即可——同一 entry 双面：node 面
（包主入口 re-export 的 host 插件）注册源码搜索路由，浏览器面（包的
`dsh.client` 声明 → 宿主扫描 serve `/plugins/.../client.js` wire bundle）自动
启用 overlay，全 UI 获得 Opt+Shift 定位 + 源码搜索：

```yaml
- insert:
    - id: code-finder
      name: '@havocrao/dsh-code-finder'        # 一行双面：host 半 + client 半
      config: { roots: ['/abs/path/to/plugin/src'] }
```

> 配置 roots 注意：根目录**不展开 `~`**（`~/.dsh/source/current` 会被静默
> 跳过），要写 home 展开后的绝对路径；`config.roots` 是**完全替换**默认
> roots，需要默认根就显式列出。若 dcf 已随官方 bundle 挂载（`dsh plugin
> add` 一行装好，见仓库根 cordis.patch.yml），想要**只改 roots 不动挂载行**，
> 用 profile patch 层的 id 定位补丁（或用 `dcf roots add|remove|list <profile>`）：
>
> ```yaml
> - id: dsh-code-finder
>   config:
>     roots:
>       - /Users/<you>/.dsh/source/current
>       - !!js "process.cwd() + '/src'"
>       - /abs/path/to/plugin/src
> ```
>
> （`- overrides:` 包裹写法是无效方言：当前 Loader 不识别，boot 告警并跳过。）

> 注：`.../cordis` 与 `.../cordis/client` 作为**独立入口**保留（包主入口已
> re-export host 半；`.../client` 是 harness-wire bundle），一般用不着显式引用。

- host 半：建源码索引（默认 roots `~/.dsh/source/current` + 当前进程
  `cwd/src` + monorepo 布局补位 `cwd/packages`/`cwd/apps`）+ 注册
  `POST /code-finder/api/search` 与 `POST /code-finder/api/sourcemap`
  （产物坐标 → 源码坐标的反查，见 src/sourcemap.ts）；自带 loopback 信任 fence，
  只读、只扫配置 roots、拒绝越权；
- client 半：wire bundle 里按「无 process 即 dev」默认启用
  `setupCodeFinder({ searchEndpoint: '/code-finder/api/search', sourcemapEndpoint: '/code-finder/api/sourcemap' })`；
  逃生门：`<html data-code-finder="off">` 可完全关闭；`<html
  data-code-finder-hotkeys="cmd+shift|alt|alt+shift|off">` 可换热键/关热键
  （macOS 输入法切换占用 ⌥⇧ 等场景）；
- 想给插件自己的组件加**元素级行号**：再在自己的构建里加 B 档的
  `codeFinderTsdown()`（需 `NODE_ENV=development`，见「构建期注入生效机制」）
  ——不加也不影响名字级/搜索级；
- **零构建插件**（手写 classic script、无 bundler、无 JSX，如 `dsh-remote` 的
  `lib/client.js`）：B 档不可达，改用独立注入入口 `dcf instrument lib --write`
  （或 `@havocrao/dsh-code-finder/instrument` 的 `instrumentDir()`）——对
  `React.createElement` / jsx-runtime 调用等价注入，语义与构建期完全一致。

## 纯 runtime（不装构建插件）

只 import runtime 入口即可（等价于 C 档 client 半；无 cordis 宿主时直接集成
用 `.../runtime`，`.../client` 是 cordis 宿主的 wire bundle，不是给人 import
的）：

```ts
import { setupCodeFinder } from '@havocrao/dsh-code-finder/runtime'

setupCodeFinder({
  hotkeys: 'alt+shift',              // 'alt+shift' | 'alt' | 'cmd+shift' | null（null 关闭）
  searchEndpoint: '/code-finder/api/search',      // 可选：第④层源码搜索
  sourcemapEndpoint: '/code-finder/api/sourcemap', // 可选：第⑤层产物坐标→源码坐标反查
  onClick: (hit) => {
    if (hit.path) openFile(hit.path, hit.line) // 打开/跳转由你实现
    else copyName(hit)
  },
  showNamesOnly: true,               // 无源码信息时是否显示组件名
  debug: false,
})
// 返回 { destroy() }：HMR / 卸载时调用
```

## 构建期注入生效机制（NODE_ENV=development）

**注入发生在「编译 UI 源码的那个进程」**，不是运行期：`codeFinderTsdown()` /
`codeFinderVite()` 在 bundler 的 `transform` 阶段把 `data-locatorjs="<abs>:<line>:<col>"`
静态属性打进出产物（JSX 还是源码形态时），之后服务器 / 浏览器完全不需要
任何环境变量，属性早已烘焙在 bundle 里。

开关（`src/build/transform.ts` 的 `codeFinderEnabled`）：

```ts
return process.env.NODE_ENV === 'development'   // enabled 参数是唯一覆盖层
```

| 构建场景 | 进程的 NODE_ENV | data-locatorjs |
|---|---|---|
| 应用/插件自己的 `pnpm build`（默认） | 生产语义 | ✗ 0 处（发布正确行为） |
| dev 构建（显式 `NODE_ENV=development`） | development | ✓ 元素级注入 |
| harness `dev:web` / tsdown watch | 未设则默认 development | ✓（watch 循环内置） |
| 应用发布/CI | production | ✗ 零注入零负担（设计意图） |
| **运行期**（`dsh web` 服务器、浏览器） | 无关 | 属性已烘焙，读 DOM 即可 |

要点：

- **开发流程只跑 dev 语义构建**（如 better-sidebar 的 `pnpm build:dev`，即
  `NODE_ENV=development tsdown`）；`pnpm build` 是发布用，会把 `lib/*.js`
  覆盖回**无注入**版本——dev 中途手滑跑过一次，hover 就退回"只有组件名"，
  重跑 dev 构建即可恢复。
- **`prepare` / `postinstall` 陷阱**：若包有 `prepare: tsdown` 或类似脚本，
  每次 `pnpm install` 都会用生产语义重新构建并覆盖 dev 产物——install 后
  hover 变无信息，先自查 `grep -c data-locatorjs lib/client.js`（>0 为注入
  在），被覆盖就重跑 dev 构建。
- **覆盖层（enabled 参数）**：生产语义构建想带注入时在构建配置显式传
  `codeFinderTsdown({ enabled: true })`（不推荐发布用）；dev 语义下想保持
  干净则传 `enabled: false`。env 层只有 `NODE_ENV` 一个语义。
- **注入 ≠ 定位唯一途径**：无 `data-locatorjs` 时还有 fiber `_debugSource`
  （dev React）→ 组件名 → 第④层 roots 名字搜索兜底；`data-locatorjs` 只是
  让行号最精确。（见下节「宿主 UI 的定位能力」）

## 宿主 UI 的定位能力（预期行为）

| 场景 | 元素级行号 | 组件名 | 搜索命中位置 |
|---|---|---|---|
| 应用自己构建（构建期注入，产物即源码） | ✓ `data-locatorjs`（hover 内部子元素时上溯最近注入祖先，蓝框框住注入边界） | ✓ | 不需要 |
| 应用自己构建（两段式：tsc → lib → tsdown 打包） | ✓ `data-locatorjs` → ⑤ sourcemap 反查回 `src/**/*.tsx` | ✓ | 不需要 |
| dev React 宿主（vite dev server） | ✓ fiber `_debugSource` | ✓ | 不需要 |
| 生产 React 宿主（`react-dom.production.min.js`） | ✗ 不可达（除非装 React DevTools 扩展拿到 fiber hook） | ✓ 名字级（需 fiber；扩展/注入属性可补） | ✓ 搜索级 |

生产宿主无 `_debugSource`、也无权改宿主构建——**「名字级 + 搜索级」是预期行为，
不承诺行号**。搜索命中的位置来自 host 半按 roots 扫出的「组件声明名 → file:line」。

两段式构建的行号来源是 ⑤：`data-locatorjs` 注入在 tsdown 打包的 `lib/**/*.js`
上（坐标即产物坐标），client 半发现命中路径是产物后 POST
`/code-finder/api/sourcemap`，host 半读取产物旁 `*.js.map`（tsc 需在插件
tsconfig 开 `sourceMap`、tsdown 需 `sourcemap: true`；sources 相对 map 目录，
打包器改写过的浏览器 URL 形式按配置 roots 兜底拼接）
反查原始坐标——hover 显示 `MessageItem.tsx:219:35` 而非
`lib/types/client/chat/MessageItem.js:96:297`。无 map（未开 sourceMap 或被发布
files 过滤）时静默回退产物路径，不阻断 hover。

## be-sider（better-sidebar）case：端到端试用

以 better-sidebar 为 case 的完整试用流程（开发机已装 DSH CLI：`dsh --version` 可用）：

### 一次性准备

```bash
# 1) 构建 code-finder 本体（be-sider 通过 workspace 链接引用 lib/）
cd ~/Documents/Projects/tools/DSH-code-finder
pnpm build

# 2) be-sider dev 构建——注入只在 NODE_ENV=development 时发生
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
| 按住 Opt+Shift 悬停**两段式构建的插件**（tsc→lib 再打包） | 见 `src/**/*.tsx` 坐标：`data-locatorjs` 指向 `lib/**/*.js` 时第⑤层用配套 `.js.map` 反查回源码（需 host 半在跑 + 产物旁保留 map） |
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

调试：`setupCodeFinder({ debug: true })` 开 console 日志（第⑤层反查会打印
`sourcemap <产物路径> → <源码坐标>`）；逃生门 `<html data-code-finder="off">`
完全关闭；试完清理 `dsh plugin --profile web remove dsh-better-sidebar`。

### 常见坑

- `pnpm build`（不带 NODE_ENV）会把 `lib/client*.js` 覆盖回**无注入**版本——试完
  生产构建要继续试用需重跑 dev 构建；
- 搜索层与第⑤层反查都依赖 **dsh-code-finder host 半**路由在跑（be-sider 不自带
  `/code-finder/api`；`dsh web` 起着 + profile 挂了 host 半）；首次搜索触发懒建
  索引——`~/.dsh/source/current` 不存在也不影响：monorepo 布局（宿主导入
  `packages/`、`apps/`）自动补位，其余源码用 `dcf roots add <profile> <src>`
  覆盖（注意 `--entry-id` 要指向实际生效的挂载行 id）；
- **两段式构建拿不到源码路径**：`data-locatorjs` 在 tsdown 打包 `lib/types/**/*.js`
  时注入，路径指向产物——第⑤层反查要求宿主机器上**产物旁保留 `*.js.map`**
  （tsc/tsdown 默认生成；发布时被 `files` 过滤掉 map 的包会反查失败，回退显示
  产物路径）；
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
