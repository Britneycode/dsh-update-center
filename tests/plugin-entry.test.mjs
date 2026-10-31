/**
 * 插件入口（lib/index.js）的加载契约。
 *
 * 锚定 issue #2：`schemastery` 曾经只声明在 peerDependencies，而 profile 的
 * `autoInstallPeers: false` 让 peer 永不落盘，于是顶层 `import z from
 * 'schemastery'` 在模块求值前就 ERR_MODULE_NOT_FOUND，整个插件加载失败。
 *
 * 两条不能破的约定：
 *  1. 不得有顶层静态 import 指向 optional/peer 依赖；
 *  2. schemastery 取不到时必须降级（Config 退成带默认值的普通对象），
 *     而不是让插件挂掉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'lib', 'index.js')
const source = readFileSync(entry, 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('schemastery 是 dependencies 而不是 peerDependencies', () => {
  assert.ok(
    pkg.dependencies?.schemastery,
    'schemastery 必须在 dependencies：peer 在 autoInstallPeers=false 的 profile 里不会落盘',
  )
  assert.equal(
    pkg.peerDependencies?.schemastery,
    undefined,
    'schemastery 不应继续留在 peerDependencies',
  )
})

test('入口没有指向 schemastery 的顶层静态 import', () => {
  const staticImport = /^\s*import\s+[A-Za-z_$][\w$]*\s+from\s+['"]schemastery['"]/m
  assert.equal(
    staticImport.test(source),
    false,
    '顶层静态 import 失败会让整个插件加载失败，try/catch 兜不住；应改用 createRequire 惰性加载',
  )
  assert.ok(
    /createRequire/.test(source),
    '应通过 createRequire 同步加载 schemastery，以便失败时降级',
  )
})

test('schemastery 随包安装且暴露 z.object', async () => {
  if (!existsSync(join(root, 'node_modules', 'schemastery'))) {
    console.error('# skip: 本机未安装 schemastery，跳过')
    return
  }
  // 只验证依赖本身可用——加载整个入口还需要 peer（dsh-tools 等），
  // 那属于宿主环境，由下面的入口测试单独 skip 处理。
  const { createRequire } = await import('node:module')
  const require = createRequire(entry)
  const loaded = require('schemastery')
  const z = loaded?.default ?? loaded
  assert.equal(typeof z.object, 'function', 'schemastery 应导出 z.object')
  assert.equal(typeof z.string, 'function')
  assert.equal(typeof z.dict, 'function')
})

test('Config 降级值覆盖全部配置项，且是普通对象', () => {
  // 降级分支不可达时也能验证：DEFAULT_CONFIG 的形状必须与 Config 接口一致
  const defaults = source.match(/const DEFAULT_CONFIG\s*=\s*\{[^}]*\}/)
  assert.ok(defaults !== null, '入口应保留 DEFAULT_CONFIG 降级值')
  for (const key of ['profileDir', 'presetDir', 'proxy', 'upstreams']) {
    assert.ok(defaults[0].includes(key), `降级值缺少配置项 ${key}`)
  }
})

test('入口导出 name / inject / Config', async () => {
  if (!existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-tools'))) {
    console.error('# skip: 本机未安装 @deepseek-ai/dsh-tools（peer），跳过动态加载')
    return
  }
  const mod = await import(entry)
  assert.equal(mod.name, 'dsh-update-center')
  assert.ok(Array.isArray(mod.inject))
  assert.ok(mod.Config !== undefined)
  assert.equal(typeof mod.apply, 'function')
})