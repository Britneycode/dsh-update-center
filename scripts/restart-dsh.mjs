#!/usr/bin/env node
/**
 * 重启 dsh 的后台助手（与 update-worker 同构的 detached 模式）。
 *
 * 由 /restart 端点以 detached 子进程方式启动，自身不阻塞主进程并安全越过
 * 主进程被杀：
 *   1. 读取 spec（原进程 pid / execPath / execArgv / argv / cwd）；
 *   2. 等待 delayMs（让 HTTP 响应先落地）；
 *   3. 杀掉原 dsh 进程（Windows 用 taskkill，POSIX 用 SIGTERM；不带 /T，
 *      避免误伤 detached 的更新 worker——/restart 端点已拒绝在任务进行中重启）；
 *   4. 确认旧进程确实退出（未退出则放弃重启：旧实例仍在服务，比“新实例抢
 *      不到端口半途而死”的半坏状态安全），再把 stdout/stderr 追加重定向到
 *      日志文件（重启后无控制台，启动失败要留有诊断线索），最后用完全相同
 *      的 execArgv + argv 在原 cwd 以 detached 方式重新拉起 dsh。
 *
 * 用法：node scripts/restart-dsh.mjs <spec.json>
 */

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, openSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function sleepSync(ms) {
  const w = new Atomics.Wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  return w === 'ok'
}

function main() {
  const specPath = process.argv[2]
  if (!specPath) process.exit(2)
  let spec
  try {
    spec = JSON.parse(readFileSync(specPath, 'utf8'))
  } catch {
    process.exit(2)
  }
  const pid = Number(spec.pid)
  const execPath = spec.execPath
  const execArgv = Array.isArray(spec.execArgv) ? spec.execArgv : []
  const argv = Array.isArray(spec.argv) ? spec.argv : []
  const cwd = typeof spec.cwd === 'string' ? spec.cwd : process.cwd()
  const delayMs = Number(spec.delayMs ?? 1200)
  const killWaitMs = Number(spec.killWaitMs ?? 1500)
  // 忠实还原原始启动方式：node 选项（如 --import tsx/esm）在 execArgv，脚本+参数在 argv
  const respawnArgs = [...execArgv, ...argv.slice(1)]
  // spec 与本助手同在 update-home 目录；重启日志就近落在这里
  const logDir = dirname(specPath)
  const stdoutLog = join(logDir, 'dsh-web.stdout.log')
  const stderrLog = join(logDir, 'dsh-web.stderr.log')

  setTimeout(() => {
    try {
      if (processAlive(pid)) {
        if (process.platform === 'win32') {
          // 不带 /T：只杀原进程，避免误杀其 detached 子进程（后台更新 worker）
          spawnSync('cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${pid} /F`], { windowsHide: true })
        } else {
          process.kill(pid, 'SIGTERM')
        }
      }
    } catch {
      /* 原进程已退出则忽略 */
    }
    // 确认旧进程确实退出（最多再等 5 秒）；没退出就放弃重启，旧实例继续服务。
    // 覆盖 taskkill 因权限/杀软拦截而失败的情形：此时强行拉新实例会绑不上端口，
    // 留下“看似在跑、实则没重启”的半坏状态。
    const killDeadline = Date.now() + 5000
    while (processAlive(pid) && Date.now() < killDeadline) sleepSync(250)
    if (processAlive(pid)) {
      try {
        appendFileSync(stderrLog, `[restart] ${new Date().toISOString()} 未能终止旧进程 PID ${pid}，已放弃本次重启（旧实例继续运行）。\n`)
      } catch { /* 日志写失败无处报告 */ }
      process.exit(1)
    }
    // 等端口/文件句柄释放后再拉起，避免新进程绑定同一端口失败
    setTimeout(() => {
      if (typeof execPath !== 'string' || !execPath) process.exit(1)
      // 拉起新进程前重打 bash-terminal 兼容补丁：插件更新会覆盖 profile 安装
      // 副本里的补丁（详见 repair-bash-terminal.mjs 头注释）。repair 与本助手
      // 同目录部署；缺失（未部署/被删）则跳过，不阻断重启。
      try {
        const repairScript = join(dirname(fileURLToPath(import.meta.url)), 'repair-bash-terminal.mjs')
        if (existsSync(repairScript)) {
          spawnSync(process.execPath, [repairScript], { windowsHide: true, timeout: 15_000 })
        }
      } catch { /* 补丁失败不阻断重启 */ }
      try {
        appendFileSync(stdoutLog, `\n===== dsh restarted at ${new Date().toISOString()} (pid ${pid} → respawn) =====\n`)
      } catch { /* 日志写失败不影响重启 */ }
      // stdio 重定向到日志文件：detached 重启后没有控制台，启动失败要留线索
      let outFd
      let errFd
      try {
        outFd = openSync(stdoutLog, 'a')
        errFd = openSync(stderrLog, 'a')
      } catch {
        outFd = 'ignore'
        errFd = 'ignore'
      }
      const child = spawn(execPath, respawnArgs, {
        cwd,
        detached: true,
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      })
      // 启动存活观察：spawn 成功不等于 dsh 真起来了——运行时崩溃（缺模块、
      // 端口被占、补丁失效等）通常发生在头几秒。助手保留 15 秒观察期，期间
      // 进程退出就把结论写进日志，避免"面板提示已重启、服务其实没起来"的
      // 静默失败（重启助手之前是拉起即退出，无从得知）。
      const startedAt = Date.now()
      let exited = false
      child.on('error', (error) => {
        try {
          appendFileSync(stderrLog, `[restart] 新进程拉起失败：${error}\n`)
        } catch { /* 日志写失败无处报告 */ }
        process.exit(1)
      })
      child.on('exit', (code, signal) => {
        exited = true
        try {
          appendFileSync(stderrLog, `[restart] 新进程启动 ${Math.round((Date.now() - startedAt) / 1000)}s 后退出（code=${code ?? '-'} signal=${signal ?? '-'}），dsh 未成功重启。请查看本文件与 dsh-web.stdout.log 定位原因；可用 Start-DSH 手动拉起，或回退 dsh 后再试。\n`)
        } catch { /* 日志写失败无处报告 */ }
      })
      child.unref()
      setTimeout(() => process.exit(exited ? 1 : 0), 15_000)
    }, killWaitMs)
  }, delayMs)
}

main()
