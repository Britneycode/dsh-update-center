#!/usr/bin/env node
/**
 * 按功能重分类仓库根 plugins.json（awesome 清单映射 + 关键词兜底）。
 *
 * 用法：
 *   node scripts/classify-categories.mjs           # 预览（不写盘）
 *   node scripts/classify-categories.mjs --write   # 应用到 plugins.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyCategories, CATEGORY_LABELS, flattenAwesomeMap } from '../src/categorize.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const write = process.argv.includes('--write')

const registryPath = join(root, 'plugins.json')
const data = JSON.parse(readFileSync(registryPath, 'utf8'))
const awesomeRaw = JSON.parse(readFileSync(join(root, 'data', 'awesome-categories.json'), 'utf8'))
const awesomeMap = flattenAwesomeMap(awesomeRaw)

const { counts, bySource } = applyCategories(data, awesomeMap)

console.log(`分类来源：awesome 清单 ${bySource.awesome} / 关键词 ${bySource.keyword} / 未分类 ${bySource.other}（共 ${data.plugins.length}）`)
for (const [key, label] of Object.entries(CATEGORY_LABELS)) {
  console.log(`  ${String(counts[key] ?? 0).padStart(4)}  ${label.zh} (${label.en})`)
}

if (!write) {
  const others = data.plugins.filter((p) => p.category === 'other').slice(0, 30)
  console.log('\n未分类样例（前 30）：')
  for (const p of others) console.log(`  ${p.owner}/${p.name} :: ${(p.description?.en || p.description?.zh || '').slice(0, 70)}`)
  console.log('\n（预览模式，加 --write 写入 plugins.json）')
} else {
  data.updated = new Date().toISOString().slice(0, 10)
  writeFileSync(registryPath, JSON.stringify(data, null, 1) + '\n')
  console.log(`\n已写入 ${registryPath}`)
}
