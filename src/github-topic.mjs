/**
 * GitHub topic 扫描的条目转换与清单合并（纯函数，供服务端与测试复用）。
 *
 * GitHub 上带 dsh-plugin 话题的仓库远多于官方策展清单；扫描结果与清单按
 * owner/name 去重合并：已知条目仅刷新星标，新条目进入「GitHub 发现」分类。
 */

export function githubRepoToEntry(repo) {
  const owner = repo?.owner?.login ?? ''
  const name = repo?.name ?? ''
  const description = typeof repo?.description === 'string' ? repo.description : ''
  return {
    name,
    owner,
    url: typeof repo?.html_url === 'string' ? repo.html_url : `https://github.com/${owner}/${name}`,
    page: '',
    category: 'github',
    description: { en: description, zh: '' },
    npm: null,
    stars: Number(repo?.stargazers_count ?? 0),
    install: owner && name ? `dsh plugin --profile web add github:${owner}/${name}` : '',
    added: typeof repo?.pushed_at === 'string' ? repo.pushed_at.slice(0, 10) : '',
  }
}

/**
 * 把 GitHub 扫描结果合并进 registry 数据（原地修改）。
 * 匹配键为 owner/name（忽略大小写）；已知条目只更新星标，新条目追加并标记
 * github 分类。返回 { added, starsUpdated }。
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
    if (!entry.owner || !entry.name || !entry.install) continue
    const key = `${entry.owner.toLowerCase()}/${entry.name.toLowerCase()}`
    const known = index.get(key)
    if (known) {
      if (entry.stars > Number(known.stars ?? 0)) {
        known.stars = entry.stars
        starsUpdated += 1
      }
      continue
    }
    data.plugins.push(entry)
    index.set(key, entry)
    added += 1
  }
  if (added > 0) {
    const categories = { ...(data.categories ?? {}) }
    if (!categories.github) categories.github = { en: 'GitHub discovered', zh: 'GitHub 发现' }
    data.categories = categories
  }
  data.githubExtra = added
  return { added, starsUpdated }
}
