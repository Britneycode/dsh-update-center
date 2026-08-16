import assert from 'node:assert/strict'
import test from 'node:test'

const topic = await import('../src/github-topic.mjs').catch(() => ({}))

const REGISTRY = {
  updated: '2026-08-16',
  categories: { ui: { en: 'UI', zh: 'UI' } },
  plugins: [
    {
      name: 'DSH-Right-Sidebar',
      owner: 'Limitinfinite',
      url: 'https://github.com/Limitinfinite/DSH-Right-Sidebar',
      category: 'ui',
      description: { en: 'dock', zh: '侧栏' },
      npm: null,
      stars: 5,
    },
  ],
}

test('converts a GitHub repo into a market entry', () => {
  const entry = topic.githubRepoToEntry({
    name: 'dsh-fancy',
    owner: { login: 'someone' },
    html_url: 'https://github.com/someone/dsh-fancy',
    description: 'A fancy plugin',
    stargazers_count: 42,
    pushed_at: '2026-08-01T00:00:00Z',
    fork: false,
  })
  assert.equal(entry.name, 'dsh-fancy')
  assert.equal(entry.owner, 'someone')
  assert.equal(entry.category, 'github')
  assert.equal(entry.description.en, 'A fancy plugin')
  assert.equal(entry.npm, null)
  assert.equal(entry.stars, 42)
  assert.equal(entry.install, 'dsh plugin --profile web add github:someone/dsh-fancy')
  assert.equal(entry.added, '2026-08-01')
})

test('merge adds new repos and refreshes stars of known entries', () => {
  const data = JSON.parse(JSON.stringify(REGISTRY))
  const result = topic.mergeGithubTopic(data, [
    { name: 'dsh-new-hotness', owner: { login: 'dev1' }, stargazers_count: 900, description: 'new', pushed_at: '2026-08-15T00:00:00Z' },
    { name: 'dsh-right-sidebar', owner: { login: 'limitinfinite' }, stargazers_count: 120, description: 'known repo, different case' },
  ])
  assert.equal(result.added, 1)
  assert.equal(result.starsUpdated, 1)
  assert.equal(data.plugins.length, 2)
  assert.equal(data.plugins[0].stars, 120)
  assert.equal(data.plugins[1].name, 'dsh-new-hotness')
  assert.equal(data.categories.github.zh, 'GitHub 发现')
  assert.equal(data.githubExtra, 1)
})

test('merge skips entries missing owner or name and tolerates bad input', () => {
  const data = JSON.parse(JSON.stringify(REGISTRY))
  assert.deepEqual(topic.mergeGithubTopic(data, [{ name: 'no-owner' }, { owner: { login: 'x' } }]), { added: 0, starsUpdated: 0 })
  assert.deepEqual(topic.mergeGithubTopic(null, []), { added: 0, starsUpdated: 0 })
  assert.deepEqual(topic.mergeGithubTopic(data, null), { added: 0, starsUpdated: 0 })
  assert.equal(data.plugins.length, 1)
})
