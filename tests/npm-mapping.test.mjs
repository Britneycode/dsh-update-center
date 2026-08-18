import assert from 'node:assert/strict'
import test from 'node:test'

const mapping = await import('../src/npm-mapping.mjs').catch(() => ({}))

test('extractOwnerRepo parses github repository urls', () => {
  assert.equal(mapping.extractOwnerRepo('git+https://github.com/owner/repo.git'), 'owner/repo')
  assert.equal(mapping.extractOwnerRepo('https://github.com/Owner/Repo'), 'Owner/Repo')
  assert.equal(mapping.extractOwnerRepo('git@github.com:owner/repo.git'), 'owner/repo')
  assert.equal(mapping.extractOwnerRepo('https://gitlab.com/owner/repo'), null)
  assert.equal(mapping.extractOwnerRepo(null), null)
  assert.equal(mapping.extractOwnerRepo('https://github.com/owner/repo/issues'), null)
})

test('extractOwnerRepo rejects lookalike repository urls entirely', () => {
  // 前缀拼接（github.com/evil/x/owner/repo）与后缀伪装（-evil / .evil）都无法
  // 解析成 owner/repo：resoloveInstallSpec 的锚定全等比较依赖此行为。
  assert.equal(mapping.extractOwnerRepo('https://github.com/evil/x/owner/repo'), null)
  assert.equal(mapping.extractOwnerRepo('https://github.com/other/repo/owner/repo'), null)
  assert.equal(mapping.extractOwnerRepo('https://github.com/owner/repo-evil'), 'owner/repo-evil')
  assert.equal(mapping.extractOwnerRepo('https://github.com/owner/repo.evil'), 'owner/repo.evil')
  assert.equal(mapping.extractOwnerRepo('https://github.com/evil.org/owner/repo'), null)
})

test('applyNpmMapping maps entries whose repository matches an npm package', () => {
  const data = {
    plugins: [
      { name: 'dsh-tool', owner: 'someone', npm: null, install: 'dsh plugin --profile web add github:someone/dsh-tool' },
      { name: 'other', owner: 'another', npm: null, install: 'dsh plugin --profile web add github:another/other' },
    ],
  }
  const mapped = mapping.applyNpmMapping(data, [
    { package: { name: '@scope/dsh-tool', links: { repository: 'git+https://github.com/Someone/dsh-tool.git' } } },
    { package: { name: 'unrelated', links: { repository: 'https://gitlab.com/x/y' } } },
    { package: { name: 'no-repo-link' } },
    // 抢注绕过尝试：前缀拼接与后缀伪装都不会命中 someone/dsh-tool
    { package: { name: 'evil-prefix', links: { repository: 'https://github.com/evil/x/someone/dsh-tool' } } },
    { package: { name: 'evil-suffix', links: { repository: 'https://github.com/someone/dsh-tool-evil' } } },
  ])
  assert.equal(mapped, 1)
  assert.equal(data.plugins[0].npm, '@scope/dsh-tool')
  assert.equal(data.plugins[0].install, 'dsh plugin --profile web add @scope/dsh-tool')
  assert.equal(data.plugins[1].npm, null)
})

test('applyNpmMapping keeps the first package for duplicate repositories and tolerates bad input', () => {
  const data = {
    plugins: [{ name: 'dup', owner: 'o', npm: null, install: '' }],
  }
  const mapped = mapping.applyNpmMapping(data, [
    { package: { name: 'first', links: { repository: 'https://github.com/o/dup' } } },
    { package: { name: 'second', links: { repository: 'https://github.com/o/dup.git' } } },
  ])
  assert.equal(mapped, 1)
  assert.equal(data.plugins[0].npm, 'first')
  assert.equal(mapping.applyNpmMapping(null, []), 0)
  assert.equal(mapping.applyNpmMapping(data, null), 0)
})

test('applyNpmMapping reports zero when mapping is unchanged', () => {
  const data = {
    plugins: [{ name: 'p', owner: 'o', npm: 'same-name', install: 'dsh plugin --profile web add same-name' }],
  }
  assert.equal(mapping.applyNpmMapping(data, [
    { package: { name: 'same-name', links: { repository: 'https://github.com/o/p' } } },
  ]), 0)
})
