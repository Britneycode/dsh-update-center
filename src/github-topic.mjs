/**
 * GitHub topic 扫描的条目转换、清单构建与合并（纯函数，供服务端与测试复用）。
 *
 * 市场数据源为 GitHub 上带 dsh-plugin 话题的仓库（按星标降序取前若干）；
 * 扫描结果构造成 registry 形状，常驻条目按 owner/name 去重并入。
 */

import { CATEGORY_LABELS, classifyPlugin } from './categorize.mjs'

export function githubRepoToEntry(repo) {
  const owner = repo?.owner?.login ?? ''
  const name = repo?.name ?? ''
  const description = typeof repo?.description === 'string' ? repo.description : ''
  const manualInstall = repo?.installMode === 'manual'
  const entry = {
    name,
    owner,
    url: typeof repo?.html_url === 'string' ? repo.html_url : `https://github.com/${owner}/${name}`,
    page: '',
    category: 'other',
    description: {
      en: description,
      zh: typeof repo?.descriptionZh === 'string' ? repo.descriptionZh : '',
    },
    npm: null,
    stars: Number(repo?.stargazers_count ?? 0),
    install: !manualInstall && owner && name ? `dsh plugin --profile web add github:${owner}/${name}` : '',
    added: typeof repo?.pushed_at === 'string' ? repo.pushed_at.slice(0, 10) : '',
    ...(manualInstall ? {
      installMode: 'manual',
      manualNote: typeof repo?.manualNote === 'string' ? repo.manualNote : '',
    } : {}),
  }
  entry.category = classifyPlugin(entry)
  return entry
}

/**
 * 把 GitHub 扫描结果合并进 registry 数据（原地修改）。
 * 匹配键为 owner/name（忽略大小写）；已知条目只更新星标，新条目按功能分类
 * 追加。返回 { added, starsUpdated }。
 */
export function mergeGithubTopic(data, repos) {
  if (!data || !Array.isArray(data.plugins) || !Array.isArray(repos)) return { added: 0, starsUpdated: 0 }
  const index = new Map(data.plugins.map((plugin) => [
    `${String(plugin.owner ?? '').toLowerCase()}/${String(plugin.name ?? '').toLowerCase()}`,
    plugin,
  ]))
  let added = 0
  let starsUpdated = 0
  for (const repo of repos) {
    const entry = githubRepoToEntry(repo)
    if (!entry.owner || !entry.name || (!entry.install && entry.installMode !== 'manual')) continue
    const key = `${entry.owner.toLowerCase()}/${entry.name.toLowerCase()}`
    const known = index.get(key)
    if (known) {
      if (entry.stars > Number(known.stars ?? 0)) {
        known.stars = entry.stars
        starsUpdated += 1
      }
      if (entry.installMode === 'manual') {
        known.install = ''
        known.installMode = 'manual'
        known.manualNote = entry.manualNote
        if (entry.description?.zh) known.description = entry.description
      }
      continue
    }
    data.plugins.push(entry)
    index.set(key, entry)
    added += 1
  }
  if (added > 0) data.categories = { ...CATEGORY_LABELS }
  data.githubExtra = added
  return { added, starsUpdated }
}

/** 把 GitHub 扫描结果构建成完整 registry 形状（按功能分类，星标降序）。 */
export function buildRegistryFromRepos(repos) {
  const entries = (Array.isArray(repos) ? repos : [])
    .filter((repo) => repo && repo.fork !== true)
    .map(githubRepoToEntry)
    .filter((entry) => entry.owner && entry.name && entry.install)
    .sort((a, b) => Number(b.stars ?? 0) - Number(a.stars ?? 0))
  return {
    name: 'dsh-plugin-topic',
    url: 'https://github.com/search?q=topic%3Adsh-plugin',
    source: 'GitHub topic:dsh-plugin',
    updated: new Date().toISOString().slice(0, 10),
    count: entries.length,
    categories: { ...CATEGORY_LABELS },
    plugins: entries,
  }
}
