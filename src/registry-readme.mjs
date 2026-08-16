/**
 * awesome-dsh-plugin 仓库 README 的降级解析器。
 *
 * 官方 plugins.json 由 CI 生成到 awesome-dsh-plugin.com；网站不可用时，
 * 从 GitHub raw 拉取仓库 README 解析策展清单（条目字段少于完整清单：
 * 无 npm 映射、无星标，但保留名称/仓库/分类/描述，安装走 github: 路径）。
 */

const ENTRY_RE = /^\s*[-*]\s*\[([^\]]+)\]\(https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?\)\s*(?:[-—–:]\s*)?(.*)$/
const HEADING_RE = /^##\s+(.+?)\s*$/

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'misc'
}

/**
 * 解析 awesome 清单 Markdown 为 registry 形状的对象。
 * 识别 `## 标题`（分类）与 `- [名](https://github.com/owner/repo) - 描述`（条目）。
 * @returns {null | {name: string, updated: string, count: number, categories: Object, plugins: Array<Object>}}
 */
export function parseAwesomeReadme(text) {
  if (typeof text !== 'string' || !text.includes('github.com')) return null
  const categories = {}
  const plugins = []
  const seen = new Set()
  let currentTitle = ''
  let currentKey = ''
  for (const rawLine of String(text).split(/\r?\n/)) {
    const heading = HEADING_RE.exec(rawLine)
    if (heading) {
      currentTitle = heading[1].replace(/[|`]/g, '').trim()
      currentKey = slugify(currentTitle)
      if (!categories[currentKey]) categories[currentKey] = { en: currentTitle, zh: currentTitle }
      continue
    }
    const entry = ENTRY_RE.exec(rawLine)
    if (!entry) continue
    const [, linkText, owner, repo, description] = entry
    const name = repo
    const key = `${owner}/${repo}`
    if (seen.has(key)) continue
    seen.add(key)
    const notes = String(description ?? '').trim()
    const label = linkText.trim()
    plugins.push({
      name,
      owner,
      url: `https://github.com/${owner}/${repo}`,
      page: '',
      category: currentKey,
      description: {
        en: label && label !== name && notes ? `${label} — ${notes}` : (notes || label || ''),
        zh: '',
      },
      npm: null,
      stars: 0,
      install: `dsh plugin --profile web add github:${owner}/${repo}`,
      added: '',
    })
  }
  if (plugins.length < 3) return null
  return {
    name: 'awesome-dsh-plugin',
    url: 'https://awesome-dsh-plugin.com',
    source: 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
    updated: '',
    count: plugins.length,
    categories,
    plugins,
  }
}
