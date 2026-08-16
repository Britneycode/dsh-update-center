/**
 * @dsh-external/dsh-update-center — 更新中心（ui-panel 形态）。
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

import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { runCommandAsync } from './run-command.mjs'
import { mergeGithubTopic } from './github-topic.mjs'
import { applyNpmMapping } from './npm-mapping.mjs'

export const name = '@dsh-external/dsh-update-center'
export const inject = ['tools', 'webServer']

export interface Config {
  /** dsh 仓库目录（缺省自动探测）。 */
  repoDir: string
  /** profile 目录（缺省 $DSH_HOME/profiles/web）。 */
  profileDir: string
  /** agent-preset 目录（缺省 $DSH_HOME/.agent-presets）。 */
  presetDir: string
  /** 代理地址（npm/pnpm 用；git 复用仓库级 http.proxy）。 */
  proxy: string
  /** git 远端名。 */
  remote: string
  /** git 分支名。 */
  branch: string
  /** 插件名 → GitHub 上游（owner/repo），用于展示项目来源。 */
  upstreams: Record<string, string>
}

export const Config = z.object({
  repoDir: z.string().default(''),
  profileDir: z.string().default(''),
  presetDir: z.string().default(''),
  proxy: z.string().default(''),
  remote: z.string().default('origin'),
  branch: z.string().default('master'),
  upstreams: z.dict(z.string()).default({}),
}) as unknown as Config

type AppContext = Context & {
  webServer: any
  tools: any
}

interface ExecResult {
  ok: boolean
  code: number | null
  out: string
  err: string
}

/** git remote URL → GitHub owner/repo。捕获组限定为 GitHub 实际字符集
 * （字母数字._-），输出天然 shell 安全；不匹配返回 null。 */
const UPSTREAM_RE = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i

/**
 * 异步执行命令：候选解析（Windows .exe → .cmd）、cmd.exe 参数数组执行与
 * ENOENT 重试竞态守卫统一实现在 ./run-command.mjs（与 worker 的执行语义一致）。
 */
function execAsync(cmd: string, args: string[], cwd?: string, timeoutMs = 120_000, extraEnv?: Record<string, string>): Promise<ExecResult> {
  return runCommandAsync(cmd, args, cwd, timeoutMs, extraEnv)
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function apply(ctx: AppContext, config: Config): void {
  const logger = ctx.logger

  // ── 路径解析（探测优先级：Config → DSH_CHECKOUT/cwd → home 常见路径）──
  const repoDir = resolveRepoDir(config.repoDir)
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profileDir = config.profileDir || join(dshHome, 'profiles', 'web')
  const presetDir = config.presetDir || join(dshHome, '.agent-presets')
  const remote = config.remote || 'origin'
  const branch = config.branch || 'master'
  // 已知上游映射仅作兜底：优先展示 git remote 的真实来源。
  const upstreams: Record<string, string> = {
    'dsh-bash-terminal': 'MAXeaglet/dsh-bash-terminal',
    '@dsh-external/dsh-super-injector': 'yjh051108/dsh-super-injector',
    'dsh-router-standard': 'yjh051108/dsh-router-standard',
    'router-standard': 'yjh051108/dsh-router-standard',
    ...config.upstreams,
  }
  // git 仓库级代理优先（用户在仓库 config 配过 http.proxy 时自动复用）
  const proxyPromise: Promise<string> = config.proxy
    ? Promise.resolve(config.proxy)
    : gitProxy(repoDir)
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const updateHome = join(dshHome, 'update-center')
  const jobsDir = join(updateHome, 'jobs')
  const latestJobPath = join(updateHome, 'latest.json')
  const workerSource = join(pluginRoot, 'scripts', 'update-worker.mjs')
  const workerTarget = join(updateHome, 'dsh-update-worker.mjs')
  // /status 快照缓存：面板打开/任务轮询不再每次全量跑 git 子进程。
  const STATUS_TTL_MS = 5_000
  let statusCache: { at: number; repo: Record<string, unknown>; plugins: Array<Record<string, unknown>> } | null = null

  function writeJsonAtomic(file: string, value: unknown): void {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8')
    renameSync(temporary, file)
  }

  function readJob(file: string): Record<string, unknown> | null {
    return readJson(file)
  }

  function processAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  function latestJob(): Record<string, unknown> | null {
    const job = readJob(latestJobPath)
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return job
    const pid = typeof job.workerPid === 'number' ? job.workerPid : null
    const updatedAt = typeof job.updatedAt === 'string' ? Date.parse(job.updatedAt) : 0
    const staleQueuedJob = job.status === 'queued' && Date.now() - updatedAt > 15_000
    if ((pid !== null && processAlive(pid)) || (!pid && !staleQueuedJob)) return job
    const failed = {
      ...job,
      status: 'failed',
      stage: 'worker-exit',
      error: '后台更新进程已退出，任务没有完成。',
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const id = typeof job.id === 'string' ? job.id : ''
    if (/^[a-zA-Z0-9-]+$/.test(id)) writeJsonAtomic(join(jobsDir, `${id}.json`), failed)
    writeJsonAtomic(latestJobPath, failed)
    return failed
  }

  function jobById(id: string): Record<string, unknown> | null {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) return null
    return readJob(join(jobsDir, `${id}.json`))
  }

  async function startJob(spec: Record<string, unknown>): Promise<Record<string, unknown>> {
    const active = latestJob()
    if (active && (active.status === 'queued' || active.status === 'running')) {
      return { ok: false, result: '已有更新任务正在执行，请等待当前任务完成。', job: active }
    }
    if (!existsSync(workerSource)) {
      return { ok: false, result: `更新 worker 不存在: ${workerSource}` }
    }
    const proxy = await proxyPromise
    mkdirSync(jobsDir, { recursive: true })
    copyFileSync(workerSource, workerTarget)
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const statePath = join(jobsDir, `${id}.json`)
    const specPath = join(jobsDir, `${id}.spec.json`)
    const initial = {
      id,
      action: spec.action,
      target: spec.target ?? '',
      status: 'queued',
      stage: 'queued',
      message: '更新任务已排队',
      steps: [],
      restartRequired: false,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    writeJsonAtomic(statePath, initial)
    writeJsonAtomic(latestJobPath, initial)
    writeJsonAtomic(specPath, {
      ...spec,
      id,
      statePath,
      latestPath: latestJobPath,
      proxy,
      repoDir,
    })
    try {
      // spawn 参数注入防护：worker 两路径均为内部拼接的绝对路径，拒绝任何以 "-" 开头的值；
      // "--" 终止符确保 node 不会把后续参数解释为自己的选项。
      for (const arg of [workerTarget, specPath]) {
        if (!isAbsolute(arg) || arg.startsWith('-')) {
          throw new Error(`worker 路径非法: ${arg}`)
        }
      }
      const child = spawn(process.execPath, ['--', workerTarget, specPath], {
        cwd: updateHome,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
    } catch (error) {
      const failed = {
        ...initial,
        status: 'failed',
        stage: 'spawn',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      }
      writeJsonAtomic(statePath, failed)
      writeJsonAtomic(latestJobPath, failed)
      return { ok: false, result: failed.error, job: failed }
    }
    return { ok: true, result: '更新任务已启动', job: initial }
  }

  function resolveRepoDir(configured: string): string {
    if (configured && existsSync(join(configured, 'package.json'))) return configured
    if (process.env.DSH_CHECKOUT && existsSync(join(process.env.DSH_CHECKOUT, 'package.json'))) {
      return process.env.DSH_CHECKOUT
    }
    const cwd = process.cwd()
    if (existsSync(join(cwd, 'package.json'))) {
      const pkg = readJson(join(cwd, 'package.json'))
      if (pkg?.name === '@deepseek-ai/dsh-root') return cwd
    }
    for (const sub of ['dsh-harness', 'deepseek-harness', 'dsh']) {
      const dir = join(homedir(), sub)
      if (existsSync(join(dir, 'package.json'))) return dir
    }
    return ''
  }

  /** git 仓库级代理（用户在仓库 config 配过 http.proxy 时自动复用）。 */
  async function gitProxy(dir: string): Promise<string> {
    if (!dir) return ''
    const r = await execAsync('git', ['config', '--get', 'http.proxy'], dir, 10_000)
    return r.ok ? r.out.trim() : ''
  }

  /** git 仓库状态（不 fetch，只读本地 refs；各命令并行）。 */
  async function repoStatus(): Promise<Record<string, unknown>> {
    if (!repoDir) return { path: '', version: '', git: null, error: '未找到 dsh 仓库目录' }
    const pkg = readJson(join(repoDir, 'package.json'))
    const [head, branchOut, remoteUrl, dirtyOut] = await Promise.all([
      execAsync('git', ['rev-parse', '--short', 'HEAD'], repoDir, 10_000),
      execAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoDir, 10_000),
      execAsync('git', ['remote', 'get-url', remote], repoDir, 10_000),
      execAsync('git', ['status', '--porcelain'], repoDir, 10_000),
    ])
    const count = (range: string): Promise<number | null> =>
      execAsync('git', ['rev-list', '--count', range], repoDir, 10_000)
        .then((r) => (r.ok ? Number(r.out.trim()) : null))
    const [behind, ahead] = await Promise.all([
      count(`HEAD..${remote}/${branch}`),
      count(`${remote}/${branch}..HEAD`),
    ])
    return {
      path: repoDir,
      version: typeof pkg?.version === 'string' ? pkg.version : '',
      git: {
        head: head.ok ? head.out.trim() : null,
        branch: branchOut.ok ? branchOut.out.trim() : null,
        remote: remoteUrl.ok ? remoteUrl.out.trim() : null,
        ahead,
        behind,
        dirty: dirtyOut.ok ? dirtyOut.out.trim().length > 0 : null,
        dirtyFiles: dirtyOut.ok ? dirtyOut.out.trim().split('\n').filter(Boolean).slice(0, 8) : [],
      },
    }
  }

  /** 插件基础清单：profile dependencies + agent-presets，只读文件、不跑子进程。 */
  function inventoryBasic(): Array<Record<string, unknown>> {
    const entries: Array<Record<string, unknown>> = []
    const profilePkg = readJson(join(profileDir, 'package.json'))
    if (profilePkg) {
      const deps = (profilePkg.dependencies as Record<string, string> | undefined) ?? {}
      const dshMeta = (profilePkg.dsh as { profile?: { bundles?: unknown[] } } | undefined)
      const bundles = dshMeta?.profile?.bundles ?? []
      const bundleSet = new Set(bundles.map(String))
      for (const [name, spec] of Object.entries(deps)) {
        const isLink = String(spec).startsWith('link:')
        const rawLinkDir = isLink ? String(spec).slice(5) : null
        const linkDir = rawLinkDir
          ? resolve(isAbsolute(rawLinkDir) ? rawLinkDir : join(profileDir, rawLinkDir))
          : null
        let version: string | null = null
        if (linkDir) {
          const lpkg = readJson(join(linkDir, 'package.json'))
          version = typeof lpkg?.version === 'string' ? lpkg.version : null
        } else {
          const p = join(profileDir, 'node_modules', ...name.split('/'))
          const lpkg = readJson(join(p, 'package.json'))
          version = typeof lpkg?.version === 'string' ? lpkg.version : null
        }
        entries.push({
          name,
          spec,
          kind: isLink ? 'link' : 'npm',
          version,
          bundled: bundleSet.has(name),
          linkDir: isLink ? linkDir : null,
          git: null,
          upstream: upstreams[name] ?? null,
          disabled: name in readDisables(),
          // npm 最新版：惰性填充（check 动作里查询）
          latest: null,
        })
      }
    }
    // agent-presets 扫描：每个含 preset 标记的目录是一个 preset 插件
    try {
      for (const dirent of readdirSync(presetDir, { withFileTypes: true })) {
        if (!dirent.isDirectory()) continue
        const dir = join(presetDir, dirent.name)
        const presetPkg = readJson(join(dir, 'package.json'))
        const version = typeof presetPkg?.version === 'string'
          ? presetPkg.version
          : null
        entries.push({
          name: dirent.name,
          spec: 'preset:' + dir,
          kind: 'preset',
          version,
          bundled: false,
          linkDir: dir,
          git: null,
          upstream: upstreams[dirent.name] ?? null,
          latest: null,
        })
      }
    } catch { /* preset 目录不可读则跳过 */ }
    return entries
  }

  /** 从 git remote URL 提取 owner/repo（仅 GitHub 形态）。捕获组限定为 GitHub
   * 实际允许的字符集（字母数字._-），输出天然 shell 安全；失败返回 null。 */

  /**
   * 本地 git 快照（head/branch/status/remote 并行；默认不 fetch）。
   * fetch=true 时额外执行 fetch 并计算 ahead/behind（detached HEAD 回退远端默认分支）。
   */
  async function gitSnapshot(dir: string, options: { fetch?: boolean; env?: Record<string, string> } = {}): Promise<Record<string, unknown>> {
    const fetchPromise = options.fetch
      ? execAsync('git', ['fetch', '--all', '--prune'], dir, 60_000, options.env)
      : null
    const [head, branchOut, status, remoteUrl] = await Promise.all([
      execAsync('git', ['rev-parse', '--short', 'HEAD'], dir, 10_000),
      execAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir, 10_000),
      execAsync('git', ['status', '--porcelain'], dir, 10_000),
      execAsync('git', ['remote', 'get-url', 'origin'], dir, 10_000),
    ])
    const fetch = fetchPromise ? await fetchPromise : null
    const b = branchOut.ok ? branchOut.out.trim() : null
    const count = (range: string): Promise<number | null> =>
      execAsync('git', ['rev-list', '--count', range], dir, 10_000)
        .then((r) => (r.ok ? Number(r.out.trim()) : null))
    let ahead: number | null = null
    let behind: number | null = null
    if (options.fetch) {
      // detached HEAD（b === 'HEAD'）没有 upstream：取第一个远端分支作为参照
      let upstream = b && b !== 'HEAD' ? '@{u}' : null
      if (!upstream) {
        const refs = await execAsync('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], dir, 10_000)
        const refsList = refs.ok ? refs.out.trim().split('\n').filter(Boolean) : []
        const first = refsList.find((r) => !r.endsWith('/HEAD'))
        if (first) upstream = first
      }
      if (upstream) {
        ;[behind, ahead] = await Promise.all([
          count(`HEAD..${upstream}`),
          count(`${upstream}..HEAD`),
        ])
      }
    }
    const info: Record<string, unknown> = {
      head: head.ok ? head.out.trim() : null,
      branch: b,
      remoteUrl: remoteUrl.ok ? remoteUrl.out.trim() : null,
      ahead,
      behind,
      dirty: status.ok ? status.out.trim().length > 0 : null,
    }
    if (fetch) {
      info.fetchOk = fetch.ok
      info.fetchErr = fetch.ok ? '' : fetch.err.trim().slice(0, 200)
    }
    return info
  }

  /** 插件清单：基础清单 + git 信息（并行），upstream 优先取真实 remote。 */
  async function pluginList(): Promise<Array<Record<string, unknown>>> {
    const entries = inventoryBasic()
    await Promise.all(entries.map(async (entry) => {
      const dir = typeof entry.linkDir === 'string' ? entry.linkDir : ''
      if ((entry.kind === 'link' || entry.kind === 'preset') && dir && existsSync(join(dir, '.git'))) {
        const git = await gitSnapshot(dir)
        entry.git = git
        const upstreamMatch = typeof git.remoteUrl === 'string' ? UPSTREAM_RE.exec(git.remoteUrl.trim()) : null
        if (upstreamMatch) entry.upstream = `${upstreamMatch[1]}/${upstreamMatch[2]}`
      }
    }))
    return entries
  }

  /** 查询 npm registry 某包最新版（走代理，失败返回 null）。 */
  async function npmLatest(pkg: string, env?: Record<string, string>): Promise<string | null> {
    const r = await execAsync('npm', ['view', pkg, 'version', '--json'], profileDir, 30_000, env)
    if (!r.ok) return null
    try {
      const v = JSON.parse(r.out.trim())
      return typeof v === 'string' ? v : null
    } catch {
      return null
    }
  }

  // ── 插件市场数据源（本仓库 plugins.json 注册表 + GitHub 主题扫描增量）──
  // 主源：本仓库根目录 plugins.json 的 raw 直链（固定字面量端点，可独立于
  //  插件发版更新注册表）。离线兜底：磁盘缓存 → 随包快照。
  // 增量：后台扫描 GitHub topic:dsh-plugin（星标前 500，排除 fork），与注册表
  //  按 owner/name 去重合并——重复条目仅刷新星标，新条目追加。
  const REGISTRY_MAX_BYTES = 8 * 1024 * 1024
  const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000
  const REGISTRY_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000
  // 搜索 API 单次查询上限 1000，5 页 × 100 已覆盖主流插件，也留出未认证
  // 搜索 10 次/分钟的限额余量。
  const GITHUB_TOPIC_MAX_PAGES = 5
  const registryCacheFile = join(updateHome, 'registry-cache.json')
  let registryCache: { at: number; source: string; data: any } | null = null
  let githubTopicScanRunning = false

  function validRegistry(data: any): boolean {
    return !!data && typeof data === 'object' && Array.isArray(data.plugins)
      && data.plugins.length > 0
      && data.plugins.every((p: any) => p && typeof p.name === 'string' && typeof p.url === 'string')
  }

  /** 拉取注册表文本：配置了代理时走 curl（按调用时环境变量代理；Windows 10+
   *  自带 curl.exe，Unix 亦普遍可用），否则直接 fetch。端点由调用方以字面量传入。 */
  async function fetchRegistryText(url: string): Promise<string | null> {
    const proxy = await proxyPromise
    if (proxy) {
      const r = await execAsync('curl', ['-sSLf', '--max-time', '20', '--max-filesize', String(REGISTRY_MAX_BYTES), '-H', 'accept: application/json', url], undefined, 60_000, {
        HTTPS_PROXY: proxy,
        HTTP_PROXY: proxy,
        https_proxy: proxy,
        http_proxy: proxy,
      })
      return r.ok && r.out ? r.out : null
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!response.ok) return null
      const text = await response.text()
      return text.length > REGISTRY_MAX_BYTES ? null : text
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  /** 网络拉取：本仓库根目录 plugins.json 注册表（raw 直链，字面量端点）；
   *  失败返回 null，由磁盘缓存与随包快照兜底。 */
  async function fetchRegistryFromNetwork(): Promise<{ source: string; data: any } | null> {
    const text = await fetchRegistryText('https://raw.githubusercontent.com/Britneycode/dsh-update-center/main/plugins.json')
    if (!text) return null
    try {
      const data = JSON.parse(text)
      if (validRegistry(data)) return { source: 'registry', data }
    } catch { /* 数据无效走兜底 */ }
    return null
  }

  /** GitHub 搜索 API 拉取一页 topic:dsh-plugin 仓库（按星标降序）。
   * 端点为固定字面量 host（api.github.com）+ 内部整数页码，无外部输入参与。 */
  async function fetchGithubTopicPage(page: number): Promise<any | null> {
    const url = new URL('https://api.github.com/search/repositories')
    url.searchParams.set('q', 'topic:dsh-plugin')
    url.searchParams.set('sort', 'stars')
    url.searchParams.set('order', 'desc')
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))
    if (url.protocol !== 'https:' || url.hostname !== 'api.github.com') {
      throw new Error(`GitHub topic 端点校验失败: ${url.host}`)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/vnd.github+json' } })
      if (response.status === 403 || response.status === 429) return null // 触发限流，停止翻页
      if (!response.ok) return null
      return await response.json()
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  /** 扫描 GitHub topic（排除 fork），返回仓库数组；失败/限流返回空数组。 */
  async function fetchGithubTopicRepos(): Promise<any[]> {
    const repos: any[] = []
    for (let page = 1; page <= GITHUB_TOPIC_MAX_PAGES; page++) {
      const payload = await fetchGithubTopicPage(page)
      const items = Array.isArray(payload?.items) ? payload.items : null
      if (!items) break
      repos.push(...items.filter((repo: any) => repo && repo.fork !== true))
      if (items.length < 100) break
    }
    return repos
  }

  /** npm 关键词搜索（keywords:dsh-plugin，每页 250，最多 4 页拿全）。
   *  端点为固定字面量 host（registry.npmjs.org）+ 内部整数偏移。 */
  async function fetchNpmSearchObjects(): Promise<any[]> {
    const objects: any[] = []
    for (let from = 0; from < 1000; from += 250) {
      const url = new URL('https://registry.npmjs.org/-/v1/search')
      url.searchParams.set('text', 'keywords:dsh-plugin')
      url.searchParams.set('size', '250')
      url.searchParams.set('from', String(from))
      if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') {
        throw new Error(`npm search 端点校验失败: ${url.host}`)
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
        if (!response.ok) break
        const payload: any = await response.json()
        const items = Array.isArray(payload?.objects) ? payload.objects : []
        if (!items.length) break
        objects.push(...items)
        const total = Number(payload?.total ?? 0)
        if (from + items.length >= total) break
      } catch {
        break
      } finally {
        clearTimeout(timer)
      }
    }
    return objects
  }

  /** 后台 GitHub 主题扫描：与当前注册表按 owner/name 去重合并（重复条目仅刷新
   *  星标，新条目追加进「GitHub 发现」分类），并用 npm 关键词搜索补包名映射；
   *  结果写回本地磁盘缓存。 */
  async function enrichRegistryWithGithubTopics(): Promise<void> {
    if (githubTopicScanRunning || !registryCache) return
    githubTopicScanRunning = true
    try {
      const repos = await fetchGithubTopicRepos()
      if (!repos.length) return
      const { added, starsUpdated } = mergeGithubTopic(registryCache.data, repos)
      const npmObjects = await fetchNpmSearchObjects()
      const mapped = applyNpmMapping(registryCache.data, npmObjects)
      if (!added && !starsUpdated && !mapped) return
      try {
        writeJsonAtomic(registryCacheFile, { fetchedAt: registryCache.at, data: registryCache.data })
      } catch { /* 写盘失败仅影响下次启动的缓存 */ }
      logger?.info?.('[%s] GitHub 主题扫描：+%d 新插件，%d 星标刷新，%d 个 npm 映射（共 %d）', name, added, starsUpdated, mapped, registryCache.data.plugins.length)
    } finally {
      githubTopicScanRunning = false
    }
  }

  /** 常驻条目（data/extra-plugins.json，GitHub repo 形状）：无条件并入任何
   *  来源的清单（按 owner/name 去重），保证本插件等 0 星新条目始终可见。 */
  function applyBundledExtras(data: any): void {
    if (!data || !Array.isArray(data.plugins)) return
    const extras = readJson(join(pluginRoot, 'data', 'extra-plugins.json'))
    if (!Array.isArray(extras)) return
    mergeGithubTopic(data, extras as any[])
  }

  /** 缓存有效期内直接使用；过期自动拉网（含备源）；网络不可用回退缓存与内置快照。 */
  async function loadRegistry(force: boolean): Promise<{ ok: boolean; source: string; data: any }> {
    if (!force && registryCache) return { ok: true, source: registryCache.source, data: registryCache.data }
    const disk = readJson(registryCacheFile)
    const diskFetchedAt = typeof disk?.fetchedAt === 'number' ? disk.fetchedAt : 0
    const diskUsable = !!(disk?.data && validRegistry(disk.data))
    if (!force && diskUsable && Date.now() - diskFetchedAt < REGISTRY_TTL_MS) {
      applyBundledExtras(disk.data)
      registryCache = { at: diskFetchedAt, source: 'disk', data: disk.data }
      return { ok: true, source: 'disk', data: disk.data }
    }
    const network = await fetchRegistryFromNetwork()
    if (network) {
      applyBundledExtras(network.data)
      try {
        writeJsonAtomic(registryCacheFile, { fetchedAt: Date.now(), data: network.data })
      } catch { /* 磁盘缓存写失败不影响内存使用 */ }
      registryCache = { at: Date.now(), source: network.source, data: network.data }
      void enrichRegistryWithGithubTopics()
      return { ok: true, source: network.source, data: network.data }
    }
    if (diskUsable) {
      applyBundledExtras(disk.data)
      registryCache = { at: diskFetchedAt, source: 'disk', data: disk.data }
      return { ok: true, source: 'disk', data: disk.data }
    }
    const snapshot = readJson(join(pluginRoot, 'data', 'registry-snapshot.json'))
    if (validRegistry(snapshot)) {
      applyBundledExtras(snapshot)
      registryCache = { at: Date.now(), source: 'snapshot', data: snapshot }
      return { ok: true, source: 'snapshot', data: snapshot }
    }
    return { ok: false, source: 'none', data: null }
  }

  interface RegistryEntry {
    name: string
    owner?: string
    npm?: string | null
    [key: string]: unknown
  }

  /**
   * 解析安装来源（防抢注，参照 dsh-market）：
   * 优先 npm 包（秒级安装），但要求 npm 包的 repository 与清单的 GitHub
   * owner/repo 一致；不一致或查不到时回退 github:owner/repo。
   */
  async function resolveInstallSpec(entry: RegistryEntry): Promise<{ ok: true; spec: string; via: string } | { ok: false; error: string }> {
    const npmName = typeof entry.npm === 'string' && entry.npm.trim() ? entry.npm.trim() : ''
    const ownerRepo = entry.owner && entry.name ? `${entry.owner}/${entry.name}` : ''
    if (npmName && ownerRepo) {
      const proxy = await proxyPromise
      const networkEnv = proxy
        ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy }
        : undefined
      const r = await execAsync('npm', ['view', npmName, 'repository', '--json'], profileDir, 30_000, networkEnv)
      if (r.ok) {
        try {
          const repository = JSON.parse(r.out.trim())
          const repoUrl = String(typeof repository === 'string' ? repository : (repository?.url ?? '')).toLowerCase().replace(/\.git$/, '')
          const [owner, repo] = ownerRepo.toLowerCase().split('/')
          if (repoUrl.includes(`/${owner}/${repo}`)) {
            return { ok: true, spec: npmName, via: 'npm' }
          }
        } catch { /* 解析失败按不匹配处理 */ }
      }
      return { ok: true, spec: `github:${ownerRepo}`, via: 'github' }
    }
    if (npmName) return { ok: true, spec: npmName, via: 'npm' }
    if (ownerRepo) return { ok: true, spec: `github:${ownerRepo}`, via: 'github' }
    return { ok: false, error: '清单条目缺少 npm 包名与 GitHub 来源，无法安装' }
  }

  // ── 禁用/启用：走 profile cordis.patch.yml 的 id 定向 disabled 覆盖 ──
  const profilePatchFile = join(profileDir, 'cordis.patch.yml')
  const DISABLE_BLOCK_BEGIN = '# >>> update-center managed disables'
  const DISABLE_BLOCK_END = '# <<< update-center managed disables'
  const disablesStateFile = join(updateHome, 'disables.json')

  function readDisables(): Record<string, string[]> {
    const state = readJson(disablesStateFile) as Record<string, string[]> | null
    return state && typeof state === 'object' ? state : {}
  }

  function writeDisables(state: Record<string, string[]>): void {
    writeJsonAtomic(disablesStateFile, state)
  }

  /** 读取已安装 bundle 的 cordis.patch.yml，提取 insert 条目 id。 */
  function bundleInsertIds(depName: string): string[] {
    const dir = join(profileDir, 'node_modules', ...depName.split('/'))
    const pkg = readJson(join(dir, 'package.json'))
    if (!pkg) return []
    const patchRel = typeof (pkg.dsh as any)?.bundle?.patch === 'string' ? (pkg.dsh as any).bundle.patch : './cordis.patch.yml'
    try {
      const text = readFileSync(resolve(dir, patchRel), 'utf8')
      return [...text.matchAll(/^\s*-\s*id:\s*'?([^\s'"]+)'?/gm)].map((m) => m[1])
    } catch {
      return []
    }
  }

  /** 用禁用状态重写 profile patch 中的受管区块（带标记，原子写，先备份）。 */
  function renderDisableBlock(): string {
    const state = readDisables()
    const lines = [DISABLE_BLOCK_BEGIN]
    for (const [depName, ids] of Object.entries(state)) {
      for (const id of ids) {
        lines.push(`- id: ${id}`, '  disabled: true', `  # ${depName}`)
      }
    }
    lines.push(DISABLE_BLOCK_END)
    return lines.join('\n')
  }

  function syncDisableBlock(): void {
    let text = ''
    try {
      text = readFileSync(profilePatchFile, 'utf8')
    } catch { /* profile patch 不存在时按空文件处理 */ }
    const begin = text.indexOf(DISABLE_BLOCK_BEGIN)
    const end = text.indexOf(DISABLE_BLOCK_END)
    if (begin >= 0 && end > begin) {
      text = text.slice(0, begin) + text.slice(end + DISABLE_BLOCK_END.length)
    }
    text = `${text.replace(/\s*$/, '')}\n\n${renderDisableBlock()}\n`
    try {
      copyFileSync(profilePatchFile, `${profilePatchFile}.bak-update-center`)
    } catch { /* 首次写入时源文件不存在，无需备份 */ }
    writeFileSync(profilePatchFile, text, 'utf8')
  }

  function setDisabled(depName: string, disabled: boolean): { ok: boolean; result: string } {
    const state = readDisables()
    if (disabled) {
      const plugin = inventoryBasic().find((entry) => entry.name === depName)
      if (!plugin) return { ok: false, result: `未找到插件: ${depName}` }
      if (plugin.kind === 'preset') return { ok: false, result: 'preset 插件暂不支持禁用' }
      const ids = bundleInsertIds(depName)
      if (!ids.length) return { ok: false, result: `无法定位 ${depName} 的装载条目 id（可能不是 bundle 插件）` }
      state[depName] = ids
    } else {
      if (!(depName in state)) return { ok: false, result: `${depName} 未被禁用` }
      delete state[depName]
    }
    writeDisables(state)
    syncDisableBlock()
    return { ok: true, result: disabled ? `${depName} 已禁用，重启 dsh web 后生效` : `${depName} 已恢复启用，重启 dsh web 后生效` }
  }


  /** 检查更新（dsh fetch + link 插件 fetch + npm latest 查询，全部并行）。 */
  async function checkAll(): Promise<Record<string, unknown>> {
    const proxy = await proxyPromise
    const networkEnv = proxy
      ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy }
      : undefined
    const repo = await repoStatus()
    let fetchOk = true
    let fetchErr = ''
    let latestRemote = null
    if (repoDir) {
      const f = await execAsync('git', ['fetch', remote, branch], repoDir, 120_000, networkEnv)
      fetchOk = f.ok
      fetchErr = f.ok ? '' : f.err.trim().slice(0, 300)
      if (f.ok) {
        const [repo2, log] = await Promise.all([
          repoStatus(),
          execAsync('git', ['log', '--oneline', '-5', `${remote}/${branch}`], repoDir, 10_000),
        ])
        Object.assign(repo, repo2)
        latestRemote = log.ok ? log.out.trim().split('\n').filter(Boolean) : null
      }
    }
    const plugins = await pluginList()
    await Promise.all(plugins.map(async (p) => {
      const linkDir = typeof p.linkDir === 'string' ? p.linkDir : ''
      if ((p.kind === 'link' || p.kind === 'preset') && linkDir && existsSync(join(linkDir, '.git'))) {
        const git = await gitSnapshot(linkDir, { fetch: true, env: networkEnv })
        const upstreamMatch = typeof git.remoteUrl === 'string' ? UPSTREAM_RE.exec(git.remoteUrl.trim()) : null
        if (upstreamMatch) p.upstream = `${upstreamMatch[1]}/${upstreamMatch[2]}`
        // 展示名去掉远端前缀（origin/main → main）
        if (typeof git.branch === 'string' && git.branch.includes('/')) {
          git.branch = git.branch.slice(git.branch.indexOf('/') + 1)
        }
        p.git = git
      } else if (p.kind === 'npm') {
        p.latest = await npmLatest(String(p.name), networkEnv)
      }
    }))
    const repoGit = (repo.git ?? {}) as Record<string, unknown>
    const repoUpdates = typeof repoGit.behind === 'number' ? repoGit.behind : 0
    const pluginUpdates = plugins.filter((plugin) => {
      const git = (plugin.git ?? {}) as Record<string, unknown>
      return (typeof git.behind === 'number' && git.behind > 0)
        || (plugin.kind === 'npm' && plugin.latest && plugin.latest !== plugin.version)
    }).length
    const failedChecks = (fetchOk ? 0 : 1) + plugins.filter((plugin) => {
      const git = (plugin.git ?? {}) as Record<string, unknown>
      return (plugin.kind === 'npm' && plugin.latest === null)
        || ((plugin.kind === 'link' || plugin.kind === 'preset') && git.fetchOk === false)
    }).length
    return {
      repo: { ...repo, fetchOk, fetchErr },
      plugins,
      summary: { repoUpdates, pluginUpdates, totalUpdates: (repoUpdates > 0 ? 1 : 0) + pluginUpdates, failedChecks },
      ts: Date.now(),
    }
  }

  /** /status 快照（repo + plugins），带 TTL 缓存。 */
  async function statusData(fresh: boolean): Promise<{ repo: Record<string, unknown>; plugins: Array<Record<string, unknown>> }> {
    if (!fresh && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache
    const [repo, plugins] = await Promise.all([repoStatus(), pluginList()])
    statusCache = { at: Date.now(), repo, plugins }
    return statusCache
  }

  // ── host API（settings.section 面板后端）──
  async function readBody(req: any): Promise<string> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const c of req) {
      const chunk = Buffer.from(c)
      total += chunk.length
      if (total > 16_384) throw new Error('request body too large')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  /** POST 动作仅接受同源请求（Origin 缺失视为非浏览器客户端，放行）。 */
  function sameOrigin(req: any): boolean {
    const origin = req?.headers?.origin
    if (!origin) return true
    try {
      const parsed = new URL(String(origin))
      return typeof req.headers.host === 'string' && parsed.host === req.headers.host
    } catch {
      return false
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/update-center/api',
    handler: async (req: any, res: any) => {
      const send = (code: number, obj: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname.replace(/^\/update-center\/api/, '') || '/'
        if (req.method === 'GET' && path === '/status') {
          const fresh = url.searchParams.get('fresh') === '1'
          const snapshot = await statusData(fresh)
          return send(200, { ok: true, ...snapshot, job: latestJob(), ts: Date.now() })
        }
        if (req.method === 'GET' && path === '/job') {
          const id = url.searchParams.get('id')?.trim() ?? ''
          const job = id ? jobById(id) : latestJob()
          return send(job ? 200 : 404, job ? { ok: true, job } : { ok: false, error: 'job not found' })
        }
        if (req.method === 'GET' && path === '/market') {
          const registry = await loadRegistry(false)
          if (!registry.ok) return send(200, { ok: false, error: '插件清单不可用：网络失败且没有本地快照。' })
          const installed = inventoryBasic().map((entry) => String(entry.name))
          return send(200, {
            ok: true,
            source: registry.source,
            updated: registry.data.updated ?? '',
            count: registry.data.plugins.length,
            categories: registry.data.categories ?? {},
            plugins: registry.data.plugins,
            installed,
          })
        }
        if (req.method !== 'POST' || !sameOrigin(req)) {
          return send(403, { ok: false, error: 'forbidden' })
        }
        if (path === '/market/refresh') {
          const registry = await loadRegistry(true)
          if (!registry.ok) return send(200, { ok: false, error: '插件清单拉取失败：网络不可用且没有本地快照。' })
          const installed = inventoryBasic().map((entry) => String(entry.name))
          return send(200, {
            ok: true,
            source: registry.source,
            updated: registry.data.updated ?? '',
            count: registry.data.plugins.length,
            categories: registry.data.categories ?? {},
            plugins: registry.data.plugins,
            installed,
          })
        }
        if (path === '/install') {
          const body = JSON.parse(await readBody(req))
          const name = String(body?.name ?? '').trim()
          const registry = await loadRegistry(false)
          const entries = Array.isArray(registry.data?.plugins) ? registry.data.plugins as RegistryEntry[] : []
          const entry = entries.find((p) => p.name === name)
          if (!entry) return send(200, { ok: false, result: `插件市场中没有这个条目: ${name}` })
          const installedNow = inventoryBasic().some((e) =>
            e.name === entry.name || (typeof entry.npm === 'string' && !!entry.npm && e.name === entry.npm))
          if (installedNow) return send(200, { ok: false, result: `${name} 已经安装过了。` })
          const resolved = await resolveInstallSpec(entry)
          if (!resolved.ok) return send(200, { ok: false, result: resolved.error })
          return send(200, await startJob({
            action: 'install',
            target: entry.name,
            installSpec: resolved.spec,
            via: resolved.via,
            profileDir,
          }))
        }
        if (path === '/uninstall') {
          const body = JSON.parse(await readBody(req))
          const packageName = String(body?.name ?? '').trim()
          const plugin = inventoryBasic().find((entry) => entry.kind === 'npm' && entry.name === packageName)
          if (!plugin) {
            return send(200, { ok: false, result: `未找到可卸载的 npm 插件: ${packageName}。link/preset 插件请直接编辑 profile 依赖。` })
          }
          return send(200, await startJob({
            action: 'remove',
            target: packageName,
            packageName,
            profileDir,
          }))
        }
        if (path === '/disable' || path === '/enable') {
          const body = JSON.parse(await readBody(req))
          const result = setDisabled(String(body?.name ?? '').trim(), path === '/disable')
          return send(200, result)
        }
        if (path === '/check') {
          return send(200, { ok: true, ...(await checkAll()) })
        }
        if (path === '/update-all') {
          // 基于实时检查结果构建批量任务；dsh 本体更新有独立的构建语义，不并入批量。
          const check = await checkAll()
          const checkPlugins = Array.isArray(check.plugins) ? check.plugins as Array<Record<string, unknown>> : []
          const jobs: Array<Record<string, unknown>> = []
          for (const p of checkPlugins) {
            const git = (p.git ?? {}) as Record<string, unknown>
            if (p.kind === 'npm' && p.latest && p.latest !== p.version) {
              jobs.push({
                action: 'npm',
                target: p.name,
                packageName: p.name,
                expectedVersion: p.latest,
                profileDir,
              })
            } else if ((p.kind === 'link' || p.kind === 'preset')
              && typeof git.behind === 'number' && git.behind > 0
              && git.dirty !== true
              && typeof p.linkDir === 'string') {
              jobs.push({
                action: 'link',
                target: p.name,
                packageName: p.name,
                kind: p.kind,
                dir: p.linkDir,
                profileDir,
              })
            }
          }
          if (!jobs.length) {
            return send(200, { ok: false, result: '当前没有可更新的插件（有未提交改动的本地插件已跳过；dsh 本体请在上方单独更新）。' })
          }
          return send(200, await startJob({
            action: 'batch',
            target: `${jobs.length} 个插件`,
            jobs,
            profileDir,
          }))
        }
        if (path === '/update-dsh') {
          const body = JSON.parse(await readBody(req))
          return send(200, await startJob({
            action: 'dsh',
            target: 'dsh',
            full: body?.full === true,
            remote,
            branch,
          }))
        }
        if (path === '/update-npm') {
          const body = JSON.parse(await readBody(req))
          const packageName = String(body?.name ?? '').trim()
          const plugin = inventoryBasic().find((entry) => entry.kind === 'npm' && entry.name === packageName)
          if (!plugin) return send(200, { ok: false, result: `未找到可更新的 npm 插件: ${packageName}` })
          const proxy = await proxyPromise
          const networkEnv = proxy
            ? { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy }
            : undefined
          const expectedVersion = await npmLatest(packageName, networkEnv)
          if (!expectedVersion) return send(200, { ok: false, result: `无法获取 ${packageName} 的最新版本` })
          return send(200, await startJob({
            action: 'npm',
            target: packageName,
            packageName,
            expectedVersion,
            profileDir,
          }))
        }
        if (path === '/update-link') {
          const body = JSON.parse(await readBody(req))
          const packageName = String(body?.name ?? '').trim()
          const plugin = inventoryBasic().find((entry) =>
            (entry.kind === 'link' || entry.kind === 'preset') && entry.name === packageName)
          if (!plugin || typeof plugin.linkDir !== 'string') {
            return send(200, { ok: false, result: `未找到可更新的本地插件: ${packageName}` })
          }
          return send(200, await startJob({
            action: 'link',
            target: packageName,
            packageName,
            kind: plugin.kind,
            dir: plugin.linkDir,
          }))
        }
        return send(404, { ok: false, error: 'not found: ' + path })
      } catch (e) {
        return send(500, { ok: false, error: String(e instanceof Error ? e.message : e) })
      }
    },
  }), '@dsh-external/dsh-update-center: api')

  // ── 工具：给 agent 的只读状态查询 ──
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'update_center_status',
    description: '更新中心：查看 dsh 版本与更新状态、已安装插件清单（npm/link 分类）。要执行更新请使用 GUI 设置页的更新中心面板。',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute() {
      const [repo, plugins] = await Promise.all([repoStatus(), pluginList()])
      return JSON.stringify({ repo, plugins }, null, 2)
    },
  })), '@dsh-external/dsh-update-center: status tool')

  // ── 市场清单后台自动刷新（12 小时一次；失败静默，保留现有缓存）──
  ctx.effect(() => {
    const timer = setInterval(() => {
      void fetchRegistryFromNetwork().then((fetched) => {
        if (!fetched) return
        try {
          writeJsonAtomic(registryCacheFile, { fetchedAt: Date.now(), data: fetched.data })
        } catch { /* 写盘失败仅影响下次启动的缓存 */ }
        registryCache = { at: Date.now(), source: fetched.source, data: fetched.data }
        logger?.info?.('[%s] 市场清单已自动刷新（source=%s, count=%s）', name, fetched.source, fetched.data?.count ?? '?')
        void enrichRegistryWithGithubTopics()
      })
    }, REGISTRY_REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, '@dsh-external/dsh-update-center: registry auto refresh')

  logger?.info?.('[%s] 更新中心启动（repo=%s profile=%s）', name, repoDir || '(未找到)', profileDir)
}
