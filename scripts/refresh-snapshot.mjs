/**
 * 重新生成随包分发的市场清单快照（纯 GitHub 数据源）：
 *   data/registry-snapshot.json —— GitHub topic:dsh-plugin 星标前 500（排除
 *     fork）+ 本插件自身，作为离线兜底数据源；
 *   data/extra-plugins.json —— 常驻条目（GitHub repo 形状，加载时无条件合并，
 *     保证 0 星的新插件不出现在扫描窗口时市场里仍然可见）。
 *
 * 运行：npm run refresh:snapshot（需网络可达 api.github.com）
 */
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistryFromRepos, mergeGithubTopic } from '../src/github-topic.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF_REPO = 'Britneycode/dsh-update-center'
const TOPIC_PAGES = 5

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}

async function fetchGithubTopicRepos() {
  const repos = []
  for (let page = 1; page <= TOPIC_PAGES; page++) {
    const url = new URL('https://api.github.com/search/repositories')
    url.searchParams.set('q', 'topic:dsh-plugin')
    url.searchParams.set('sort', 'stars')
    url.searchParams.set('order', 'desc')
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))
    if (url.protocol !== 'https:' || url.hostname !== 'api.github.com') throw new Error(`endpoint check failed: ${url.host}`)
    const payload = await fetchJson(url)
    if (!Array.isArray(payload?.items)) break
    repos.push(...payload.items.filter((repo) => repo && repo.fork !== true))
    if (payload.items.length < 100) break
  }
  return repos
}

const topicRepos = await fetchGithubTopicRepos()
if (!topicRepos.length) throw new Error('GitHub topic scan returned nothing')
const selfRepo = await fetchJson(`https://api.github.com/repos/${SELF_REPO}`)
if (!selfRepo?.name) throw new Error('self repo info invalid')

const data = buildRegistryFromRepos(topicRepos)
mergeGithubTopic(data, [selfRepo])

await writeFile(
  join(root, 'data', 'registry-snapshot.json'),
  JSON.stringify(data, null, 1) + '\n',
  'utf8',
)
await writeFile(
  join(root, 'data', 'extra-plugins.json'),
  JSON.stringify([selfRepo], null, 1) + '\n',
  'utf8',
)
console.log(`快照已生成：GitHub 主题 ${topicRepos.length} + 本插件 = 共 ${data.plugins.length} 条；常驻条目 1 个`)
