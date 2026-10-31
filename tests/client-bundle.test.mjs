/**
 * 浏览器半边（lib/client.js）的契约测试。
 *
 * 三条不能破的约定：
 *  1. bundle 以包名注册，且 dsh.client 声明与宿主约定一致；
 *  2. bundle 的每个 require 目标都在桌面端 shell 的基线模块表（PLATFORM_MODULES）里
 *     ——桌面端升级换了共享模块表，这条会先红；
 *  3. 面板确实经过宿主控件（Button / RiskConfirmation / Toast），而不是自绘 DOM。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { act, create as createRenderer } from 'react-test-renderer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = join(root, 'lib', 'client.js')
const source = readFileSync(bundlePath, 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const HOST_MODULES = {
  react: 'react',
  'react/jsx-runtime': 'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives': '@deepseek-ai/dsh-client-ui-primitives',
}

/**
 * 浏览器环境替身。
 *
 * bundle 顶层是 `function (window) { ... }`——形参 window 会遮蔽 globalThis.window，
 * 而组件的 fetchJson / 轮询都用 window.setTimeout。所以这些方法必须挂在传给
 * `new Function` 的那个对象上（见 loadBundle），光设 globalThis.window 不生效。
 */
const BROWSER_METHODS = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  matchMedia: () => ({ matches: false }),
  location: { reload() {} },
  open() {},
}

function installBrowserGlobals() {
  const previous = globalThis.window
  globalThis.window = { ...BROWSER_METHODS }
  return () => { globalThis.window = previous }
}

/** 宿主桌面端控件替身：保留「面板确实经过宿主组件」这一可观测事实与关键入参。 */
function hostPrimitivesStub() {
  const seen = { riskConfirmation: [], toasts: [], buttons: [] }
  const Button = (props) => {
    seen.buttons.push(props)
    return createElement('button', {
      'data-host-primitive': 'Button',
      'data-variant': props.variant ?? 'ghost',
      disabled: props.disabled === true,
      onClick: props.onClick,
    }, props.children)
  }
  const RiskConfirmation = (props) => {
    seen.riskConfirmation.push(props)
    return createElement('div', {
      'data-host-primitive': 'RiskConfirmation',
      'data-open': String(props.open),
    }, props.open ? props.confirmLabel : null)
  }
  const Toast = (props) => {
    seen.toasts.push(props)
    return createElement('div', { 'data-host-primitive': 'Toast' }, props.text)
  }
  const SegmentedTabs = (props) => createElement('div', {
    'data-host-primitive': 'SegmentedTabs',
    'data-value': props.value,
  }, props.items?.map((item) => createElement('button', { key: item.value, onClick: () => props.onChange?.(item.value) }, item.label)))
  const Icon = () => null
  return {
    seen,
    module: {
      Button,
      RiskConfirmation,
      Toast,
      SegmentedTabs,
      IconCheckOutlineRegular: Icon,
      IconCordisPluginOutlineRegular: Icon,
      IconDownloadOutlineRegular: Icon,
      IconLinkOutlineRegular: Icon,
      IconRefreshOutlineRegular: Icon,
      IconSearchOutlineRegular: Icon,
      IconTrashOutlineRegular: Icon,
      IconWarningOutlineRegular: Icon,
    },
  }
}

function slotsStub(entries) {
  return {
    inject(_slot, callback) {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    register(options, component) {
      entries.push({ options, component })
      return () => {}
    },
  }
}

/** 执行 bundle：捕获 __ModuleLoader__.load 的注册体并实例化工厂。 */
async function loadBundle(moduleStubs) {
  const registrations = []
  const fakeWindow = {
    ...BROWSER_METHODS,
    __ModuleLoader__: { load(registration) { registrations.push(registration) } },
  }
  new Function('window', source)(fakeWindow)
  assert.equal(registrations.length, 1, 'bundle 必须恰好向 __ModuleLoader__ 注册一次')
  const hosts = {
    react: await import('react'),
    'react/jsx-runtime': await import('react/jsx-runtime'),
    ...moduleStubs,
  }
  const requireStub = (specifier) => {
    assert.ok(specifier in HOST_MODULES, `bundle require 了基线模块表之外的名字：${specifier}`)
    assert.ok(specifier in hosts, `测试没有为 ${specifier} 准备替身`)
    return hosts[specifier]
  }
  const exports = registrations[0].factory(requireStub)
  assert.ok(typeof exports?.apply === 'function', 'bundle 必须导出 apply()')
  return exports
}

/** 找桌面端安装目录里的 app.asar；找不到就返回 null。 */
function findDesktopAsar() {
  if (process.env.DSH_DESKTOP_ROOT === undefined) return null
  const candidate = join(process.env.DSH_DESKTOP_ROOT, 'resources', 'app.asar')
  return existsSync(candidate) ? candidate : null
}

/** 从 shell 前端 bundle 里抠出 PLATFORM_MODULES 的键集合。 */
function platformModuleKeys(asarPath) {
  const buf = readFileSync(asarPath)
  const start = buf.indexOf(Buffer.from('{"files":'))
  assert.ok(start >= 0, 'app.asar 头部解析失败')
  let depth = 0, inStr = false, esc = false, end = -1
  for (let i = start; i < buf.length; i++) {
    const c = buf[i]
    if (inStr) { if (esc) { esc = false; continue } if (c === 0x5c) { esc = true; continue } if (c === 0x22) inStr = false; continue }
    if (c === 0x22) { inStr = true; continue }
    if (c === 0x7b) depth++
    else if (c === 0x7d) { depth--; if (depth === 0) { end = i + 1; break } }
  }
  const header = JSON.parse(buf.slice(start, end).toString('utf8'))
  const base = 16 + Math.ceil((end - start) / 8) * 8
  const files = []
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const p = prefix ? `${prefix}/${name}` : name
      if (entry.files) walk(entry, p)
      else files.push({ path: p, size: entry.size, offset: Number(entry.offset) })
    }
  }
  walk(header, '')
  const shellEntry = files.find(f => /dsh-web-frontend\/dist\/assets\/index-[\w-]+\.js$/.test(f.path))
  assert.ok(shellEntry !== undefined, '桌面端 app.asar 里找不到 web 前端 bundle')
  const shell = buf.slice(base + shellEntry.offset, base + shellEntry.offset + shellEntry.size).toString('utf8')

  const table = shell.match(/function\s+[A-Za-z_$][\w$]*\(\)\s*\{\s*return\s*\{react:[\s\S]*?\}\s*\}/)
  assert.ok(table !== null, 'shell 前端 bundle 里找不到 PLATFORM_MODULES 静态表')
  const keys = new Set(['react'])
  for (const m of table[0].matchAll(/"([^"]+)"\s*:/g)) keys.add(m[1])
  for (const m of table[0].matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*:/g)) keys.add(m[1])
  return keys
}

test('bundle 以包名注册，且 dsh.client 声明与宿主约定一致', async () => {
  const registrations = []
  const fakeWindow = { __ModuleLoader__: { load(registration) { registrations.push(registration) } } }
  new Function('window', source)(fakeWindow)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, pkg.name, 'bundle 注册 id 必须等于包名（宿主按包名认模块）')

  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh?.client?.platform, 'web', '桌面端跑的是 web 前端，platform 必须是 web')
  assert.ok(pkg.exports?.['./client'], 'dsh.client 要求包导出 ./client bundle')
  assert.ok(
    (pkg.dsh?.client?.external ?? []).includes('@deepseek-ai/dsh-client-ui-primitives'),
    '面板控件来自宿主基线模块，必须声明为 external 而不是打包进 bundle',
  )
  assert.ok(existsSync(bundlePath))
})

test('bundle 的每个 require 目标都在桌面端 shell 的基线模块表里', () => {
  const asar = findDesktopAsar()
  if (asar === null) {
    console.error('# skip: 找不到桌面端 app.asar；设置 DSH_DESKTOP_ROOT 后重跑')
    return
  }
  const keys = platformModuleKeys(asar)
  const targets = [...source.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
  assert.ok(targets.length > 0, 'bundle 没有任何 require，构建可能不对')
  for (const target of targets) {
    assert.ok(keys.has(target), `require("${target}") 不在桌面端 PLATFORM_MODULES 里`)
  }
})

test('apply() 把面板注册到设置页的 update-center 导航项', async () => {
  const primitives = hostPrimitivesStub()
  const entries = []
  const exports = await loadBundle({
    '@deepseek-ai/dsh-client-ui-primitives': primitives.module,
    '@deepseek-ai/dsh-client-ui-slots': { SlotsService: {} },
  })
  const ctx = { effect: (cb) => { cb() }, slots: slotsStub(entries) }
  exports.apply(ctx)

  assert.equal(entries.length, 1, '必须注册一个 settings.section')
  const { options } = entries[0]
  assert.equal(options.name, 'settings.section')
  assert.equal(options.id, 'update-center')
  assert.equal(options.label(), '更新中心')
})

test('面板不写死颜色，也不再用 window.confirm', () => {
  assert.equal(
    /#[0-9a-fA-F]{3,6}\b/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    false,
    'bundle 里不应出现硬编码颜色（应走 --dsw-* 令牌）',
  )
  assert.equal(
    /window\.confirm\s*\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
    false,
    '不可逆操作必须走 RiskConfirmation，不能用 window.confirm',
  )
  for (const token of ['--dsw-alias-label-primary', '--dsw-alias-border-l2', '--dsw-radius-sm']) {
    assert.ok(source.includes(token), `面板样式应使用宿主语义令牌 ${token}`)
  }
})

test('面板挂载后渲染出宿主控件，且不可逆操作走 RiskConfirmation', async () => {
  const primitives = hostPrimitivesStub()
  const entries = []
  let statusBody = { ok: true, repo: { version: '1.0.0', git: { head: 'abc', branch: 'main', behind: 0 } }, plugins: [], job: {} }

  // 拦截 fetch：首次 /status 返回空数据即可
  const restoreWindow = installBrowserGlobals()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => {
      if (String(url).includes('/status')) return statusBody
      return { ok: true }
    },
  })

  try {
    const exports = await loadBundle({
      '@deepseek-ai/dsh-client-ui-primitives': primitives.module,
      '@deepseek-ai/dsh-client-ui-slots': { SlotsService: {} },
    })
    const ctx = { effect: (cb) => { cb() }, slots: slotsStub(entries) }
    exports.apply(ctx)

    const Panel = entries[0].component
    let renderer
    await act(async () => {
      renderer = createRenderer(createElement(Panel))
    })
    // 等首次 /status 落地
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })

    const json = JSON.stringify(renderer.toJSON())
    assert.ok(json.includes('更新中心'), '面板应显示标题')
    assert.equal(json.includes('dsh 本体'), false, '面板不再显示 dsh 本体区块（该能力已移除）')
    assert.ok(json.includes('全部更新') && json.includes('重启 dsh'), '工具栏应保留插件更新与重启')
    assert.ok(json.includes('已安装插件'), '面板应显示已安装插件区块')
    assert.ok(primitives.seen.buttons.length > 0, '面板应使用宿主 Button')
    assert.ok(
      primitives.seen.riskConfirmation.length > 0,
      '即使未打开，RiskConfirmation 也必须挂载并接收 props（不可逆操作走模态）',
    )
    assert.equal(primitives.seen.riskConfirmation.at(-1).open, false, '初始不应打开确认框')

    await act(async () => { renderer.unmount() })
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})

test('RiskConfirmation 打开后才允许确认，且确认后会下发请求', async () => {
  const primitives = hostPrimitivesStub()
  const entries = []
  const calls = []
  const restoreWindow = installBrowserGlobals()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' })
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, repo: { version: '1.0.0', git: {} }, plugins: [], job: {} }),
    }
  }
  try {
    const exports = await loadBundle({
      '@deepseek-ai/dsh-client-ui-primitives': primitives.module,
      '@deepseek-ai/dsh-client-ui-slots': { SlotsService: {} },
    })
    const ctx = { effect: (cb) => { cb() }, slots: slotsStub(entries) }
    exports.apply(ctx)
    const Panel = entries[0].component
    let renderer
    await act(async () => { renderer = createRenderer(createElement(Panel)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })

    // 点“重启 dsh” → 应打开 RiskConfirmation 而不是直接发请求
    const restartButton = primitives.seen.buttons.find((b) => JSON.stringify(b.children).includes('重启'))
    assert.ok(restartButton !== undefined, '工具栏应有重启按钮')
    const before = calls.filter((c) => c.url.includes('/restart')).length
    await act(async () => { restartButton.onClick() })
    assert.equal(primitives.seen.riskConfirmation.at(-1).open, true, '点重启应打开确认框')
    assert.equal(calls.filter((c) => c.url.includes('/restart')).length, before, '未确认前不得下发重启')

    // 未勾选时确认按钮 disabled
    const openProps = primitives.seen.riskConfirmation.at(-1)
    assert.equal(openProps.acknowledged, false)
    await act(async () => { openProps.onAcknowledgedChange(true) })
    assert.equal(primitives.seen.riskConfirmation.at(-1).acknowledged, true, '勾选后应允许确认')

    // 确认：用「重新挂载时捕获的最新 props」，旧引用是上一轮渲染的快照
    const confirmedProps = primitives.seen.riskConfirmation.at(-1)
    await act(async () => { confirmedProps.onConfirm() })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    assert.ok(
      calls.some((c) => c.url.includes('/restart') && c.method === 'POST'),
      `确认后应下发 POST /restart，实际调用：${JSON.stringify(calls)}`,
    )

    await act(async () => { renderer.unmount() })
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})