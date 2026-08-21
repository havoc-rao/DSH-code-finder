# dcf 效果"清理后仍在"排查实录：dsh 官方插件管线的隐式挂载

本文件记录 2026-08-21 的一次真实排查：harness 全面清理 dcf 后，
hover 定位效果（蓝框 + 组件名 + `文件:行:列`）**依旧存在**，最终定位到
**dsh 官方插件管线（`dsh plugin add`）在 profile 层的隐式挂载**。

> 结论先行：运行时 overlay 的挂载有**两条独立路径**——码库里的手动 mount 行
> 与 profile 依赖管线（官方行）。清仓库只清了手动线；profile 依赖声明没清，
> 官方行每次启动自动挂载。且 overlay 的显示层**不依赖构建期注入**（有
> fiber `_debugSource` 回退），所以"产物 0 注入"与"hover 有效果"可以同时成立。

## 0. 症状

在一连串清理操作之后，`pnpm dsh web` 页面 hover 组件仍有蓝框 +
组件名 + 源码位置提示：

1. `packages/client/tsdown.client.ts` 的 `codeFinderTsdown()` 已随 git 回滚
2. `packages/bundle/web-app/cordis.patch.yml` 的 `dsh-code-finder-mount` 行已随 git 回滚
3. 全量重建后产物 `data-locatorjs` 计数 0（dist assets、client bundles 各抽查）
4. `~/.dsh/profiles/web/node_modules/@havocrao/dsh-code-finder` 包目录已删除
5. **普通刷新、硬刷新、无痕窗口全部依旧**

## 1. 排查路线（按序，均为实测）

| # | 假设 | 验证方法 | 结果 |
|---|---|---|---|
| 1 | 服务端仍在注入 | `curl http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js \| grep -c data-locatorjs` | 0 —— 排除 |
| 2 | 存在第二个 dsh 实例 | `lsof -iTCP -sTCP:LISTEN -P` + `ps` | 仅 3080 一个 node（cwd = harness 根）—— 排除 |
| 3 | 源码中仍有注入逻辑 | 全仓 grep `locatorjs`/`@locator`/`data-locatorjs`（harness、dsh-plugins、better-sidebar、code-agent-link） | 全 0 —— 排除 |
| 4 | 浏览器缓存 / SW / 扩展 | 无痕窗口打开 3080 | **依旧** —— 排除浏览器侧 |
| 5 | 加载源不是工作区产物 | 对比 `lsof -p <pid>` cwd、profile/node_modules 副本 grep | 副本也 0 注入 —— 排除 |

**转折点**：读 `src/client/resolve.ts` 发现显示层有三级回退（见 §3）——
"效果"不必来自注入。于是转向查**运行时挂载源**：

| # | 假设 | 验证方法 | 结果 |
|---|---|---|---|
| 6 | 包仍被某处安装 | `find ~/.dsh -name "dsh-code-finder"` | **命中**：`~/.dsh/profiles/web/package.json`（依赖声明 + bundles 列表）、profiles **共享层** `~/.dsh/profiles/node_modules/@havocrao/dsh-code-finder`（整个仓库副本） |
| 7 | 线上确实挂载 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/plugins/@havocrao/dsh-code-finder/client.js` | **200** —— 插件正挂在运行中的服务上 |

## 2. 根因：`dsh plugin add` 的隐式挂载（官方管线）

按 docs/2026-08-21-dsh-host-installation.md §2 ④ 执行的
`dsh plugin --profile web add link:<本地仓库>` 做了三件事：

1. 把依赖**写进 profile 的 package.json**（`"@havocrao/dsh-code-finder": "link:…"`）——
   **删除包目录不影响依赖声明，pnpm 会随时重装回去**；
2. 把包装进 profiles 共享层 `~/.dsh/profiles/node_modules/`（profile 是 pnpm
   workspace，共享层即提升的顶层）；
3. **把包内官方 patch 自动合并进 bundle stack**——包内 `cordis.patch.yml`
   注释自述：*"the command reconciles `dsh.profile.bundles` against installed
   packages and, seeing this declaration, appends the package to the bundle
   stack. The profile boot then merges THIS patch … No profile file edits
   needed."*

于是每次 `pnpm dsh web` 启动，profile boot 都自动挂载官方行
（`dsh-code-finder`），与码库里的手动行 `dsh-code-finder-mount` **无关**。
手动行只是"无官方管线"场景的替代；官方管线存在时，回滚仓库文件毫无作用。

## 3. 显示层回退：为什么"0 注入也有 hover 效果"

`src/client/resolve.ts` 的解析优先级：

1. `data-locatorjs` 属性（构建期注入，`<absPath>:<line>:<col>`）——元素级精确；
2. `data-locatorjs-id`（注册表反查）；
3. **React fiber `_debugSource` / `_debugInfo`——dev React 宿主自动可用，
   零改动**；覆盖生产压缩后的组件名；
4. 组件名兜底（任何 React 宿主至少拿到名字）。

结论：**只要 overlay（client 半）在运行，dev 模式下组件名和源码位置永远
可显示**。构建注入被清只是让第 1/2 级失效，展示效果不消失。
这也是排查时最反直觉的一环："产物干净" ≠ "效果消失"。

## 4. 正确卸载（对照）

### 错误动作（本次踩坑）

- 回滚码库文件（mount 行 / tsdown 注入）：只清手动线，官方管线照挂；
- 删 `~/.dsh/profiles/web/node_modules/@havocrao/dsh-code-finder` 目录：
  依赖声明还在，链接随 pnpm 重装复活；
- 只查 web profile 不查共享层 / profile package.json。

### 正确动作

```bash
# ① 官方卸装：清 profile package.json 依赖 + bundles 列表 + 共享层包
dsh plugin --profile web remove @havocrao/dsh-code-finder

# ② 兜底（卸载残留时）
cd ~/.dsh/profiles/web && pnpm remove @havocrao/dsh-code-finder

# ③ 顺手清码库里 pnpm 回滚遗留的孤儿链接（package.json 无条目）
rm -rf packages/bundle/web-app/node_modules/@havocrao

# ④ 重启并验证（挂载判定：200 → 404）
pnpm dsh web
curl -s -o /dev/null -w "%{http_code}\n" \
  http://127.0.0.1:3080/plugins/@havocrao/dsh-code-finder/client.js   # 期望 404
```

### 挂载判定快速法

页面运行中的 dsh 服务上，`/plugins/<id>/client.js` 返回 **200** 即插件
**正在挂载**（loader 已扫描并 serve 其 client 半）；404 即未挂载。这是
不依赖浏览器 console 的最快线上挂载检测。

## 5. 复用经验

清理类问题"效果残留"只有两类根因，按序排查：

1. **运行时挂载管线未清**（本案例）：查
   `~/.dsh/profiles/<name>/package.json`（依赖 + bundles 列表）、
   `~/.dsh/profiles/node_modules/`（共享层）、线上 `/plugins/<id>/client.js`
   状态码；
2. **显示层有回退**（本案例叠加）：工具存在多级数据源时，"注入被清"
   不代表"功能消失"——先读工具的 resolve 链再下结论。

配套侦察命令：

```bash
lsof -iTCP -sTCP:LISTEN -P | grep node          # 服务与端口
ps aux | grep "bin.ts web"                       # 服务进程号 → lsof -p <pid> | grep cwd
curl -s <url>/plugins/<id>/client.js | grep -c data-locatorjs   # 线上注入实测
find ~/.dsh -name "<pkg>"                        # 所有安装点
grep -n "<pkg>" ~/.dsh/profiles/*/package.json   # 依赖声明与 bundles 列表
```