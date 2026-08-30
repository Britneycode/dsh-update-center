import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const worker = await import('../scripts/update-worker.mjs').catch(() => ({}))

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`)
}

test('rejects an npm update when the installed version did not reach the expected version', () => {
  const result = worker.verifyNpmUpdate({
    before: '0.1.5',
    expected: '0.1.7',
    installed: '0.1.5',
  })

  assert.equal(result.ok, false)
  assert.match(result.message, /0\.1\.5/)
  assert.match(result.message, /0\.1\.7/)
})

test('accepts an npm update only after the expected version is installed', () => {
  const result = worker.verifyNpmUpdate({
    before: '0.1.5',
    expected: '0.1.7',
    installed: '0.1.7',
  })

  assert.deepEqual(result, {
    ok: true,
    changed: true,
    message: '已安装 0.1.7',
  })
})

test('requires a build when Git changed source files without changing runtime artifacts', () => {
  assert.deepEqual(worker.analyzeGitArtifacts([
    'src/index.ts',
    'README.md',
  ]), {
    sourceChanged: true,
    artifactsChanged: false,
    buildRequired: true,
  })
})

test('does not require a build when the pulled commit includes runtime artifacts', () => {
  assert.deepEqual(worker.analyzeGitArtifacts([
    'src/index.ts',
    'lib/index.js',
  ]), {
    sourceChanged: true,
    artifactsChanged: true,
    buildRequired: false,
  })
})

test('persists job state to the job file and latest pointer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-update-state-'))
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  try {
    worker.writeJobState(statePath, latestPath, {
      id: 'job-1',
      status: 'running',
      stage: 'install',
    })

    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    const latest = JSON.parse(readFileSync(latestPath, 'utf8'))
    assert.equal(state.id, 'job-1')
    assert.equal(state.status, 'running')
    assert.equal(latest.stage, 'install')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('records a failed terminal state when a worker action is unsupported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-update-worker-'))
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-2',
    action: 'unsupported',
    statePath,
    latestPath,
  }))
  try {
    await worker.runWorker(specPath)
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'failed')
    assert.equal(state.stage, 'failed')
    assert.match(state.error, /unsupported/)
    assert.ok(state.finishedAt)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fails an npm job when pnpm exits successfully but the installed version is unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-update-npm-stale-'))
  const profileDir = join(dir, 'profile')
  const packageDir = join(profileDir, 'node_modules', '@scope', 'plugin')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@scope/plugin', version: '0.1.5' }))
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-npm-stale',
    action: 'npm',
    target: '@scope/plugin',
    packageName: '@scope/plugin',
    expectedVersion: '0.1.7',
    profileDir,
    statePath,
    latestPath,
  }))
  try {
    await worker.runWorker(specPath, {
      runCommand: () => ({ ok: true, code: 0, out: 'Done', err: '' }),
    })
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'failed')
    assert.equal(state.stage, 'verify')
    assert.match(state.error, /实际 0\.1\.5/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('completes an npm job after the expected version exists on disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-update-npm-complete-'))
  const profileDir = join(dir, 'profile')
  const packageDir = join(profileDir, 'node_modules', '@scope', 'plugin')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@scope/plugin', version: '0.1.5' }))
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-npm-complete',
    action: 'npm',
    target: '@scope/plugin',
    packageName: '@scope/plugin',
    expectedVersion: '0.1.7',
    profileDir,
    statePath,
    latestPath,
  }))
  try {
    await worker.runWorker(specPath, {
      runCommand: () => {
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@scope/plugin', version: '0.1.7' }))
        return { ok: true, code: 0, out: 'Done', err: '' }
      },
    })
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'completed')
    assert.equal(state.stage, 'completed')
    assert.equal(state.beforeVersion, '0.1.5')
    assert.equal(state.afterVersion, '0.1.7')
    assert.equal(state.restartRequired, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('builds a Git plugin when the pulled commit changes source but not runtime artifacts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-update-git-build-'))
  const seed = join(dir, 'seed')
  const remote = join(dir, 'remote.git')
  const target = join(dir, 'target')
  mkdirSync(join(seed, 'src'), { recursive: true })
  mkdirSync(join(seed, 'lib'), { recursive: true })
  writeFileSync(join(seed, 'package.json'), JSON.stringify({
    name: '@scope/git-plugin',
    version: '1.0.0',
    scripts: { build: 'node build.mjs' },
    main: 'lib/value.txt',
  }))
  writeFileSync(join(seed, 'build.mjs'), "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'; mkdirSync('lib', { recursive: true }); writeFileSync('lib/value.txt', readFileSync('src/value.txt'))\n")
  writeFileSync(join(seed, 'src', 'value.txt'), 'one')
  writeFileSync(join(seed, 'lib', 'value.txt'), 'one')
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  git(dir, 'init', '--bare', remote)
  git(seed, 'init', '-b', 'main')
  git(seed, 'config', 'user.email', 'test@example.com')
  git(seed, 'config', 'user.name', 'Test')
  git(seed, 'add', '.')
  git(seed, 'commit', '-m', 'initial')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '-u', 'origin', 'main')
  git(dir, 'clone', '-b', 'main', remote, target)
  writeFileSync(join(seed, 'src', 'value.txt'), 'two')
  git(seed, 'add', 'src/value.txt')
  git(seed, 'commit', '-m', 'source only')
  git(seed, 'push')

  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-git-build',
    action: 'link',
    target: '@scope/git-plugin',
    packageName: '@scope/git-plugin',
    kind: 'link',
    dir: target,
    statePath,
    latestPath,
  }))
  try {
    await worker.runWorker(specPath)
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'completed')
    assert.equal(state.stage, 'completed')
    assert.equal(readFileSync(join(target, 'lib', 'value.txt'), 'utf8'), 'two')
    assert.ok(state.steps.some((step) => /build/.test(step)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('detached worker completes after its launcher process exits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-update-detached-'))
  const seed = join(dir, 'seed')
  const remote = join(dir, 'remote.git')
  const target = join(dir, 'target')
  mkdirSync(join(seed, 'src'), { recursive: true })
  mkdirSync(join(seed, 'lib'), { recursive: true })
  writeFileSync(join(seed, 'package.json'), JSON.stringify({
    name: '@scope/detached-plugin',
    version: '1.0.0',
    scripts: { build: 'node build.mjs' },
    main: 'lib/value.txt',
  }))
  writeFileSync(join(seed, 'build.mjs'), "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000); mkdirSync('lib', { recursive: true }); writeFileSync('lib/value.txt', readFileSync('src/value.txt'))\n")
  writeFileSync(join(seed, 'src', 'value.txt'), 'one')
  writeFileSync(join(seed, 'lib', 'value.txt'), 'one')
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  git(dir, 'init', '--bare', remote)
  git(seed, 'init', '-b', 'main')
  git(seed, 'config', 'user.email', 'test@example.com')
  git(seed, 'config', 'user.name', 'Test')
  git(seed, 'add', '.')
  git(seed, 'commit', '-m', 'initial')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '-u', 'origin', 'main')
  git(dir, 'clone', '-b', 'main', remote, target)
  writeFileSync(join(seed, 'src', 'value.txt'), 'two')
  git(seed, 'add', 'src/value.txt')
  git(seed, 'commit', '-m', 'source only')
  git(seed, 'push')

  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  const launcherPath = join(dir, 'launch-worker.mjs')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-detached',
    action: 'link',
    target: '@scope/detached-plugin',
    packageName: '@scope/detached-plugin',
    kind: 'link',
    dir: target,
    statePath,
    latestPath,
  }))
  writeFileSync(launcherPath, `import { spawn } from 'node:child_process'\nconst child = spawn(process.execPath, [${JSON.stringify(join(import.meta.dirname, '..', 'scripts', 'update-worker.mjs'))}, ${JSON.stringify(specPath)}], { detached: true, stdio: 'ignore', windowsHide: true })\nchild.unref()\n`)

  try {
    execFileSync(process.execPath, [launcherPath], { stdio: 'ignore' })
    const running = await waitFor(() => {
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf8'))
        return state.status === 'running' && state.workerPid ? state : null
      } catch {
        return null
      }
    })
    assert.doesNotThrow(() => process.kill(running.workerPid, 0))

    const completed = await waitFor(() => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'))
      return state.status === 'completed' ? state : null
    }, 15_000)
    assert.equal(completed.stage, 'completed')
    assert.equal(readFileSync(join(target, 'lib', 'value.txt'), 'utf8'), 'two')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('updates a dsh checkout through the configured remote branch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-update-checkout-'))
  const seed = join(dir, 'seed')
  const remote = join(dir, 'remote.git')
  const checkout = join(dir, 'checkout')
  mkdirSync(seed, { recursive: true })
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '1.0.0' }))
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' })
  git(dir, 'init', '--bare', remote)
  git(seed, 'init', '-b', 'master')
  git(seed, 'config', 'user.email', 'test@example.com')
  git(seed, 'config', 'user.name', 'Test')
  git(seed, 'add', '.')
  git(seed, 'commit', '-m', 'initial')
  git(seed, 'remote', 'add', 'origin', remote)
  git(seed, 'push', '-u', 'origin', 'master')
  git(dir, 'clone', '-b', 'master', remote, checkout)
  writeFileSync(join(seed, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-root', version: '1.1.0' }))
  git(seed, 'add', 'package.json')
  git(seed, 'commit', '-m', 'release')
  git(seed, 'push')

  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-dsh-pull',
    action: 'dsh',
    target: 'dsh',
    repoDir: checkout,
    remote: 'origin',
    branch: 'master',
    full: false,
    statePath,
    latestPath,
  }))
  try {
    await worker.runWorker(specPath)
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    const packageJson = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
    assert.equal(state.status, 'completed')
    assert.equal(state.changed, true)
    assert.equal(state.restartRequired, true)
    assert.equal(packageJson.version, '1.1.0')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reconcileBundles adds a dependency that now declares a bundle', () => {
  const manifest = {
    dependencies: { foo: '^1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }
  const result = worker.reconcileBundles(manifest, 'foo', true)
  assert.equal(result.changed, true)
  assert.deepEqual(result.bundles, ['@deepseek-ai/dsh-base', 'foo'])
})

test('reconcileBundles removes a dependency that dropped its bundle declaration', () => {
  const manifest = {
    dependencies: { foo: '^2.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'foo'] } },
  }
  const result = worker.reconcileBundles(manifest, 'foo', false)
  assert.equal(result.changed, true)
  assert.deepEqual(result.bundles, ['@deepseek-ai/dsh-base'])
})

test('reconcileBundles leaves template bundles and non-dependency names untouched', () => {
  const manifest = {
    dependencies: { foo: '^1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }
  assert.equal(worker.reconcileBundles(manifest, '@deepseek-ai/dsh-base', false).changed, false)
  assert.equal(worker.reconcileBundles(manifest, 'missing-plugin', true).changed, false)
  assert.equal(worker.reconcileBundles(manifest, 'foo', false).changed, false)
})

test('reconcileBundles tolerates a manifest without bundle metadata', () => {
  const manifest = { dependencies: { foo: '^1.0.0' } }
  const result = worker.reconcileBundles(manifest, 'foo', true)
  assert.equal(result.changed, true)
  assert.deepEqual(result.bundles, ['foo'])
})

test('bundleDeclared reads the installed package manifest under node_modules', () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-update-profile-'))
  const scoped = join(profileDir, 'node_modules', '@scope', 'plugin-a')
  const plain = join(profileDir, 'node_modules', 'plugin-b')
  mkdirSync(scoped, { recursive: true })
  mkdirSync(plain, { recursive: true })
  writeFileSync(join(scoped, 'package.json'), JSON.stringify({
    name: '@scope/plugin-a',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plugin-b' }))
  try {
    assert.equal(worker.bundleDeclared(profileDir, '@scope/plugin-a'), true)
    assert.equal(worker.bundleDeclared(profileDir, 'plugin-b'), false)
    assert.equal(worker.bundleDeclared(profileDir, 'not-installed'), false)
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
})

test('parseIgnoredBuilds returns empty when pnpm prints no ignored scripts', () => {
  const output = ['Packages: +1', '', 'Done'].join('\n')
  assert.deepEqual(worker.parseIgnoredBuilds(output), [])
})

test('parseIgnoredBuilds parses the list form of ignored build scripts', () => {
  const output = [
    'Lifecycle scripts performed:',
    'Ignored build scripts:',
    '  - @scope/tool@1.2.3',
    '  - plain-pkg@0.4.1,',
    '',
    'done',
  ].join('\n')
  assert.deepEqual(worker.parseIgnoredBuilds(output), ['@scope/tool', 'plain-pkg'])
})

test('parseBuildsRefused detects the git-hosted build refusal message', () => {
  const message = 'ERR_PNPM_JSON_PARSE git-hosted package "@scope/tool@2.8.0" needs to execute build scripts'
  assert.equal(worker.parseBuildsRefused(message), '@scope/tool')
  assert.equal(worker.parseBuildsRefused('unrelated failure'), null)
})

test('installedPackageValid requires a dsh manifest or an existing main entry', () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-install-valid-'))
  const withDsh = join(profileDir, 'node_modules', 'pkg-a')
  const withMain = join(profileDir, 'node_modules', 'pkg-b')
  const brokenMain = join(profileDir, 'node_modules', 'pkg-c')
  for (const dir of [withDsh, withMain, brokenMain]) mkdirSync(dir, { recursive: true })
  mkdirSync(join(withMain, 'lib'), { recursive: true })
  writeFileSync(join(withDsh, 'package.json'), JSON.stringify({ name: 'pkg-a', dsh: { client: {} } }))
  writeFileSync(join(withMain, 'package.json'), JSON.stringify({ name: 'pkg-b', main: './lib/index.js' }))
  writeFileSync(join(withMain, 'lib', 'index.js'), 'export {}')
  writeFileSync(join(brokenMain, 'package.json'), JSON.stringify({ name: 'pkg-c', main: './lib/index.js' }))
  try {
    assert.equal(worker.installedPackageValid(profileDir, 'pkg-a'), true)
    assert.equal(worker.installedPackageValid(profileDir, 'pkg-b'), true)
    assert.equal(worker.installedPackageValid(profileDir, 'pkg-c'), false)
    assert.equal(worker.installedPackageValid(profileDir, 'missing'), false)
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
})

test('removeFromBundles drops the listed name and keeps others', () => {
  const manifest = { dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'pkg-a'] } } }
  const result = worker.removeFromBundles(manifest, 'pkg-a')
  assert.deepEqual(result, { changed: true, bundles: ['@deepseek-ai/dsh-base'] })
  assert.equal(worker.removeFromBundles(manifest, 'not-listed').changed, false)
})

function writeProfile(dir, dependencies, bundles) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  }, null, 2))
}

function readProfile(dir) {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

test('install job installs, verifies, and activates the bundle layer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-job-'))
  const profileDir = join(dir, 'profile')
  writeProfile(profileDir, {}, ['@deepseek-ai/dsh-base'])
  const packageName = '@scope/market-pkg'
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-install-ok',
    action: 'install',
    target: 'market-pkg',
    installSpec: packageName,
    profileDir,
    statePath,
    latestPath,
  }))
  const stub = (command, args) => {
    if (command === 'pnpm' && args[0] === 'add') {
      const manifest = readProfile(profileDir)
      manifest.dependencies[packageName] = '^1.0.0'
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2))
      const packageDir = join(profileDir, 'node_modules', '@scope', 'market-pkg')
      mkdirSync(packageDir, { recursive: true })
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
        name: packageName,
        version: '1.0.0',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
      return { ok: true, code: 0, out: 'Done', err: '' }
    }
    return { ok: true, code: 0, out: '', err: '' }
  }
  try {
    await worker.runWorker(specPath, { runCommand: stub })
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'completed')
    assert.deepEqual(state.installed, [packageName])
    assert.equal(state.restartRequired, true)
    const manifest = readProfile(profileDir)
    assert.ok(manifest.dsh.profile.bundles.includes(packageName))
    assert.equal(manifest.dsh.profile.bundles[0], '@deepseek-ai/dsh-base')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('install job rolls back when the installed package has no runnable entry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-rollback-'))
  const profileDir = join(dir, 'profile')
  writeProfile(profileDir, {}, [])
  const packageName = 'broken-pkg'
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-install-rollback',
    action: 'install',
    target: 'broken-pkg',
    installSpec: packageName,
    profileDir,
    statePath,
    latestPath,
  }))
  const stub = (command, args) => {
    if (command === 'pnpm' && args[0] === 'add') {
      const manifest = readProfile(profileDir)
      manifest.dependencies[packageName] = '^1.0.0'
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2))
      const packageDir = join(profileDir, 'node_modules', packageName)
      mkdirSync(packageDir, { recursive: true })
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: packageName, main: './lib/index.js' }))
      return { ok: true, code: 0, out: 'Ignored build scripts:\n - broken-pkg@1.0.0', err: '' }
    }
    if (command === 'pnpm' && args[0] === 'remove') {
      const manifest = readProfile(profileDir)
      delete manifest.dependencies[args[1]]
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2))
      return { ok: true, code: 0, out: '', err: '' }
    }
    return { ok: true, code: 0, out: '', err: '' }
  }
  try {
    await worker.runWorker(specPath, { runCommand: stub })
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'failed')
    assert.equal(state.stage, 'verify')
    assert.match(state.error, /回滚/)
    assert.match(state.error, /broken-pkg/)
    const manifest = readProfile(profileDir)
    assert.equal(packageName in manifest.dependencies, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('remove job uninstalls the dependency and deactivates the bundle layer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-remove-job-'))
  const profileDir = join(dir, 'profile')
  const packageName = 'old-plugin'
  writeProfile(profileDir, { [packageName]: '^1.0.0' }, ['@deepseek-ai/dsh-base', packageName])
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-remove-ok',
    action: 'remove',
    target: packageName,
    packageName,
    profileDir,
    statePath,
    latestPath,
  }))
  const stub = (command, args) => {
    if (command === 'pnpm' && args[0] === 'remove') {
      const manifest = readProfile(profileDir)
      delete manifest.dependencies[args[1]]
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2))
      return { ok: true, code: 0, out: '', err: '' }
    }
    return { ok: true, code: 0, out: '', err: '' }
  }
  try {
    await worker.runWorker(specPath, { runCommand: stub })
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'completed')
    assert.equal(state.restartRequired, true)
    const manifest = readProfile(profileDir)
    assert.equal(packageName in manifest.dependencies, false)
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('batch job runs sub tasks serially and reports mixed results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-batch-mixed-'))
  const profileDir = join(dir, 'profile')
  writeProfile(profileDir, { 'pkg-a': '^1.0.0' }, ['pkg-a'])
  const packageDir = join(profileDir, 'node_modules', 'pkg-a')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.0.0', dsh: { client: {} } }))
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-batch-mixed',
    action: 'batch',
    target: '2 个插件',
    jobs: [
      { action: 'npm', target: 'pkg-a', packageName: 'pkg-a', expectedVersion: '1.1.0', profileDir },
      { action: 'unknown', target: 'bad-one', profileDir },
    ],
    profileDir,
    statePath,
    latestPath,
  }))
  const stub = (command, args) => {
    if (command === 'pnpm' && args[0] === 'update') {
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'pkg-a', version: '1.1.0', dsh: { client: {} } }))
      return { ok: true, code: 0, out: 'Done', err: '' }
    }
    return { ok: true, code: 0, out: '', err: '' }
  }
  try {
    await worker.runWorker(specPath, { runCommand: stub })
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'completed')
    assert.equal(state.stage, 'batch-done')
    assert.match(state.message, /1 成功 \/ 1 失败/)
    assert.equal(state.restartRequired, true)
    assert.deepEqual(state.results.map((entry) => entry.target), ['pkg-a', 'bad-one'])
    assert.equal(state.results[0].ok, true)
    assert.equal(state.results[1].ok, false)
    assert.ok(state.steps.some((line) => line.includes('[pkg-a]')))
    assert.ok(state.steps.some((line) => line.includes('[bad-one] 失败')))
    assert.match(state.error, /bad-one/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('batch job fails when every sub task fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-batch-fail-'))
  const profileDir = join(dir, 'profile')
  writeProfile(profileDir, {}, [])
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  writeFileSync(specPath, JSON.stringify({
    id: 'job-batch-fail',
    action: 'batch',
    target: '2 个插件',
    jobs: [
      { action: 'unknown', target: 'first', profileDir },
      { action: 'unknown', target: 'second', profileDir },
    ],
    profileDir,
    statePath,
    latestPath,
  }))
  try {
    await worker.runWorker(specPath, { runCommand: () => ({ ok: true, code: 0, out: '', err: '' }) })
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'failed')
    assert.equal(state.restartRequired, false)
    assert.match(state.error, /first/)
    assert.match(state.error, /second/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const toPosix = (p) => p.split(/[\\/]/).join('/')

test('enumerates workspace package dirs following the tsdown/pnpm globs', () => {
  const repo = mkdtempSync(join(tmpdir(), 'uc-ws-'))
  try {
    mkdirSync(join(repo, 'packages', 'host', 'real'), { recursive: true })
    mkdirSync(join(repo, 'packages', 'host', 'ghost'), { recursive: true })
    mkdirSync(join(repo, 'vendor', 'tool'), { recursive: true })
    mkdirSync(join(repo, 'apps', 'cli'), { recursive: true })
    const dirs = worker.enumerateWorkspaceDirs(repo).map(toPosix)
    const root = toPosix(repo)
    assert.ok(dirs.includes(`${root}/packages/host/real`))
    assert.ok(dirs.includes(`${root}/packages/host/ghost`))
    assert.ok(dirs.includes(`${root}/vendor/tool`))
    assert.ok(dirs.includes(`${root}/apps/cli`))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('finds only untracked artifact-only ghost dirs as stale residuals', () => {
  const repo = mkdtempSync(join(tmpdir(), 'uc-stale-'))
  try {
    // 正常包：有 package.json → 不报
    mkdirSync(join(repo, 'packages', 'a', 'real', 'lib'), { recursive: true })
    writeFileSync(join(repo, 'packages', 'a', 'real', 'package.json'), '{}')
    // 空壳 + 只有构建产物 + git 不跟踪 → 报告
    mkdirSync(join(repo, 'packages', 'a', 'ghost', 'node_modules', 'x'), { recursive: true })
    mkdirSync(join(repo, 'packages', 'a', 'ghost', 'lib'), { recursive: true })
    // 空壳但含非白名单内容（可能是本地工作）→ 不报
    mkdirSync(join(repo, 'packages', 'a', 'ghostuser', 'src'), { recursive: true })
    // 空壳但 git 有跟踪文件 → 不报
    mkdirSync(join(repo, 'packages', 'a', 'trackedghost', 'lib'), { recursive: true })
    // git 查询失败 → 不报
    mkdirSync(join(repo, 'vendor', 'ghostfail', 'dist'), { recursive: true })
    const trackedRel = 'packages/a/trackedghost'
    const runner = (command, args) => {
      if (command !== 'git' || args[0] !== 'ls-files') return { ok: false, code: null, out: '', err: '' }
      const rel = args[2]
      if (rel === trackedRel) return { ok: true, code: 0, out: `${trackedRel}/src/index.js\n`, err: '' }
      if (rel === 'vendor/ghostfail') return { ok: false, code: null, out: '', err: 'boom' }
      return { ok: true, code: 0, out: '', err: '' }
    }
    const stale = worker.findStaleResidualDirs(repo, runner).map(toPosix)
    assert.equal(stale.length, 1)
    assert.ok(stale[0].endsWith('packages/a/ghost'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('dsh job cleans stale residual dirs after pull and before build', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uc-dsh-stale-'))
  const repoDir = join(dir, 'repo')
  mkdirSync(join(repoDir, 'packages', 'host', 'apiproxy', 'lib'), { recursive: true })
  mkdirSync(join(repoDir, 'apps', 'cli'), { recursive: true })
  writeFileSync(join(repoDir, 'apps', 'cli', 'package.json'), '{}')
  const specPath = join(dir, 'spec.json')
  const statePath = join(dir, 'job.json')
  const latestPath = join(dir, 'latest.json')
  let pulls = 0
  writeFileSync(specPath, JSON.stringify({
    id: 'job-dsh-stale',
    action: 'dsh',
    target: 'dsh',
    full: true,
    remote: 'origin',
    branch: 'master',
    repoDir,
    statePath,
    latestPath,
  }))
  const runCommand = (command, args, cwd) => {
    if (command === 'git') {
      if (args[0] === 'status') return { ok: true, code: 0, out: '', err: '' }
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { ok: true, code: 0, out: 'master', err: '' }
      if (args[0] === 'rev-parse') return { ok: true, code: 0, out: pulls ? 'bbbbbbbbbbbb' : 'aaaaaaaaaaaa', err: '' }
      if (args[0] === 'pull') { pulls += 1; return { ok: true, code: 0, out: '', err: '' } }
      if (args[0] === 'ls-files') {
        const rel = args[2]
        if (rel === 'packages/host/apiproxy') return { ok: true, code: 0, out: '', err: '' }
        return { ok: false, code: null, out: '', err: 'unexpected' }
      }
    }
    return { ok: true, code: 0, out: '', err: '' }
  }
  try {
    await worker.runWorker(specPath, { runCommand })
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(state.status, 'completed')
    assert.ok(state.steps.some((step) => step.includes('packages/host/apiproxy')))
    assert.equal(existsSync(join(repoDir, 'packages', 'host', 'apiproxy')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
