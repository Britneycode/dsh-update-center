import assert from 'node:assert/strict'
import test from 'node:test'

const reader = await import('../src/registry-readme.mjs').catch(() => ({}))

const SAMPLE_README = [
  '# Awesome DSH Plugin',
  '',
  'A curated list of plugins for DeepSeek Harness.',
  '',
  '## UI Enhancements',
  '',
  '- [DSH-Right-Sidebar](https://github.com/Limitinfinite/DSH-Right-Sidebar) - DSH Web right-side output dock',
  '- [dsh-explorer](https://github.com/No-PRM/dsh-explorer) — Git-first file-tree sidebar',
  '* [widget](https://github.com/someone/widget): star bullet with colon separator',
  '  - [indented](https://github.com/someone/indented) - indented entry still counts',
  '- not a plugin line without link',
  '- [broken](https://gitlab.com/someone/broken) - non-github host skipped',
  '',
  '## Themes & Appearance',
  '',
  '- [dsh-theme-plain](https://github.com/a/dsh-theme-plain) - plain theme',
  '- [DSH-Right-Sidebar](https://github.com/Limitinfinite/DSH-Right-Sidebar) - duplicate by owner/repo skipped',
  '',
  '## unrelated-heading-without-plugins',
  '',
  'nothing here',
].join('\n')

test('parses headings into categories and entries into plugins', () => {
  const data = reader.parseAwesomeReadme(SAMPLE_README)
  assert.ok(data)
  assert.equal(data.name, 'awesome-dsh-plugin')
  assert.equal(data.plugins.length, 5)
  assert.equal(data.plugins[0].name, 'DSH-Right-Sidebar')
  assert.equal(data.plugins[0].owner, 'Limitinfinite')
  assert.equal(data.plugins[0].url, 'https://github.com/Limitinfinite/DSH-Right-Sidebar')
  assert.equal(data.plugins[0].category, 'ui-enhancements')
  assert.equal(data.plugins[0].npm, null)
  assert.equal(data.plugins[0].install, 'dsh plugin --profile web add github:Limitinfinite/DSH-Right-Sidebar')
})

test('uses the em-dash and colon separators and deduplicates by owner/repo', () => {
  const data = reader.parseAwesomeReadme(SAMPLE_README)
  const explorer = data.plugins.find((entry) => entry.name === 'dsh-explorer')
  assert.equal(explorer.description.en, 'Git-first file-tree sidebar')
  const widget = data.plugins.find((entry) => entry.name === 'widget')
  assert.equal(widget.description.en, 'star bullet with colon separator')
  const duplicates = data.plugins.filter((entry) => entry.name === 'DSH-Right-Sidebar')
  assert.equal(duplicates.length, 1)
})

test('skips non-github links and lines without links', () => {
  const data = reader.parseAwesomeReadme(SAMPLE_README)
  assert.equal(data.plugins.some((entry) => entry.owner === 'someone' && entry.name === 'broken'), false)
  assert.equal(data.plugins.some((entry) => entry.name === 'not a plugin line without link'), false)
})

test('assigns entries under the closest heading and keeps empty headings out of plugins', () => {
  const data = reader.parseAwesomeReadme(SAMPLE_README)
  const theme = data.plugins.find((entry) => entry.name === 'dsh-theme-plain')
  assert.equal(theme.category, 'themes-appearance')
  assert.ok(data.categories['ui-enhancements'])
  assert.ok(data.categories['themes-appearance'])
})

test('returns null for non-markdown or too-small input', () => {
  assert.equal(reader.parseAwesomeReadme(''), null)
  assert.equal(reader.parseAwesomeReadme('no github links here\n- plain'), null)
  assert.equal(reader.parseAwesomeReadme(null), null)
})
