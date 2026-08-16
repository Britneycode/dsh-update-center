/**
 * dsh-update-center — 更新中心（ui-panel 形态）。
 *
 * 能力：
 *  1. 已安装插件清单（profile dependencies/bundles + 版本，npm/link 分类）
 *  2. dsh 本体更新检查（git fetch → ahead/behind 对比）
 *  3. 一键更新：dsh 本体（git pull + 可选 install/build）、单个 npm 插件、
 *     已安装的 link/preset 插件
 *
 * 关键机制：
 *  - dsh 仓库代理复用 git 仓库级 http.proxy，npm/pnpm 走 Config.proxy 注入环境变量；
 *  - 所有子进程走异步 execAsync（./run-command.mjs：Windows .cmd 经
 *    cmd.exe /c 参数数组执行），检查更新不会阻塞 dsh web 的事件循环；
 *  - /status 有 5 秒快照缓存（?fresh=1 强制刷新），打开面板不再全量跑 git；
 *  - POST 动作校验 Origin 与 Host 同源，防止跨站触发更新；
 *  - 更新前拒绝脏工作区；更新后不自动结束自身进程，由面板提示用户重启。
 */
import type { Context } from 'cordis';
export declare const name = "dsh-update-center";
export declare const inject: string[];
export interface Config {
    /** dsh 仓库目录（缺省自动探测）。 */
    repoDir: string;
    /** profile 目录（缺省 $DSH_HOME/profiles/web）。 */
    profileDir: string;
    /** agent-preset 目录（缺省 $DSH_HOME/.agent-presets）。 */
    presetDir: string;
    /** 代理地址（npm/pnpm 用；git 复用仓库级 http.proxy）。 */
    proxy: string;
    /** git 远端名。 */
    remote: string;
    /** git 分支名。 */
    branch: string;
    /** 插件名 → GitHub 上游（owner/repo），用于展示项目来源。 */
    upstreams: Record<string, string>;
}
export declare const Config: Config;
type AppContext = Context & {
    webServer: any;
    tools: any;
};
export declare function apply(ctx: AppContext, config: Config): void;
export {};
