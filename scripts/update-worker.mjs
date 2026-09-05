import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function verifyNpmUpdate({ before, expected, installed }) {
  if (!installed || installed !== expected) {
    return {
      ok: false,
      changed: installed !== before,
      message: `安装版本核验失败：更新前 ${before || '未知'}，期望 ${expected || '未知'}，实际 ${installed || '未安装'}`,
    }
  }
  return {
    ok: true,
    changed: installed !== before,
    message: `已安装 ${installed}`,
  }
}

export function analyzeGitArtifacts(changedPaths) {
  const normalized = changedPaths.map((file) => String(file).replaceAll('\\', '/'))
  const sourceChanged = normalized.some((file) => file.startsWith('src/'))
  const artifactsChanged = normalized.some((file) => file.startsWith('lib/') || file.startsWith('dist/'))
  return {
    sourceChanged,
    artifactsChanged,
    buildRequired: sourceChanged && !artifactsChanged,
  }
}

export function writeJobState(statePath, latestPath, state) {
  const payload = JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + '\n'
  for (const file of [statePath, latestPath]) {
    mkdirSync(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, payload, 'utf8')
    renameSync(temporary, file)
  }
}

function readPackageVersion(baseDir, packageName) {
  try {
    const packageFile = join(baseDir, 'node_modules', ...packageName.split('/'), 'package.json')
    const parsed = JSON.parse(readFileSync(packageFile, 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

function commandFailure(result) {
  return (result.err?.trim() || result.out?.trim() || `进程退出码 ${String(result.code)}`).slice(0, 1200)
}

export function runCommand(command, args, cwd, timeoutMs = 600_000, extraEnv) {
  const isWindows = process.platform === 'win32'
  const candidates = isWindows && !/\.(exe|cmd|bat)$/i.test(command)
    ? [command, `${command}.cmd`]
    : [command]
  for (const candidate of candidates) {
    const isBatch = isWindows && candidate.endsWith('.cmd')
    const executable = isBatch ? 'cmd.exe' : candidate
    // .cmd 经 cmd.exe /d /s /c + 参数数组执行，与 src/run-command.mjs 的
    // runCommandAsync 保持同一 argv 契约：转义交给 Node 的 argv 引用，不做
    // 字符串拼接。cmd.exe 对元字符的二次解析不受引号保护（/s 剥掉外层引号
    // 后逐段解析，^ 会被吞、& 会拆命令），因此 .cmd 路径显式拒绝含元字符的
    // 参数——宁可任务失败，也不静默错解析。
    const commandArgs = isBatch ? ['/d', '/s', '/c', candidate, ...args] : args
    if (isBatch) {
      const unsafe = commandArgs.map(String).find((arg) => /[&|<>^()%"\r\n\0]/.test(arg))
      if (unsafe !== undefined) {
        return { ok: false, code: null, out: '', err: `.cmd 参数包含 cmd 元字符，已拒绝执行: ${unsafe.slice(0, 100)}` }
      }
    }
    const result = spawnSync(executable, commandArgs, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    })
    const code = result.error?.code
    if (result.error && (code === 'ENOENT' || code === 'EINVAL')) continue
    return {
      ok: result.status === 0 && !result.error,
      code: result.status,
      out: String(result.stdout ?? ''),
      err: [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n'),
    }
  }
  return { ok: false, code: null, out: '', err: `command not found: ${command}` }
}

class JobError extends Error {
  constructor(stage, message) {
    super(message)
    this.stage = stage
  }
}

function updateState(spec, state, patch) {
  Object.assign(state, patch)
  writeJobState(spec.statePath, spec.latestPath, state)
}

/** 单任务模式：步骤与进度直接写入本 job 的状态。 */
function singleReporter(spec, state) {
  return {
    step: (text) => { state.steps.push(text) },
    progress: (patch) => updateState(spec, state, patch),
    finish: (patch) => updateState(spec, state, patch),
  }
}

/** 查询 npm registry 某包当前 latest（更新竞态宽限用；失败返回 null）。 */
export function queryNpmLatest(spec, runner, networkEnv) {
  const r = runner('npm', ['view', spec.packageName, 'version', '--json'], spec.profileDir, 30_000, networkEnv)
  if (!r.ok) return null
  try {
    const v = JSON.parse(String(r.out).trim())
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/** 把包回滚到更新前版本：已恢复原样返回 null（无需或已回滚），失败返回原因。
 *  目标是"更新失败 = 保持更新前状态"，不把半更新态留给用户。 */
function rollbackNpmUpdate(spec, runner, reporter, beforeVersion, networkEnv) {
  if (!beforeVersion) return '更新前版本未知，无法自动回滚，请检查当前安装状态'
  const current = readPackageVersion(spec.profileDir, spec.packageName)
  if (!current || current === beforeVersion) return null
  reporter.progress({ stage: 'rollback', message: `正在回滚 ${spec.packageName} 到 ${beforeVersion}` })
  const rb = runner('pnpm', ['add', `${spec.packageName}@${beforeVersion}`], spec.profileDir, 600_000, networkEnv)
  const restored = readPackageVersion(spec.profileDir, spec.packageName)
  if (rb.ok && restored === beforeVersion) {
    reporter.step(`已回滚到 ${beforeVersion}，保持更新前状态`)
    return null
  }
  return `自动回滚失败（当前 ${restored || '未安装'}，期望 ${beforeVersion}）：${commandFailure(rb)}`
}

/** 更新失败时先尝试回滚再抛错：回滚失败的原因并入任务错误，便于用户接手。 */
function throwAfterRollback(stage, baseMessage, spec, runner, reporter, beforeVersion, networkEnv) {
  const rollbackError = rollbackNpmUpdate(spec, runner, reporter, beforeVersion, networkEnv)
  throw new JobError(stage, rollbackError ? `${baseMessage}\n${rollbackError}` : baseMessage)
}

async function performNpmUpdate(spec, runner, reporter) {
  const beforeVersion = readPackageVersion(spec.profileDir, spec.packageName)
  reporter.progress({
    stage: 'update',
    beforeVersion,
    message: `正在更新 ${spec.packageName}`,
  })
  const networkEnv = spec.proxy
    ? { HTTP_PROXY: spec.proxy, HTTPS_PROXY: spec.proxy, http_proxy: spec.proxy, https_proxy: spec.proxy }
    : undefined
  const result = runner('pnpm', ['update', spec.packageName, '--latest'], spec.profileDir, 600_000, networkEnv)
  if (!result.ok) {
    throwAfterRollback('update', `pnpm update 失败\n${commandFailure(result)}`, spec, runner, reporter, beforeVersion, networkEnv)
  }
  reporter.step('pnpm update 执行完成')
  reporter.progress({ stage: 'verify', message: '正在核对实际安装版本' })
  const installed = readPackageVersion(spec.profileDir, spec.packageName)
  const verification = verifyNpmUpdate({
    before: beforeVersion,
    expected: spec.expectedVersion,
    installed,
  })
  let effectiveVersion = installed
  if (!verification.ok) {
    // 竞态宽限：检查更新与执行之间上游可能又发了新版，pnpm --latest 会装上
    // 比任务期望更新的一版。装上的若就是此刻的 npm latest，按实际版本放行；
    // 否则才视为失败并回滚。
    const freshLatest = queryNpmLatest(spec, runner, networkEnv)
    if (installed && freshLatest && installed === freshLatest) {
      reporter.step(`更新期间上游发布了 ${freshLatest}，已按实际安装版本通过校验`)
      effectiveVersion = freshLatest
    } else {
      throwAfterRollback('verify', verification.message, spec, runner, reporter, beforeVersion, networkEnv)
    }
  }
  reporter.step(effectiveVersion === installed && verification.ok ? verification.message : `已安装 ${effectiveVersion}`)
  reporter.progress({ stage: 'reconcile', message: '正在同步 profile bundles' })
  const profileManifest = readPackage(spec.profileDir)
  const declares = bundleDeclared(spec.profileDir, spec.packageName)
  const reconciliation = reconcileBundles(profileManifest, spec.packageName, declares)
  if (reconciliation.changed) {
    profileManifest.dsh = {
      ...profileManifest.dsh,
      profile: { ...profileManifest.dsh?.profile, bundles: reconciliation.bundles },
    }
    writeProfileManifestAtomic(spec.profileDir, profileManifest)
    reporter.step(`bundles 已同步：${declares ? '已加入' : '已移出'} ${spec.packageName}`)
  } else {
    reporter.step('bundles 无需变更')
  }
  reporter.finish({
    status: 'completed',
    stage: 'completed',
    message: `${spec.packageName} 更新完成`,
    afterVersion: effectiveVersion,
    changed: verification.changed,
    restartRequired: true,
    finishedAt: new Date().toISOString(),
  })
}

async function runNpmJob(spec, state, runner) {
  await performNpmUpdate(spec, runner, singleReporter(spec, state))
}

function readPackage(baseDir) {
  try {
    return JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 安装在 profile 里的包是否声明了 dsh.bundle（与官方 `dsh plugin` 的判定一致：
 * dsh.bundle.patch 存在即为 bundle 层）。
 */
export function bundleDeclared(profileDir, packageName) {
  const pkg = readPackage(join(profileDir, 'node_modules', ...packageName.split('/')))
  return pkg?.dsh?.bundle?.patch !== undefined
}

/**
 * 按官方 `dsh plugin` 的对账规则同步 dsh.profile.bundles：
 * 依赖解析到声明 dsh.bundle 的包 → 加入层列表（按依赖顺序追加）；
 * 依赖不再声明 → 移出层列表。模板 bundle（非依赖）永不触碰。
 */
export function reconcileBundles(manifest, packageName, declaresBundle) {
  const isDependency = packageName in (manifest?.dependencies ?? {})
  const bundles = [...((manifest?.dsh?.profile?.bundles) ?? [])]
  if (!isDependency) return { changed: false, bundles }
  const listed = bundles.includes(packageName)
  if (declaresBundle && !listed) {
    bundles.push(packageName)
    return { changed: true, bundles }
  }
  if (!declaresBundle && listed) {
    bundles.splice(bundles.indexOf(packageName), 1)
    return { changed: true, bundles }
  }
  return { changed: false, bundles }
}

function writeProfileManifestAtomic(profileDir, manifest) {
  const file = join(profileDir, 'package.json')
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  renameSync(temporary, file)
}

/** 卸载路径的 bundles 对账：在层列表中直接移除（调用方已校验它曾是 profile 依赖）。 */
export function removeFromBundles(manifest, packageName) {
  const bundles = [...((manifest?.dsh?.profile?.bundles) ?? [])]
  const index = bundles.indexOf(packageName)
  if (index < 0) return { changed: false, bundles }
  bundles.splice(index, 1)
  return { changed: true, bundles }
}

/** 从 pnpm 输出中提取被跳过构建脚本的包名（去掉版本后缀与列表符号）。 */
export function parseIgnoredBuilds(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes('Ignored build scripts'))
  if (index < 0) return []
  const names = []
  for (const line of lines.slice(index + 1)) {
    if (!line.trim()) break
    const match = /^\s*[-*]\s*(.+?)\s*$/.exec(line)
    if (!match) break
    names.push(match[1].replace(/@[^@\s]+$/, '').replace(/[,;]+$/, ''))
  }
  return [...new Set(names)]
}

/** 识别 pnpm≥10 显式拒绝执行构建脚本的报错，返回包名（放行 allowBuilds 后重试可解决）。 */
export function parseBuildsRefused(text) {
  const match = /"([^"]+)@[^"]*"\s+(?:needs to execute|wants to run) build scripts/.exec(String(text ?? ''))
  return match ? match[1] : null
}

/**
 * 安装后的防假成功校验：包可解析、且（声明 dsh 清单 或 main 入口文件存在）。
 * prepare 构建被 pnpm 跳过时产物缺失，会被这里拦下并触发回滚。
 */
export function installedPackageValid(profileDir, packageName) {
  const dir = join(profileDir, 'node_modules', ...packageName.split('/'))
  const pkg = readPackage(dir)
  if (!pkg?.name) return false
  if (pkg.dsh !== undefined) return true
  if (typeof pkg.main === 'string') return existsSync(resolve(dir, pkg.main))
  return true
}

function buildScriptHint(result) {
  const refused = parseBuildsRefused(`${result.out}\n${result.err}`)
  if (refused) {
    return `\n提示：pnpm 拒绝执行 ${refused} 的构建脚本。在 profile 的 pnpm-workspace.yaml 中按 pnpm 输出的确切键名放行（allowBuilds/onlyBuiltDependencies）后重试。`
  }
  const ignored = parseIgnoredBuilds(`${result.out}\n${result.err}`)
  if (ignored.length) {
    return `\n提示：以下包的构建脚本被 pnpm 跳过，缺少构建产物时插件可能无法加载：${ignored.join(', ')}。在 profile 的 pnpm-workspace.yaml 放行后重新安装。`
  }
  return ''
}

function applyBundleReconciliations(profileDir, names) {
  const manifest = readPackage(profileDir)
  if (!manifest) return []
  const changed = []
  let bundles = manifest.dsh?.profile?.bundles ? [...manifest.dsh.profile.bundles] : []
  for (const name of names) {
    if (bundleDeclared(profileDir, name)) {
      if (!bundles.includes(name)) {
        bundles.push(name)
        changed.push(name)
      }
    }
  }
  if (changed.length) {
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    writeProfileManifestAtomic(profileDir, manifest)
  }
  return changed
}

async function runInstallJob(spec, state, runner) {
  const networkEnv = spec.proxy
    ? { HTTP_PROXY: spec.proxy, HTTPS_PROXY: spec.proxy, http_proxy: spec.proxy, https_proxy: spec.proxy }
    : undefined
  const before = readPackage(spec.profileDir)
  const beforeDeps = new Set(Object.keys(before?.dependencies ?? {}))
  updateState(spec, state, { stage: 'install', message: `正在安装 ${spec.target || spec.installSpec}` })
  const result = runner('pnpm', ['add', spec.installSpec], spec.profileDir, 600_000, networkEnv)
  if (!result.ok) {
    throw new JobError('install', `pnpm add 失败\n${commandFailure(result)}${buildScriptHint(result)}`)
  }
  const hint = buildScriptHint(result)
  if (hint) state.steps.push(`pnpm 提示（构建脚本）：${hint.trim()}`)
  const after = readPackage(spec.profileDir)
  const added = Object.keys(after?.dependencies ?? {}).filter((name) => !beforeDeps.has(name))
  if (!added.length) {
    throw new JobError('verify', 'pnpm add 成功但依赖没有任何变化（可能已安装，或版本被 minimumReleaseAge 限制）。')
  }
  state.steps.push(`已安装依赖：${added.join(', ')}`)

  const broken = added.filter((name) => !installedPackageValid(spec.profileDir, name))
  if (broken.length) {
    updateState(spec, state, { stage: 'rollback', message: '安装校验失败，正在回滚' })
    for (const name of broken) {
      runner('pnpm', ['remove', name], spec.profileDir, 300_000, networkEnv)
    }
    throw new JobError('verify', `以下包安装后缺少可运行入口（可能是构建脚本被跳过），已自动回滚：${broken.join(', ')}${hint || buildScriptHint(result)}`)
  }

  updateState(spec, state, { stage: 'reconcile', message: '正在同步 profile bundles' })
  const activated = applyBundleReconciliations(spec.profileDir, added)
  if (activated.length) state.steps.push(`已加入 bundles 层：${activated.join(', ')}`)
  else state.steps.push('新包未声明 dsh.bundle，按普通依赖安装')

  updateState(spec, state, {
    status: 'completed',
    stage: 'completed',
    message: `${spec.target || added.join(', ')} 安装完成，重启 dsh web 后生效`,
    installed: added,
    restartRequired: true,
    finishedAt: new Date().toISOString(),
  })
}

async function runRemoveJob(spec, state, runner) {
  const before = readPackage(spec.profileDir)
  if (!(spec.packageName in (before?.dependencies ?? {}))) {
    throw new JobError('preflight', `${spec.packageName} 不在 profile 依赖中，无法卸载。`)
  }
  updateState(spec, state, { stage: 'remove', message: `正在卸载 ${spec.packageName}` })
  const result = runner('pnpm', ['remove', spec.packageName], spec.profileDir, 300_000)
  if (!result.ok) {
    throw new JobError('remove', `pnpm remove 失败\n${commandFailure(result)}`)
  }
  state.steps.push('pnpm remove 完成')
  const manifest = readPackage(spec.profileDir)
  const reconciliation = removeFromBundles(manifest, spec.packageName)
  if (reconciliation.changed) {
    manifest.dsh = {
      ...manifest.dsh,
      profile: { ...manifest.dsh?.profile, bundles: reconciliation.bundles },
    }
    writeProfileManifestAtomic(spec.profileDir, manifest)
    state.steps.push(`已从 bundles 层移除：${spec.packageName}`)
  }
  updateState(spec, state, {
    status: 'completed',
    stage: 'completed',
    message: `${spec.packageName} 卸载完成，重启 dsh web 后生效`,
    restartRequired: true,
    finishedAt: new Date().toISOString(),
  })
}

function requireCommand(result, stage, label) {
  if (!result.ok) throw new JobError(stage, `${label}失败\n${commandFailure(result)}`)
  return result.out.trim()
}

function packageManagerFor(dir, packageJson) {
  if (typeof packageJson?.packageManager === 'string' && packageJson.packageManager.startsWith('pnpm@')) return 'pnpm'
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  return 'npm'
}

async function performLinkUpdate(spec, runner, reporter) {
  const dir = spec.dir
  const networkEnv = spec.proxy
    ? { HTTP_PROXY: spec.proxy, HTTPS_PROXY: spec.proxy, http_proxy: spec.proxy, https_proxy: spec.proxy }
    : undefined
  const status = requireCommand(runner('git', ['status', '--porcelain'], dir, 10_000), 'preflight', '读取 Git 状态')
  if (status) throw new JobError('preflight', `检测到未提交改动，为避免覆盖本地工作，已停止更新：\n${status}`)
  const before = requireCommand(runner('git', ['rev-parse', 'HEAD'], dir, 10_000), 'preflight', '读取当前提交')
  reporter.progress({ stage: 'fetch', beforeCommit: before, message: `正在获取 ${spec.packageName} 的远端更新` })
  requireCommand(runner('git', ['fetch', '--all', '--prune'], dir, 120_000, networkEnv), 'fetch', 'git fetch ')

  const branch = requireCommand(runner('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir, 10_000), 'preflight', '读取当前分支')
  if (branch === 'HEAD') {
    const defaultRef = requireCommand(
      runner('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], dir, 10_000),
      'preflight',
      '确认远端默认分支',
    )
    const shortName = defaultRef.includes('/') ? defaultRef.slice(defaultRef.indexOf('/') + 1) : defaultRef
    requireCommand(runner('git', ['checkout', '-B', shortName, defaultRef], dir, 60_000), 'checkout', '切换默认分支')
  }

  reporter.progress({ stage: 'pull', message: `正在拉取 ${spec.packageName}` })
  requireCommand(runner('git', ['pull', '--ff-only'], dir, 300_000, networkEnv), 'pull', 'git pull ')
  const after = requireCommand(runner('git', ['rev-parse', 'HEAD'], dir, 10_000), 'verify', '读取更新后提交')
  const changed = before !== after
  const changedOutput = changed
    ? requireCommand(runner('git', ['diff', '--name-only', `${before}..${after}`], dir, 10_000), 'verify', '读取变更文件')
    : ''
  const changedPaths = changedOutput.split('\n').map((file) => file.trim()).filter(Boolean)
  const artifacts = analyzeGitArtifacts(changedPaths)
  reporter.step(changed ? `Git 已更新：${before.slice(0, 10)} → ${after.slice(0, 10)}` : 'Git 已是最新')

  if (artifacts.buildRequired) {
    const packageJson = readPackage(dir)
    if (typeof packageJson?.scripts?.build !== 'string') {
      throw new JobError('build', '源码已更新，但上游没有提交 lib/dist 产物，也没有提供 build 脚本。')
    }
    const manager = packageManagerFor(dir, packageJson)
    reporter.progress({ stage: 'build', message: `正在重新构建 ${spec.packageName}` })
    const buildEnv = { ...networkEnv, DSH_CHECKOUT: spec.repoDir ?? process.env.DSH_CHECKOUT ?? '' }
    requireCommand(runner(manager, ['run', 'build'], dir, 900_000, buildEnv), 'build', `${manager} run build `)
    reporter.step(`${manager} run build 完成`)
  }

  if (spec.kind === 'preset') {
    const presetSource = join(dir, 'preset')
    if (existsSync(presetSource)) {
      for (const file of ['agent.cordis.yml', 'preset.yml', 'router-bootstrap.mjs', 'router-core.mjs']) {
        const source = join(presetSource, file)
        if (existsSync(source)) copyFileSync(source, join(dir, file))
      }
      reporter.step('preset 运行副本已同步')
    }
  }

  const packageJson = readPackage(dir)
  if (typeof packageJson?.main === 'string' && !existsSync(join(dir, packageJson.main))) {
    throw new JobError('verify', `运行入口不存在：${packageJson.main}`)
  }
  reporter.finish({
    status: 'completed',
    stage: 'completed',
    message: changed ? `${spec.packageName} 更新完成` : `${spec.packageName} 已是最新`,
    afterCommit: after,
    changed,
    changedPaths,
    restartRequired: changed,
    finishedAt: new Date().toISOString(),
  })
}

async function runLinkJob(spec, state, runner) {
  await performLinkUpdate(spec, runner, singleReporter(spec, state))
}

/** 批量更新：串行执行子任务，单个失败不中断其余，最后汇总成败。 */
async function runBatchJob(spec, state, runner) {
  const jobs = Array.isArray(spec.jobs) ? spec.jobs : []
  if (!jobs.length) throw new JobError('preflight', '批量任务为空')
  const results = []
  let succeeded = 0
  let restartRequired = false
  for (let i = 0; i < jobs.length; i += 1) {
    const sub = jobs[i]
    const label = String(sub.target ?? sub.packageName ?? `#${i + 1}`)
    const reporter = {
      step: (text) => { state.steps.push(`[${label}] ${text}`) },
      progress: (patch) => updateState(spec, state, {
        stage: 'batch',
        message: `(${i + 1}/${jobs.length}) ${String(patch.message ?? label)}`,
      }),
      finish: (patch) => {
        if (patch.restartRequired) restartRequired = true
        state.steps.push(`[${label}] ${String(patch.message ?? '完成')}`)
      },
    }
    try {
      const subSpec = { ...spec, ...sub }
      if (sub.action === 'npm') await performNpmUpdate(subSpec, runner, reporter)
      else if (sub.action === 'link') await performLinkUpdate(subSpec, runner, reporter)
      else throw new JobError('batch', `unsupported sub action: ${String(sub.action)}`)
      succeeded += 1
      results.push({ target: label, ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ target: label, ok: false, error: message })
      state.steps.push(`[${label}] 失败：${message}`)
    }
  }
  const failed = results.filter((entry) => !entry.ok)
  updateState(spec, state, {
    status: succeeded === 0 ? 'failed' : 'completed',
    stage: 'batch-done',
    message: failed.length
      ? `批量更新：${succeeded} 成功 / ${failed.length} 失败`
      : `批量更新完成：${succeeded} 项`,
    error: failed.length ? failed.map((entry) => `${entry.target}: ${entry.error}`).join('\n') : undefined,
    results,
    restartRequired: restartRequired && succeeded > 0,
    finishedAt: new Date().toISOString(),
  })
}

/** tsdown/pnpm workspace glob 覆盖的包目录（packages/<scope>/<name>、vendor/<name>、apps/cli）。 */
export function enumerateWorkspaceDirs(repoDir) {
  const out = []
  const packagesDir = join(repoDir, 'packages')
  try {
    for (const scope of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!scope.isDirectory()) continue
      const scopeDir = join(packagesDir, scope.name)
      for (const pkg of readdirSync(scopeDir, { withFileTypes: true })) {
        if (pkg.isDirectory()) out.push(join(scopeDir, pkg.name))
      }
    }
  } catch { /* 无 packages 目录则跳过 */ }
  try {
    for (const dirent of readdirSync(join(repoDir, 'vendor'), { withFileTypes: true })) {
      if (dirent.isDirectory()) out.push(join(repoDir, 'vendor', dirent.name))
    }
  } catch { /* 无 vendor 目录则跳过 */ }
  out.push(join(repoDir, 'apps', 'cli'))
  return out
}

/** 空壳目录里允许存在的构建产物名；出现其余内容即视为可能含本地工作，跳过不删。 */
const RESIDUAL_ENTRY_WHITELIST = new Set(['lib', 'dist', 'node_modules', '.turbo'])

/**
 * 找出上游删包残留的空壳目录：git pull 不会清除 gitignore 的 lib/node_modules，
 * 会被 workspace glob 卷进构建图（曾致 tsdown [MISSING_EXPORT] 构建失败）。
 * 只报告同时满足三个条件的目录：无 package.json、git 不跟踪其中任何文件、
 * 目录内容全部是白名单内的构建产物。git 查询失败时宁可保守（不报告）。
 */
export function findStaleResidualDirs(repoDir, runner) {
  const stale = []
  for (const dir of enumerateWorkspaceDirs(repoDir)) {
    if (existsSync(join(dir, 'package.json'))) continue
    const rel = relative(repoDir, dir).replaceAll('\\', '/')
    const tracked = runner('git', ['ls-files', '--', rel], repoDir, 10_000)
    if (!tracked.ok || tracked.out.trim()) continue
    try {
      const entries = readdirSync(dir)
      if (!entries.length || !entries.every((entry) => RESIDUAL_ENTRY_WHITELIST.has(entry))) continue
      stale.push(dir)
    } catch { /* 目录不可读则跳过 */ }
  }
  return stale
}

function cleanupStaleResidualDirs(repoDir, state, runner) {
  let staleDirs
  try {
    staleDirs = findStaleResidualDirs(repoDir, runner)
  } catch (error) {
    state.steps.push(`残留目录扫描失败（不影响本次更新）：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  for (const dir of staleDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
      state.steps.push(`已清理上游删包残留目录：${relative(repoDir, dir).replaceAll('\\', '/')}`)
    } catch { /* 删除失败不阻断更新；build 会以原始错误暴露问题 */ }
  }
}

async function runDshJob(spec, state, runner) {
  const dir = spec.repoDir
  const networkEnv = spec.proxy
    ? { HTTP_PROXY: spec.proxy, HTTPS_PROXY: spec.proxy, http_proxy: spec.proxy, https_proxy: spec.proxy }
    : undefined
  const status = requireCommand(runner('git', ['status', '--porcelain'], dir, 10_000), 'preflight', '读取 dsh Git 状态')
  if (status) throw new JobError('preflight', `dsh 存在未提交改动，为避免覆盖本地工作，已停止更新：\n${status}`)
  const currentBranch = requireCommand(runner('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir, 10_000), 'preflight', '读取 dsh 分支')
  if (currentBranch !== spec.branch) {
    throw new JobError('preflight', `当前分支为 ${currentBranch}，配置更新分支为 ${spec.branch}`)
  }
  const before = requireCommand(runner('git', ['rev-parse', 'HEAD'], dir, 10_000), 'preflight', '读取 dsh 当前提交')
  const beforeVersion = readPackage(dir)?.version ?? null
  updateState(spec, state, {
    stage: 'pull',
    beforeCommit: before,
    beforeVersion,
    message: '正在拉取 dsh 更新',
  })
  requireCommand(
    runner('git', ['pull', '--ff-only', spec.remote, spec.branch], dir, 300_000, networkEnv),
    'pull',
    'git pull ',
  )
  const after = requireCommand(runner('git', ['rev-parse', 'HEAD'], dir, 10_000), 'verify', '读取 dsh 更新后提交')
  const changed = before !== after
  state.steps.push(changed ? `Git 已更新：${before.slice(0, 10)} → ${after.slice(0, 10)}` : 'Git 已是最新')

  // 上游删包残留清理：pull 后、install/build 前执行。失败不阻断更新。
  cleanupStaleResidualDirs(dir, state, runner)

  if (spec.full) {
    updateState(spec, state, { stage: 'install', message: '正在安装 dsh 依赖' })
    requireCommand(runner('pnpm', ['install'], dir, 600_000, networkEnv), 'install', 'pnpm install ')
    state.steps.push('pnpm install 完成')
    updateState(spec, state, { stage: 'build', message: '正在重新构建 dsh' })
    requireCommand(runner('pnpm', ['run', 'build'], dir, 900_000, networkEnv), 'build', 'pnpm run build ')
    state.steps.push('pnpm run build 完成')
  }

  const afterVersion = readPackage(dir)?.version ?? null
  updateState(spec, state, {
    status: 'completed',
    stage: 'completed',
    message: changed || spec.full ? 'dsh 更新完成' : 'dsh 已是最新',
    afterCommit: after,
    afterVersion,
    changed,
    restartRequired: changed || spec.full,
    finishedAt: new Date().toISOString(),
  })
}

/** dsh 本体回退：reset --hard 到任务记录的"更新前提交"并完整重建。
 *  源码回退了，lib/node_modules 等产物必须跟着重建，否则新旧混跑。 */
async function runDshRollbackJob(spec, state, runner) {
  const dir = spec.repoDir
  const networkEnv = spec.proxy
    ? { HTTP_PROXY: spec.proxy, HTTPS_PROXY: spec.proxy, http_proxy: spec.proxy, https_proxy: spec.proxy }
    : undefined
  const commit = String(spec.commit ?? '')
  if (!/^[0-9a-f]{4,40}$/i.test(commit)) {
    throw new JobError('preflight', `回退目标提交号非法: ${commit}`)
  }
  const status = requireCommand(runner('git', ['status', '--porcelain'], dir, 10_000), 'preflight', '读取 dsh Git 状态')
  if (status) throw new JobError('preflight', `dsh 存在未提交改动，为避免覆盖本地工作，已停止回退：\n${status}`)
  const currentBranch = requireCommand(runner('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir, 10_000), 'preflight', '读取 dsh 分支')
  if (spec.branch && currentBranch !== spec.branch) {
    throw new JobError('preflight', `当前分支为 ${currentBranch}，配置分支为 ${spec.branch}`)
  }
  const before = requireCommand(runner('git', ['rev-parse', 'HEAD'], dir, 10_000), 'preflight', '读取 dsh 当前提交')
  if (before === commit) throw new JobError('preflight', 'dsh 已处于回退目标提交，无需回退')
  requireCommand(runner('git', ['cat-file', '-e', `${commit}^{commit}`], dir, 10_000), 'preflight', '校验回退目标提交')
  updateState(spec, state, {
    stage: 'reset',
    beforeCommit: before,
    targetCommit: commit,
    message: `正在回退 dsh 到 ${commit.slice(0, 10)}`,
  })
  requireCommand(runner('git', ['reset', '--hard', commit], dir, 60_000), 'reset', 'git reset ')
  state.steps.push(`已回退：${before.slice(0, 10)} → ${commit.slice(0, 10)}（被回退的提交仍可用 git reflog 找回）`)
  // 回退后的源码同样可能有上游删包残留，与正向更新共用清理逻辑
  cleanupStaleResidualDirs(dir, state, runner)
  updateState(spec, state, { stage: 'install', message: '正在安装 dsh 依赖' })
  requireCommand(runner('pnpm', ['install'], dir, 600_000, networkEnv), 'install', 'pnpm install ')
  state.steps.push('pnpm install 完成')
  updateState(spec, state, { stage: 'build', message: '正在重新构建 dsh' })
  requireCommand(runner('pnpm', ['run', 'build'], dir, 900_000, networkEnv), 'build', 'pnpm run build ')
  state.steps.push('pnpm run build 完成')
  const afterVersion = readPackage(dir)?.version ?? null
  updateState(spec, state, {
    status: 'completed',
    stage: 'completed',
    message: `dsh 已回退到 ${commit.slice(0, 10)}，请重启 dsh web`,
    afterCommit: commit,
    afterVersion,
    changed: true,
    restartRequired: true,
    finishedAt: new Date().toISOString(),
  })
}

export async function runWorker(specPath, dependencies = {}) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const runner = dependencies.runCommand ?? runCommand
  const startedAt = new Date().toISOString()
  const base = {
    id: spec.id,
    action: spec.action,
    target: spec.target ?? '',
    status: 'running',
    stage: 'starting',
    steps: [],
    startedAt,
    restartRequired: false,
    workerPid: process.pid,
  }
  writeJobState(spec.statePath, spec.latestPath, base)
  try {
    if (spec.action === 'npm') {
      await runNpmJob(spec, base, runner)
      return
    }
    if (spec.action === 'link') {
      await runLinkJob(spec, base, runner)
      return
    }
    if (spec.action === 'dsh') {
      await runDshJob(spec, base, runner)
      return
    }
    if (spec.action === 'rollback-dsh') {
      await runDshRollbackJob(spec, base, runner)
      return
    }
    if (spec.action === 'batch') {
      await runBatchJob(spec, base, runner)
      return
    }
    if (spec.action === 'install') {
      await runInstallJob(spec, base, runner)
      return
    }
    if (spec.action === 'remove') {
      await runRemoveJob(spec, base, runner)
      return
    }
    throw new JobError('failed', `unsupported update action: ${String(spec.action)}`)
  } catch (error) {
    writeJobState(spec.statePath, spec.latestPath, {
      ...base,
      status: 'failed',
      stage: error instanceof JobError ? error.stage : 'failed',
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWorker(process.argv[2])
}
