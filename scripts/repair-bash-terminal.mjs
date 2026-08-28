#!/usr/bin/env node
/**
 * dsh-bash-terminal 兼容补丁重打器（幂等，可重复执行）。
 *
 * 背景：dsh 0.1.2-alpha.1 上游移除了 @deepseek-ai/dsh-client-runtime
 * （commit be531688f3）。dsh-bash-terminal <= 0.3.14 的客户端 bundle 仍
 * require 旧包，启动时报
 *   client-modules: require("@deepseek-ai/dsh-client-runtime/client")
 *   missed the module table
 * 旧包里被插件用到的唯一导出 defineStore 已原样迁往
 * @deepseek-ai/dsh-client-store（commit 1b535f611c，函数体逐字节一致），
 * 且 client-store 是平台 seed 模块，require 恒可解析——因此把安装副本里的
 * 旧 require / dsh.client.inject / peerDependencies 改写为新包即可修复。
 *
 * 插件每次更新都会覆盖 profile 安装副本、冲掉补丁：本脚本由
 * dsh-restart.mjs（更新后自动重启，随 /restart 端点一并部署到 update-home）
 * 与用户的启动脚本在 dsh web 拉起前调用自动重打。作者发布适配新运行时的
 * 版本后，文件里不再含旧包名，本脚本自动变为 no-op，可安全保留。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const OLD_REQUIRE = 'require("@deepseek-ai/dsh-client-runtime/client")'
const NEW_REQUIRE = 'require("@deepseek-ai/dsh-client-store")'
const OLD_ID = '"@deepseek-ai/dsh-client-runtime"'
const NEW_ID = '"@deepseek-ai/dsh-client-store"'

const pkgDir = join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-bash-terminal')

function repair() {
  if (!existsSync(pkgDir)) return 0 // 插件未安装
  let patched = 0

  for (const rel of ['dist/client.js', 'dist/client.core.js']) {
    const file = join(pkgDir, rel)
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    if (!text.includes(OLD_REQUIRE)) continue
    writeFileSync(file, text.split(OLD_REQUIRE).join(NEW_REQUIRE))
    patched++
  }

  const pkgJsonPath = join(pkgDir, 'package.json')
  if (existsSync(pkgJsonPath)) {
    const text = readFileSync(pkgJsonPath, 'utf8')
    if (text.includes(OLD_ID)) {
      const next = text.split(OLD_ID).join(NEW_ID)
      JSON.parse(next) // 改写后必须仍是合法 JSON；损坏则放弃本次补丁
      writeFileSync(pkgJsonPath, next)
      patched++
    }
  }
  return patched
}

try {
  const patched = repair()
  if (patched > 0) {
    console.log(`[repair-bash-terminal] re-applied compat patch on ${patched} file(s)`)
  }
} catch (error) {
  console.error(`[repair-bash-terminal] failed: ${error}`)
}
process.exit(0)
