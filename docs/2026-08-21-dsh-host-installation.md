# dsh 宿主（deepseek-harness）接入：dcf CLI 安装与构建

本文件记录 **deepseek-harness** 这类 dsh 宿主如何接入
`@havocrao/dsh-code-finder`，以及接入后的构建姿势。与 `docs/README.md` 的
通用三档（A/B/C）互补：那里讲"单项目怎么挂"，这里讲"整仓宿主怎么挂"。

> 以下路径以 deepseek-harness 仓库为例（2026-08-21 实测通过）。其他 dsh 宿主
> 结构类似时可直接套用；结构不同时按「有效层」的映射关系找对应位置。

## 0. 概览：有效层（实测）

| 层 | 目标 | 覆盖 | 命令 | 有效性 |
|---|---|---|---|---|
| ~~L1 构建期注入（shell）~~ | ~~`apps/web/vite.config.ts`~~ | apps/web 只有入口 `main.ts`，**无 .tsx 组件源码** | ~~`dcf init --cwd apps/web`~~ | ❌ **已废弃**（已 `dcf remove`） |
| L2 运行时 overlay | `packages/bundle/web-app/cordis.patch.yml` | **一切 hover 的展示端**（蓝框/fiber/搜索路由），全页生效 | `dcf init --cwd packages/bundle/web-app --link <cf>` | ✅ 有效 |
| L3 构建期注入（client UI，**主力**） | 共享 preset `packages/client/tsdown.client.ts` 的 `clientConfig()` plugins | 页面所有 UI 组件（conversation/settings/sidebar…，运行时 `/plugins/*/client.js` 加载） | 手动加一行（见 §3） | ✅ 有效 |

- **L2 是基线**：没有 overlay，`data-locatorjs` 静默躺在 DOM 里没人读。
- **L3 是注入主力**：页面 UI 组件全在 client plugin bundles。
- **注入通道是 `dev-web.ts`（tsdown src 直编），不是 `build:lib`**：harness
  client 包构建是两阶段——`tsc` 先把 src 编成 `lib/types/*.js`（JSX 已转成
  `_jsx` 调用），`tsdown` 再 bundle lib/types 产物 → **build:lib 路径无 JSX 可
  注入**（生产语义本就不注入，发布天然干净）；`dev-web.ts` 的 tsdown 用
  **src direct build**（JSX 在），`codeFinderTsdown()` 在此生效。
- L1 废弃原因：apps/web 无组件源码，vite 注入无对象（实测 transform 全跑
  但命中的都不是 JSX → 0 注入）。

## 1. 前置

```bash
# 构建 code-finder 本体（产物 lib/ 是 link 安装的解析目标）
cd ~/Documents/Projects/tools/DSH-code-finder
pnpm build
```

## 2. 有效 CLI 速览（从零到 hover 有信息，共 5 步）

```bash
# ① 构建 code-finder 本体（见 §1）
# ② L2：挂 overlay 插件（dcf 自处理：link 安装 + patch 注入 + 幂等）
dcf init --cwd packages/bundle/web-app --link ~/Documents/Projects/tools/DSH-code-finder
# ③ L3：共享 preset 一键注入（clientConfig 精准注入，覆盖所有 client 包）
dcf init --cwd packages/client --link ~/Documents/Projects/tools/DSH-code-finder
# ④ profile 层：mount 行引用的包从 profile node_modules 解析——registry 未发布
#    时用 dsh plugin add 的 link: 协议装进 profile（否则 boot 抛 ERR_MODULE_NOT_FOUND）
dsh plugin --profile web add link:/Users/havoc/Documents/Projects/tools/DSH-code-finder
# ⑤ dev 语义构建（注入落进 client bundles）+ 启动。
#    dev-web.ts 是常驻 watch、无 --once，且自身不设 NODE_ENV——必须显式
#    development，否则 codeFinderEnabled 判定不注入。终端 A 构建、终端 B 起服务：
NODE_ENV=development pnpm run dev:web    # 终端 A（首次运行前需先有一次 pnpm run build，见 §5）
NODE_ENV=development pnpm dsh web        # 终端 B：overlay 挂载判定与构建侧对称——非 development 不挂载
```

> harness 的 `apps/web` 不需要也**不要**再 `dcf init`——它无 .tsx 组件源码，
> vite 注入无对象（实测 0），已废弃。

## 3. L2：overlay 插件（唯一有效的 dcf init 注入）

`--link` 指向本地 code-finder 仓库——registry 未发布时以 `link:` 协议安装；
发布后去掉 `--link` 即可（`pnpm add @havocrao/dsh-code-finder`）。

```bash
# 在 harness 仓库根下：
dcf init --cwd packages/bundle/web-app --link ~/Documents/Projects/tools/DSH-code-finder
```

效果：`packages/bundle/web-app/cordis.patch.yml` 的 insert 块首行挂双面插件：

- id **刻意与包内官方 patch 错开**（`dsh-code-finder-mount` vs 官方的
  `dsh-code-finder`）：包声明 `dsh.bundle.patch`，被 bundle 栈 reconcile 时
  官方行随包自动应用，id 相同会在 load 期抛 `duplicate loader entry id`
  （`disabled` 是运行期评估，救不了 load 期重复 id）；错开后官方行表达式
  （同名异 id 启用时退避）让官方行让位，单一活跃；
- 依赖 link 到 `web-app` 子包的 `node_modules`。

幂等：重复执行显示「已接入（无改动）」；本目录无 vite/tsdown 构建配置时 dcf
会如实提示「cordis 已接入，构建期注入请到实际构建目录（L3 = §4 的
`packages/client`）」。回滚：`dcf remove --cwd packages/bundle/web-app`
（`--keep-deps` 只回滚接线、保留依赖）。

> **monorepo 根跑会提示，不会越界**：`dcf init --cwd <harness 根>` 因为根是
> 条件式 tsdown orchestrator（无字面 `plugins: [` 数组）会如实报告未注入，
> 并列出检测到的深层 `cordis.patch.yml` + 对应 `--cwd` 命令（harness 有 5 个
> patch，自动注入有歧义，故 CLI 只提示、不自动改）。

## 4. L3：client bundles 共享 preset 注入（主力，dcf 一键）

页面大多数组件来自 client 插件包（`packages/client/*`），它们共享
`packages/client/tsdown.client.ts` 的 `clientBundle()` preset 构建。dcf 检测到
`clientConfig()` 共享 preset 时**只精准注入该函数的 plugins 数组**（其余数组
如 `staticLinkedConfig` 不动），**所有 client 包同时获得元素级注入**：

```bash
# 一键：workspace 子目录安装（--workspace-root 自动重试）+ import + clientConfig 精准注入
dcf init --cwd packages/client --link ~/Documents/Projects/tools/DSH-code-finder
# 幂等：重复执行「已接入（无改动）」；回滚：dcf remove --cwd packages/client
```

效果（实测）：`tsdown.client.ts` 仅 2 处改动——顶部 import + `clientConfig()`
的 `plugins: [codeFinderTsdown(), {`；`staticLinkedConfig` 等数组零污染；
`NODE_ENV=development pnpm run dev:web` 首轮构建后 client bundles 注入 402 处/包。

## 5. 构建姿势

**统一用 NODE_ENV 控制构建**：`NODE_ENV === 'development'` 才注入
（`src/build/transform.ts` 的 `codeFinderEnabled`）。`CODE_FINDER` 是**构建与
运行时共用的强制逃生门**（`1/on/true` 强制开、`0/off/false` 强制关，见 §5.1），
不是日常开关。

| 场景 | 命令 | 注入 |
|---|---|---|
| dev watch 循环（推荐开发/验证） | `NODE_ENV=development pnpm run dev:web`（另开终端 `NODE_ENV=development pnpm dsh web`） | ✓（**src 直编**，client bundles 注入） |
| serve（只 serve 不构建） | `NODE_ENV=development pnpm dsh web`（非 dev serve：overlay 完全不存在） | 无关（读已烘焙属性） |
| 全量生产构建 | `pnpm run build` | ✗ 0 处（发布正确行为） |
| 只重编前端 shell | `pnpm run build:web` | ✗（vite 默认 production） |

- **`dev-web.ts` 没有 `--once`**：参数只有 `[--poll[=ms]]`，本身是常驻 watch
  （tsc + tsdown + vite 三路，任一退出即报错终止整个脚本）。
- **`dev-web.ts` 不内置 NODE_ENV**：注入判定在 dcf 侧
  （`src/build/transform.ts` 的 `codeFinderEnabled`）——
  `NODE_ENV === 'development'` 才注入，`CODE_FINDER=1` 可强制开、`CODE_FINDER=0`
  强制关。环境没设 NODE_ENV 时 watch 跑得欢但产物零注入，必须显式
  `NODE_ENV=development`。
- **首次运行前需要一次全量构建**：`dev-web.ts` 三路 watcher 都在上一次
  `pnpm run build` 的产物上增量，不 bootstrap 缺失树。
- "一次性重建即退"没有官方命令：要么 watch（推荐），要么 `CODE_FINDER=1`
  对 tsc/tsdown/vite 各 stage 各跑一次非 watch 版本。

**陷阱**：root 的 `build:dev` 用的是 `NODE_ENV=developer`（**不是**
`development`）→ 不会注入，别被名字误导。`pnpm run build` 会把 dev 产物
覆盖回无注入版本——dev 中途手滑跑过，hover 退回「只有组件名」，重跑
`NODE_ENV=development pnpm run dev:web` 恢复。

### 5.1 运行时统一 NODE_ENV（非 dev 完全不存在）

**构建期与运行时判定完全对称**（都镜像 `codeFinderEnabled` 的语义）：只有
明确的 dev 环境才挂载——`NODE_ENV === 'development'`（或 `CODE_FINDER=1/on/true`
强制开、且未被 `0/off/false` 强制关）；**未设 NODE_ENV 与 production 一样
不挂载**（构建无注入时运行时也零存在，杜绝空壳 overlay）。mount 行的
`disabled` 由 `!!js` 在 **node 端 loader** 原生求值（读真实 `process.env`），
单行静态表达式无递归：

```yaml
- id: dsh-code-finder-mount
  name: '@havocrao/dsh-code-finder'
  disabled: !!js "(process.env.NODE_ENV !== 'development' || ['0','off','false'].includes(process.env.CODE_FINDER)) && !['1','on','true'].includes(process.env.CODE_FINDER)"
```

```bash
NODE_ENV=development pnpm dsh web   # dev：注入 + overlay 挂载（hover 有信息）
pnpm dsh web                        # 未设 NODE_ENV：overlay 完全不挂（空壳不存在）
NODE_ENV=production pnpm dsh web    # 生产：overlay 不挂载（零 hover）
```

非 dev 时 entry 不 apply（host 半不注册路由、client 半不挂载），浏览器
wire bundle 无需任何 process/define 判定。`CODE_FINDER` 是**构建与运行时
共用的逃生门**（构建侧强制注入 ⇄ 运行时强制挂载，两侧同语义）；浏览器原生
`<html data-code-finder="off">` 仍是即时逃生门。

## 6. 验证

```bash
dcf status --cwd packages/bundle/web-app     # cordis.patch.yml 已接线 + 依赖已安装
# dev 重建后抽查产物（L3 生效的硬证据）：
grep -rl data-locatorjs packages/client/*/lib/client.js | head   # client UI 注入
grep -c data-locatorjs packages/client/ui-conversation/lib/client.js   # 实测 402
# 浏览器：NODE_ENV=development pnpm dsh web → Opt+Shift 悬停组件 → 蓝框 + `<组件名> path:line:col`
```

## 7. 卸载

```bash
dcf remove --cwd packages/bundle/web-app
# L3：删掉 preset 里加的那一行 + 根级 pnpm remove @havocrao/dsh-code-finder
```

`remove` 只精确移除 CLI 自己加的 import / plugins / cordis 行，其余修改保留；
连带卸载依赖（`--keep-deps` 保留）。

## 8. 常见坑

- **`--link` 只解决本地开发**：`link:` 协议写进子包 `package.json`
  （`"@havocrao/dsh-code-finder": "link:/abs/path"`）。提交前要么发布到
  registry 后重跑 `dcf init`（去 `--link`），要么按 better-sidebar 先例把
  `../../DSH-code-finder` 加进 `pnpm-workspace.yaml` 作为 workspace 成员。
- **L3 依赖必须在根**：client preset 的 import 由仓库根启动的 tsdown 解析，
  link 在子包下根级解析不到。
- **`prepare`/`postinstall` 陷阱**：安装触发重建会以生产语义覆盖 dev 产物，
  install 后 hover 变无信息——`grep -c data-locatorjs <bundle>` 自查，被覆盖
  就重跑 `NODE_ENV=development pnpm run dev:web`。
- **workspace 根 postinstall 失败会让 pnpm add 整体回滚**（实测）：如 harness
  的 `install-lefthook.mjs` 遇残留的 `.git/dsh-lefthook-install.lock` 失败 →
  `pnpm add` 虽已写入 `+ @havocrao/dsh-code-finder link:…` 也整体报错回滚
  （`package.json` 不残留条目，但 node_modules 的 link 链接留成孤儿）；随后
  dcf fallback 到 npm 时必报 `EUNSUPPORTEDPROTOCOL`（`link:` 协议 npm 不认识，
  属预期噪音）。修复：确认无 lefthook 安装器在跑后删除该 lock 重跑；孤儿链接
  会在下次 `pnpm install` 被对账清掉，补一条正式记录：
  `cd packages/bundle/web-app && pnpm add -D link:/…/DSH-code-finder`。
- **monorepo 多 patch**：harness 有 5 个 `cordis.patch.yml`，dcf 只对
  `--cwd` 明确指向的那个动手；根跑只提示。
- **`ctx.config` 不可读**：cordis 4 中插件 apply 读 `ctx.config` 会抛
  "cannot get property config without inject"——host 半只用 apply 第二参
  （无 Config schema 时 loader 原样传 entry config）。
