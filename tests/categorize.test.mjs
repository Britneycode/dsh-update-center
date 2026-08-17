import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const categorize = await import('../src/categorize.mjs')

const AWESOME_MAP = {
  'someone/known-repo': 'Memory',
  'other/known-repo': 'Just for Fun',
}

test('awesome mapping wins over keywords and is case-insensitive', () => {
  const plugin = { owner: 'SomeOne', name: 'Known-Repo', description: { en: 'a billing dashboard', zh: '' } }
  assert.equal(categorize.classifyPlugin(plugin, AWESOME_MAP), 'memory')
})

test('keyword rules classify by name and both descriptions', () => {
  assert.equal(categorize.classifyPlugin({ name: 'dsh-usage-report', description: {} }, null), 'billing')
  assert.equal(categorize.classifyPlugin({ name: 'x', description: { en: 'session export tool' } }, null), 'sessions')
  assert.equal(categorize.classifyPlugin({ name: 'x', description: { zh: '深色主题与图标包' } }, null), 'themes')
  assert.equal(categorize.classifyPlugin({ name: 'x', description: { en: 'notify me on telegram when done' } }, null), 'notifications')
})

test('specific categories win over generic ones regardless of text order', () => {
  // 通用词（工具）出现得更早，但更特定的计费分类应当胜出
  assert.equal(categorize.classifyPlugin({ name: 'x', description: { en: 'a tool for usage tracking' } }, null), 'billing')
})

test('manual overrides and the other fallback', () => {
  assert.equal(categorize.classifyPlugin({ owner: 'DeepSeek-AI', name: 'deepseek-harness', description: {} }, null), 'dev')
  assert.equal(categorize.classifyPlugin({ owner: 'Britneycode', name: 'dsh-update-center', description: {} }, null), 'markets')
  assert.equal(categorize.classifyPlugin({ name: 'th08', description: { en: 'Source reconstruction of Touhou' } }, null), 'other')
  assert.equal(categorize.classifyPlugin(null, null), 'other')
})

test('noise words alone do not classify', () => {
  assert.equal(categorize.classifyPlugin({ name: 'dsh-plugin', description: { en: 'a dsh plugin extension for deepseek harness' } }, null), 'other')
})

test('applyCategories rewrites entries and installs full labels', () => {
  const data = {
    categories: { github: { en: 'GitHub discovered', zh: 'GitHub 发现' } },
    plugins: [
      { owner: 'someone', name: 'known-repo', description: { en: '' }, category: 'github' },
      { owner: 'a', name: 'weather-tool', description: { en: 'weather forecast tool' }, category: 'github' },
    ],
  }
  const { counts, bySource } = categorize.applyCategories(data, AWESOME_MAP)
  assert.equal(data.plugins[0].category, 'memory')
  assert.equal(data.plugins[1].category, 'tools')
  assert.equal(bySource.awesome, 1)
  assert.equal(bySource.keyword, 1)
  assert.equal(counts.tools, 1)
  assert.ok(!data.categories.github)
  assert.equal(data.categories.memory.zh, '记忆')
  assert.equal(Object.keys(data.categories).length, Object.keys(categorize.CATEGORY_LABELS).length)
})

test('bundled awesome-categories.json flattens into a lowercase lookup', () => {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../data/awesome-categories.json', import.meta.url)), 'utf8'))
  const flat = categorize.flattenAwesomeMap(raw)
  assert.ok(Object.keys(flat).length > 500)
  assert.equal(flat['e2mcc/dsh-popout-sidebar'], 'UI Enhancements')
  for (const [repo, section] of Object.entries(flat)) {
    assert.match(repo, /^[^/]+\/[^/]+$/)
    assert.ok(typeof section === 'string' && section.length > 0)
  }
})

test('every section in the bundled map resolves to a category key', () => {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../data/awesome-categories.json', import.meta.url)), 'utf8'))
  const sections = [...new Set(Object.values(raw).flat())]
  assert.ok(sections.length >= 14)
  const labels = new Set(Object.keys(categorize.CATEGORY_LABELS))
  for (const section of sections) {
    const key = categorize.classifyPlugin({ owner: 'probe', name: 'probe', description: { en: '' } }, { 'probe/probe': section })
    assert.ok(labels.has(key), `section "${section}" resolved to unknown key "${key}"`)
  }
})

test('classifyPlugin returns other for an unknown awesome section', () => {
  assert.equal(categorize.classifyPlugin(
    { owner: 'x', name: 'y', description: {} },
    { 'x/y': 'Some Future Section' },
  ), 'other')
})
