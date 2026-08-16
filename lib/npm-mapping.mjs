/**
 * npm 包名映射（纯函数，供服务端、快照脚本与测试复用）。
 *
 * 用 npm registry 的关键词搜索（keywords:dsh-plugin）反查每个包的 repository
 * 地址，与市场条目按 GitHub owner/name 匹配——映射仅当仓库地址一致时建立，
 * 天然防止包名抢注。命中的条目获得 npm 安装路径（秒级安装，无需构建脚本）。
 */

const GITHUB_REPO_RE = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i

/** 从 repository URL 提取 owner/repo（仅 GitHub 形态），失败返回 null。 */
export function extractOwnerRepo(url) {
  if (typeof url !== 'string') return null
  const match = GITHUB_REPO_RE.exec(url.trim())
  return match ? `${match[1]}/${match[2]}` : null
}

/**
 * 用 npm 搜索结果（/-/v1/search 的 objects）给市场条目补 npm 包名：
 * 命中的条目更新 npm 字段与 install 命令（改为 npm 安装路径）。
 * 同一仓库出现多个包时取第一个结果。返回映射成功的条目数。
 */
export function applyNpmMapping(data, searchObjects) {
  const byRepo = new Map()
  for (const object of Array.isArray(searchObjects) ? searchObjects : []) {
    const pkg = object?.package
    if (typeof pkg?.name !== 'string') continue
    const ownerRepo = extractOwnerRepo(pkg?.links?.repository)
    if (!ownerRepo) continue
    const key = ownerRepo.toLowerCase()
    if (!byRepo.has(key)) byRepo.set(key, pkg.name)
  }
  let mapped = 0
  for (const entry of Array.isArray(data?.plugins) ? data.plugins : []) {
    if (!entry?.owner || !entry?.name) continue
    const npmName = byRepo.get(`${String(entry.owner)}/${String(entry.name)}`.toLowerCase())
    if (!npmName || entry.npm === npmName) continue
    entry.npm = npmName
    entry.install = `dsh plugin --profile web add ${npmName}`
    mapped += 1
  }
  return mapped
}
