import { spawn } from 'node:child_process'

/**
 * 异步命令执行（服务端共享）：Windows 下先试裸命令（命中 .exe），失败后试 .cmd；
 * .cmd 批处理以 `cmd.exe /c + 参数数组` 执行——纯参数列表，转义由 Node 的 argv
 * 处理完成，不做字符串拼接。每个候选带独立完成守卫：候选不存在（ENOENT）时其
 * 迟到的 close 事件不会抢先结算，避免把重试候选的结果覆盖成失败。
 */
export async function runCommandAsync(command, args, cwd, timeoutMs = 120_000, extraEnv) {
  const isWin = process.platform === 'win32'
  const candidates = isWin && !/\.(exe|cmd|bat)$/i.test(command) ? [command, `${command}.cmd`] : [command]
  const env = { ...process.env, ...extraEnv }
  return new Promise((resolvePromise) => {
    const attempt = (index) => {
      const candidate = candidates[index]
      if (candidate === undefined) {
        resolvePromise({ ok: false, code: null, out: '', err: `command not found: ${command}` })
        return
      }
      const isBatch = isWin && candidate.endsWith('.cmd')
      let settled = false
      let attemptDead = false
      const finish = (result) => {
        if (settled) return
        settled = true
        resolvePromise(result)
      }
      try {
        const child = isBatch
          ? spawn('cmd.exe', ['/d', '/s', '/c', candidate, ...args], { cwd, timeout: timeoutMs, env, windowsHide: true })
          : spawn(candidate, args, { cwd, timeout: timeoutMs, env, windowsHide: true })
        let out = ''
        let err = ''
        child.stdout?.on('data', (chunk) => { out += String(chunk) })
        child.stderr?.on('data', (chunk) => { err += String(chunk) })
        child.on('error', (error) => {
          if (attemptDead) return
          attemptDead = true
          if (error.code === 'ENOENT' || error.code === 'EINVAL') {
            attempt(index + 1)
            return
          }
          finish({ ok: false, code: null, out, err: [err, error.message ?? String(error)].filter(Boolean).join('\n') })
        })
        child.on('close', (code) => {
          if (attemptDead) return
          attemptDead = true
          finish({ ok: code === 0, code, out, err: err.trim() ? err : '' })
        })
      } catch (error) {
        if (attemptDead) return
        attemptDead = true
        finish({ ok: false, code: null, out: '', err: String(error) })
      }
    }
    attempt(0)
  })
}
