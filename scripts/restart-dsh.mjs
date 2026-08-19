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
 *   4. 再用完全相同的 execArgv + argv 在原 cwd 以 detached 方式重新拉起 dsh。
 *
 * 用法：node scripts/restart-dsh.mjs <spec.json>
 */

import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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

  setTimeout(() => {
    try {
      if (process.platform === 'win32') {
        // 不带 /T：只杀原进程，避免误杀其 detached 子进程（后台更新 worker）
        spawnSync('cmd.exe', ['/d', '/s', '/c', `taskkill /PID ${pid} /F`], { windowsHide: true })
      } else {
        process.kill(pid, 'SIGTERM')
      }
    } catch {
      /* 原进程已退出则忽略 */
    }
    // 等端口/文件句柄释放后再拉起，避免新进程绑定同一端口失败
    setTimeout(() => {
      if (typeof execPath !== 'string' || !execPath) process.exit(1)
      const child = spawn(execPath, respawnArgs, {
        cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.on('error', () => process.exit(1))
      child.unref()
      process.exit(0)
    }, killWaitMs)
  }, delayMs)
}

main()
