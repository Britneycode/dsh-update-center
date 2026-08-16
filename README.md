# @dsh-external/dsh-update-center

DeepSeek Harness 的本地更新中心：内置插件市场（浏览/搜索/一键安装/卸载/禁用），统一管理已装插件与 dsh 本体、profile 中的 npm/link 插件以及 agent preset 的更新。

## 安装

插件声明了 `dsh.bundle`（bundle patch 位于 `cordis.patch.yml`），构建产物随仓库分发，用官方 CLI 安装即可挂载为 profile 层：

```bash
dsh plugin --profile web add github:Britneycode/dsh-update-center
```

本地开发时也可以 link 安装：

```bash
dsh plugin --profile web add link:<本插件目录>
```

安装后重启 dsh web，设置页会出现「更新中心」面板。不需要第三方注入器。

## 插件市场

- 数据源：awesome-dsh-plugin.com 官方清单（GitHub 仓库每日 CI 产出）；站点不可用时自动降级解析 GitHub 仓库的 README 策展清单（字段较少但可浏览可安装），再回退磁盘缓存与内置快照（`data/registry-snapshot.json`）。
- 清单自动刷新：缓存超过 24 小时会在打开面板时自动拉取最新；后台每 12 小时静默刷新一次；「刷新清单」按钮随时强制更新。
- 出网请求仅允许 https 且 host 白名单（raw.githubusercontent.com 额外限定为清单仓库路径，防 SSRF）；安装目标只接受清单内条目，不接受任意包名。
- 安装优先走 npm 包（秒级），并做防抢注校验：npm 包的 repository 与清单 GitHub owner/repo 不一致时自动回退 `github:owner/repo`。
- 安装后校验包可解析且存在可运行入口（dsh 清单或 main 文件）；校验失败自动回滚卸载，不会留下坏包。
- pnpm ≥10 拒绝或跳过构建脚本时，错误信息会带 pnpm-workspace.yaml 放行指引。
- 卸载 = `pnpm remove` + 移出 `dsh.profile.bundles`，仅对 npm 安装的插件开放；link/preset 插件请直接编辑 profile。
- 禁用/启用 = 在 profile 的 `cordis.patch.yml` 写入/移除受管的 `disabled: true` 条目（按插件自身 insert id 定位，带标记区块与备份），不删文件、可随时恢复，重启后生效。
- 市场条目与已安装列表互通元数据：已安装插件显示市场描述与 GitHub 链接，市场里已装的插件显示「可更新」徽标。
- 市场支持排序：星标最多（默认）/ 默认策展顺序 / 最近添加，可叠加搜索与分类筛选。

## 一键全部更新

- 检查更新后，工具栏出现「全部更新」：把所有可更新插件（npm 版本落后 + link/preset 落后且无未提交改动）排成一个后台批量任务串行执行。
- 单个子任务失败不中断其余；结束后汇总「N 成功 / M 失败」，全部失败才标记任务失败。
- dsh 本体更新有独立的构建语义（完整更新/仅拉取），不并入批量。

## 当前能力

- 手动检查远端状态，不在打开设置页时自动发起网络请求。
- 检查与状态查询全部异步执行（子进程不再阻塞 dsh web 的事件循环），插件检查并行、`/status` 带 5 秒快照缓存。
- dsh 完整更新会依次执行快进拉取、`pnpm install` 和 `pnpm run build`。
- 更新由 `$DSH_HOME/update-center` 下的独立 worker 执行，停止或重启 dsh 不会中断任务。
- npm 插件按包名精准更新，不会因为点击单个插件而更新整个 profile。
- npm 更新完成后核对 `node_modules` 中的实际版本；版本没有变化时返回失败。
- npm 更新/安装/卸载后按官方 `dsh plugin` 的规则对账 `dsh.profile.bundles`；模板 bundle 不受影响。
- link 与 preset 只能通过已安装清单中的包名更新，API 不接受任意目录。
- Git 插件只更新了 `src` 而没有更新 `lib/dist` 时，自动执行包的 `build` 脚本。
- 插件来源（upstream）优先读取 git remote 的真实地址，内置映射仅作兜底。
- dsh 或本地插件存在未提交改动时停止更新，避免覆盖本地工作。
- 任一步骤失败都会返回失败阶段；不会把依赖安装或构建失败显示成成功。
- 更新写入磁盘后明确提示重启 dsh web。
- POST 动作仅接受同源请求（Origin 与 Host 一致）。
- `Start-DSH.ps1` 会等待后台更新完成再启动，`Stop-DSH.ps1` 不会结束更新 worker。

## 构建

构建脚本支持 Windows、macOS 和 Linux。它会从 `DSH_CHECKOUT`、相邻目录及常见用户目录中寻找 DeepSeek Harness checkout，并复用 checkout 的 TypeScript 与 tsdown。

```bash
npm run typecheck
npm test
npm run build
```

无法自动找到 checkout 时，先设置 `DSH_CHECKOUT`：

```powershell
$env:DSH_CHECKOUT = 'D:\App\dsh\deepseek-harness'
npm run build
```

## 配置

| 字段 | 说明 | 默认值 |
|---|---|---|
| `repoDir` | dsh 源码仓库 | 自动探测 |
| `profileDir` | web profile | `$DSH_HOME/profiles/web` |
| `presetDir` | agent preset 目录 | `$DSH_HOME/.agent-presets` |
| `proxy` | npm/pnpm 代理 | dsh 仓库的 `http.proxy` |
| `remote` | Git 远端名 | `origin` |
| `branch` | dsh 更新分支 | `master` |
| `upstreams` | 插件名到 GitHub 仓库的来源映射 | 内置常用插件 |

## 更新边界

更新中心只修改已明确识别的 dsh 仓库、profile npm 依赖和已安装的 Git 插件。它不会自动 stash、强制切换普通分支、执行非快进合并，也不会自动结束正在运行的 dsh 进程。
