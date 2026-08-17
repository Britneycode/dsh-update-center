/**
 * 维护本仓库根目录的 plugins.json 注册表（像 awesome-dsh-plugin 一样对外提供）：
 *   plugins.json —— 已有注册表（若存在）作为基底累计合并 GitHub topic:dsh-plugin
 *     星标前 500（排除 fork）+ 本插件自身，按 owner/name 去重：掉出扫描窗口
 *     的老条目保留，新条目追加，已知条目刷新星标。
 *   data/registry-snapshot.json —— 同一份数据的随包离线快照。
 *   data/extra-plugins.json —— 常驻条目（加载时无条件合并，保证 0 星新插件可见）。
 *
 * 运行：npm run refresh:snapshot（需网络可达 api.github.com）
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRegistryFromRepos, mergeGithubTopic } from '../src/github-topic.mjs'
import { applyNpmMapping } from '../src/npm-mapping.mjs'
import { applyCategories, flattenAwesomeMap } from '../src/categorize.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SELF_REPO = 'Britneycode/dsh-update-center'
const TOPIC_PAGES = 5
const MAX_ENTRIES = 2000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchJson(url, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-update-center/refresh-snapshot' },
    })
    if (response.ok) return response.json()
    // GitHub 未认证搜索配额 10 次/分钟：403/429 时按 retry-after / x-ratelimit-reset 等待后重试
    if ((response.status === 403 || response.status === 429) && attempt < retries) {
      const retryAfter = Number(response.headers.get('retry-after'))
      const reset = Number(response.headers.get('x-ratelimit-reset'))
      const wait = retryAfter > 0
        ? retryAfter * 1000
        : reset > 0
          ? Math.max(0, reset * 1000 - Date.now()) + 1000
          : 15_000
      await sleep(Math.min(wait, 60_000))
      continue
    }
    throw new Error(`${response.status} ${url}`)
  }
}

async function fetchGithubTopicRepos() {
  const repos = []
  for (let page = 1; page <= TOPIC_PAGES; page++) {
    if (page > 1) await sleep(1100) // 避免突发请求触发 GitHub 次级限流
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

async function loadExistingRegistry() {
  try {
    const data = JSON.parse(await readFile(join(root, 'plugins.json'), 'utf8'))
    if (Array.isArray(data?.plugins) && data.plugins.length) return data
  } catch { /* 首次生成时没有存量 */ }
  return null
}

async function fetchNpmSearchObjects() {
  const objects = []
  for (let from = 0; from < 1000; from += 250) {
    if (from > 0) await sleep(600)
    const url = new URL('https://registry.npmjs.org/-/v1/search')
    url.searchParams.set('text', 'keywords:dsh-plugin')
    url.searchParams.set('size', '250')
    url.searchParams.set('from', String(from))
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error(`endpoint check failed: ${url.host}`)
    const payload = await fetchJson(url)
    const items = Array.isArray(payload?.objects) ? payload.objects : []
    if (!items.length) break
    objects.push(...items)
    if (from + items.length >= Number(payload?.total ?? 0)) break
  }
  return objects
}

const topicRepos = await fetchGithubTopicRepos()
if (!topicRepos.length) throw new Error('GitHub topic scan returned nothing')
const selfRepo = await fetchJson(`https://api.github.com/repos/${SELF_REPO}`)
if (!selfRepo?.name) throw new Error('self repo info invalid')

const existing = await loadExistingRegistry()
const data = existing ?? buildRegistryFromRepos(topicRepos)
const bundledExtras = JSON.parse(await readFile(join(root, 'data', 'extra-plugins.json'), 'utf8'))
const pinnedRepos = [
  ...bundledExtras.filter((repo) => repo?.full_name !== SELF_REPO),
  selfRepo,
]
const merged = mergeGithubTopic(data, [...topicRepos, ...pinnedRepos])
const awesomeMap = flattenAwesomeMap(JSON.parse(await readFile(join(root, 'data', 'awesome-categories.json'), 'utf8')))
const { bySource } = applyCategories(data, awesomeMap)
const npmObjects = await fetchNpmSearchObjects()
const mapped = applyNpmMapping(data, npmObjects)
if (data.plugins.length > MAX_ENTRIES) {
  data.plugins.sort((a, b) => Number(b.stars ?? 0) - Number(a.stars ?? 0))
  data.plugins = data.plugins.slice(0, MAX_ENTRIES)
}
data.updated = new Date().toISOString().slice(0, 10)
data.count = data.plugins.length

const text = JSON.stringify(data, null, 1) + '\n'
await writeFile(join(root, 'plugins.json'), text, 'utf8')
await writeFile(join(root, 'data', 'registry-snapshot.json'), text, 'utf8')
await writeFile(join(root, 'data', 'extra-plugins.json'), JSON.stringify(pinnedRepos, null, 1) + '\n', 'utf8')
const base = existing ? `存量 ${existing.plugins.length}` : '新建'
console.log(`plugins.json 已生成：${base} + 本轮扫描新增 ${merged.added}（含去重）+ npm 映射 ${mapped} = 共 ${data.plugins.length} 条（上限 ${MAX_ENTRIES}）`)
console.log(`分类来源：awesome 清单 ${bySource.awesome} / 关键词 ${bySource.keyword} / 未分类 ${bySource.other}`)
