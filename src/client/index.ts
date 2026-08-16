/**
 * @dsh-external/dsh-update-center 设置页面板。
 *
 * 同源 API 提供状态、检查、更新、市场（安装/卸载/禁用）动作；React 组件只负责
 * 面板挂载，界面使用原生 DOM，避免把宿主的 React 运行时打进插件 bundle。
 * 市场数据来自 awesome-dsh-plugin.com 清单（服务端白名单拉取，本地快照兜底）。
 */
import { createElement, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = {
  slots: SlotsService
}

type MessageKind = 'ok' | 'info' | 'err'
type BadgeKind = 'ok' | 'warn' | 'err' | 'muted' | 'update'

export const inject = ['slots']

const API = '/update-center/api'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (cls) element.className = cls
  if (text !== void 0) element.textContent = text
  return element
}

const styles = `
.uc-page{font-family:inherit;font-size:13px;line-height:1.5;width:min(100%,920px);min-width:0;overflow:hidden;padding:8px 4px 24px;color:var(--dsw-alias-label-primary)}
.uc-toolbar,.uc-section-head,.uc-row-main,.uc-meta,.uc-actions{display:flex;align-items:center}
.uc-toolbar{justify-content:space-between;gap:12px;padding:4px 0 16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.uc-toolbar h2{font-size:16px;line-height:1.3;margin:0;letter-spacing:0}
.uc-summary{color:var(--dsw-alias-label-tertiary);font-size:12px}
.uc-tabs{display:flex;gap:4px;padding:12px 0 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.uc-tab{border:1px solid transparent;border-bottom:0;border-radius:6px 6px 0 0;padding:6px 14px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.uc-tab.active{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-weight:600}
.uc-section{padding:18px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.uc-section-head{justify-content:space-between;gap:12px;margin-bottom:10px}
.uc-section h3{font-size:13px;line-height:1.4;margin:0;letter-spacing:0}
.uc-repo-row{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:16px;align-items:center}
.uc-row-main{gap:8px;min-width:0;flex-wrap:wrap}
.uc-version{font-weight:650}
.uc-meta{gap:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;min-width:0;flex-wrap:wrap}
.uc-path{display:block;min-width:0;max-width:460px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.uc-actions{gap:8px;justify-content:flex-end;flex-wrap:wrap}
.uc-btn{min-height:32px;border:1px solid transparent;border-radius:6px;padding:6px 12px;background:#2878d0;color:#fff;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.uc-btn.secondary{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.uc-btn.danger{background:transparent;border-color:rgba(210,58,58,.45);color:#d23a3a}
.uc-btn:disabled{opacity:.45;cursor:not-allowed}
.uc-badge,.uc-tag{display:inline-flex;align-items:center;min-height:20px;border-radius:4px;padding:1px 7px;font-size:10px;line-height:1.4;white-space:nowrap}
.uc-badge.ok{background:rgba(39,174,96,.14);color:#28945a}
.uc-badge.warn{background:rgba(224,166,22,.16);color:#a87800}
.uc-badge.err{background:rgba(210,58,58,.13);color:#d23a3a}
.uc-badge.muted{background:var(--dsw-alias-bg-multi-select);color:var(--dsw-alias-label-tertiary)}
.uc-badge.update{background:rgba(40,120,208,.14);color:#2878d0}
.uc-list{list-style:none;margin:0;padding:0}
.uc-item{display:grid;grid-template-columns:minmax(220px,1fr) minmax(130px,auto) auto;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--dsw-alias-border-l2)}
.uc-item>*{min-width:0}
.uc-item:first-child{border-top:0}
.uc-name{font-weight:600;overflow-wrap:anywhere}
.uc-desc{color:var(--dsw-alias-label-secondary);font-size:12px;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.uc-tags{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:3px}
.uc-tag{background:var(--dsw-alias-bg-multi-select);color:var(--dsw-alias-label-secondary)}
.uc-tag.npm{background:rgba(40,120,208,.12);color:#2878d0}
.uc-tag.link{background:rgba(39,174,96,.12);color:#28945a}
.uc-tag.preset{background:rgba(151,89,182,.13);color:#9858b4}
.uc-status{display:flex;gap:6px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
.uc-empty{padding:14px 0;color:var(--dsw-alias-label-tertiary)}
.uc-market-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:14px 0}
.uc-input,.uc-select{min-height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 10px}
.uc-input{flex:1 1 200px;min-width:160px}
.uc-select{flex:0 0 auto}
.uc-market-meta{width:100%;color:var(--dsw-alias-label-tertiary);font-size:11px}
.uc-msg{margin-top:14px;padding:10px 12px;border-left:3px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);white-space:pre-wrap;max-height:260px;overflow:auto;font-size:12px}
.uc-msg.ok{border-color:#28945a}
.uc-msg.err{border-color:#d23a3a}
.uc-msg.info{border-color:#2878d0}
@media(max-width:680px){
  [class$="_panel"]:has(.uc-page)>nav{width:52px!important;flex-basis:52px!important;padding-inline:6px!important}
  [class$="_panel"]:has(.uc-page)>nav [class$="_navTitle"]{display:none!important}
  [class$="_panel"]:has(.uc-page)>nav [class$="_navCell"]{width:40px!important;min-width:40px!important;justify-content:center!important;padding-inline:0!important}
  [class$="_panel"]:has(.uc-page)>nav [class$="_navLabel"]{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
  .uc-toolbar{align-items:flex-start;flex-direction:column}
  .uc-section-head{align-items:flex-start;flex-wrap:wrap}
  .uc-repo-row,.uc-item{grid-template-columns:1fr}
  .uc-actions,.uc-status{justify-content:flex-start}
  .uc-path{width:100%;max-width:100%}
}
`

async function fetchJson(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(API + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`)
  return data
}

function buildPanel(): HTMLElement {
  const style = el('style')
  style.textContent = styles

  const page = el('div', 'uc-page')
  page.append(style)

  const toolbar = el('div', 'uc-toolbar')
  const heading = el('div')
  heading.append(el('h2', undefined, '更新中心'))
  const summary = el('div', 'uc-summary', '正在读取本地状态…')
  heading.append(summary)
  const checkButton = el('button', 'uc-btn secondary', '检查更新')
  checkButton.type = 'button'
  const updateAllButton = el('button', 'uc-btn', '全部更新')
  updateAllButton.type = 'button'
  updateAllButton.disabled = true
  const toolbarActions = el('div', 'uc-actions')
  toolbarActions.append(checkButton, updateAllButton)
  toolbar.append(heading, toolbarActions)

  // ── Tab 切换：已安装 / 插件市场 ──
  const tabs = el('div', 'uc-tabs')
  const installedTab = el('button', 'uc-tab active', '已安装')
  installedTab.type = 'button'
  const marketTab = el('button', 'uc-tab', '插件市场')
  marketTab.type = 'button'
  tabs.append(installedTab, marketTab)

  const installedView = el('div')

  const repoSection = el('section', 'uc-section')
  const repoHead = el('div', 'uc-section-head')
  repoHead.append(el('h3', undefined, 'dsh 本体'))
  const repoBadge = badge('未检查', 'muted')
  repoHead.append(repoBadge)
  const repoContent = el('div')
  repoSection.append(repoHead, repoContent)

  const pluginSection = el('section', 'uc-section')
  const pluginHead = el('div', 'uc-section-head')
  pluginHead.append(el('h3', undefined, '已安装插件'))
  const pluginCount = badge('0 个', 'muted')
  pluginHead.append(pluginCount)
  const pluginList = el('ul', 'uc-list')
  pluginSection.append(pluginHead, pluginList)
  installedView.append(repoSection, pluginSection)

  // ── 市场视图 ──
  const marketView = el('div')
  marketView.style.display = 'none'
  const marketSection = el('section', 'uc-section')
  const marketHead = el('div', 'uc-market-head')
  const searchInput = el('input', 'uc-input')
  searchInput.type = 'search'
  searchInput.placeholder = '搜索插件名 / 作者 / 描述…'
  const categorySelect = el('select', 'uc-select')
  const sortSelect = el('select', 'uc-select')
  const sortStars = el('option', undefined, '星标最多')
  sortStars.value = 'stars'
  const sortDefault = el('option', undefined, '默认顺序')
  sortDefault.value = 'default'
  const sortAdded = el('option', undefined, '最近添加')
  sortAdded.value = 'added'
  sortSelect.append(sortStars, sortDefault, sortAdded)
  sortSelect.value = 'stars'
  const refreshButton = el('button', 'uc-btn secondary', '刷新清单')
  refreshButton.type = 'button'
  const marketMeta = el('div', 'uc-market-meta', '尚未加载市场清单')
  marketHead.append(searchInput, categorySelect, sortSelect, refreshButton, marketMeta)
  const marketList = el('ul', 'uc-list')
  marketSection.append(marketHead, marketList)
  marketView.append(marketSection)

  const message = el('div', 'uc-msg')
  message.style.display = 'none'
  page.append(toolbar, tabs, installedView, marketView, message)

  const buttons = new Set<HTMLButtonElement>([checkButton, updateAllButton])
  let checked = false
  let activeJobId = ''
  let marketData: any = null
  let marketQuery = ''
  let marketCategory = ''
  let marketSort = 'stars'
  let lastStatusData: any = null

  /** 已安装插件里有多少项可更新（用于“全部更新”按钮态）。 */
  function pluginUpdateCount(plugins: any[]): number {
    return plugins.filter((plugin) => {
      const git = plugin.git ?? {}
      return (plugin.kind === 'npm' && plugin.latest && plugin.latest !== plugin.version)
        || ((plugin.kind === 'link' || plugin.kind === 'preset') && Number(git.behind) > 0 && !git.dirty)
    }).length
  }

  /** 市场清单里与某个已安装依赖对应的条目（npm 名或仓库名匹配）。 */
  function marketEntryFor(name: string): any | null {
    const plugins: any[] = Array.isArray(marketData?.plugins) ? marketData.plugins : []
    return plugins.find((entry) => entry.name === name || (entry.npm && entry.npm === name)) ?? null
  }

  function externalLink(text: string, url: string): HTMLAnchorElement {
    const link = el('a', 'uc-meta', text)
    link.href = url
    link.target = '_blank'
    link.rel = 'noreferrer'
    return link
  }

  function badge(text: string, kind: BadgeKind): HTMLSpanElement {
    return el('span', 'uc-badge ' + kind, text)
  }

  function say(text: string, kind: MessageKind = 'info'): void {
    message.textContent = text
    message.style.display = text ? 'block' : 'none'
    message.className = 'uc-msg ' + kind
  }

  function setBusy(active: boolean, activeButton?: HTMLButtonElement, label?: string): void {
    for (const button of buttons) {
      if (!button.isConnected) {
        buttons.delete(button)
        continue
      }
      if (active) {
        button.dataset.disabledBeforeBusy = button.disabled ? '1' : '0'
        button.disabled = true
      } else if (button.dataset.disabledBeforeBusy) {
        button.disabled = button.dataset.disabledBeforeBusy === '1'
        delete button.dataset.disabledBeforeBusy
      }
    }
    if (!activeButton) return
    if (active) {
      activeButton.dataset.originalLabel = activeButton.textContent ?? ''
      if (label) activeButton.textContent = label
    } else if (activeButton.dataset.originalLabel) {
      activeButton.textContent = activeButton.dataset.originalLabel
      delete activeButton.dataset.originalLabel
    }
  }

  function actionButton(label: string, variant: 'primary' | 'secondary' | 'danger' = 'primary'): HTMLButtonElement {
    const cls = variant === 'primary' ? 'uc-btn' : `uc-btn ${variant}`
    const button = el('button', cls, label)
    button.type = 'button'
    buttons.add(button)
    return button
  }

  function updateSummary(data: any): void {
    if (data?.job?.status === 'queued' || data?.job?.status === 'running') {
      summary.textContent = `后台更新中 · ${String(data.job.message || data.job.stage || '')}`
      return
    }
    if (!checked) {
      summary.textContent = '本地状态已载入，点击“检查更新”获取远端状态'
      return
    }
    const total = Number(data?.summary?.totalUpdates ?? 0)
    const time = data?.ts ? new Date(data.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    summary.textContent = total > 0 ? `发现 ${total} 项可更新 · ${time}` : `全部为最新 · ${time}`
  }

  function jobText(job: any): string {
    const lines = [String(job?.message || '更新任务')]
    if (Array.isArray(job?.steps)) lines.push(...job.steps.map(String))
    if (job?.error) lines.push(String(job.error))
    return lines.filter(Boolean).join('\n')
  }

  function pollJob(id: string, activeButton?: HTMLButtonElement): void {
    activeJobId = id
    fetchJson('/job?id=' + encodeURIComponent(id))
      .then((data) => {
        const job = data?.job
        if (!job) throw new Error('更新任务不存在')
        if (job.status === 'queued' || job.status === 'running') {
          say(jobText(job), 'info')
          if (page.isConnected) window.setTimeout(() => pollJob(id, activeButton), 1000)
          return
        }
        activeJobId = ''
        checked = false
        return refreshStatus(false, true).then(() => {
          if (marketData) void loadMarket(false, true)
          setBusy(false, activeButton)
          if (job.status === 'completed') {
            const suffix = job.restartRequired ? '\n\n更新已核验完成，现在可以重启 dsh web。' : ''
            say(jobText(job) + suffix, 'ok')
          } else {
            say(jobText(job), 'err')
          }
        })
      })
      .catch((error) => {
        if (!page.isConnected) return
        say('暂时无法读取更新进度，dsh 重启后会从磁盘恢复任务状态：' + String(error), 'info')
        window.setTimeout(() => pollJob(id, activeButton), 1500)
      })
  }

  function resumeJob(job: any): void {
    if (!job?.id || activeJobId === job.id) return
    if (job.status === 'queued' || job.status === 'running') {
      setBusy(true)
      pollJob(String(job.id))
    }
  }

  /** 统一动作绑定：POST 后要么直接返回结果（disable/enable），要么轮询 job。 */
  function bindAction(button: HTMLButtonElement, path: string, body: Record<string, unknown>, confirmation: string, startingNote: string): void {
    button.addEventListener('click', () => {
      if (!window.confirm(confirmation)) return
      setBusy(true, button, '处理中…')
      say(startingNote, 'info')
      fetchJson(path, { method: 'POST', body: JSON.stringify(body) })
        .then((data) => {
          if (!data?.ok) throw new Error(data?.result || data?.error || '操作失败')
          const id = String(data?.job?.id || '')
          if (!id) {
            setBusy(false, button)
            say(String(data?.result || '操作成功'), 'ok')
            return refreshStatus(false, true).then(() => {
              if (marketData) void loadMarket(false, true)
            })
          }
          button.textContent = '后台执行中…'
          pollJob(id, button)
        })
        .catch((error) => {
          setBusy(false, button)
          say('请求失败：' + String(error), 'err')
        })
    })
  }

  function renderRepo(repo: any): void {
    repoContent.textContent = ''
    const git = repo?.git ?? {}
    const row = el('div', 'uc-repo-row')
    const info = el('div')
    const main = el('div', 'uc-row-main')
    main.append(el('span', 'uc-version', String(repo?.version || '未知版本')))
    if (git.head) main.append(el('span', 'uc-meta', String(git.head)))
    if (git.branch) main.append(el('span', 'uc-tag', String(git.branch)))
    info.append(main)
    const meta = el('div', 'uc-meta')
    if (repo?.path) meta.append(el('span', 'uc-path', String(repo.path)))
    if (git.ahead > 0) meta.append(el('span', undefined, `本地领先 ${git.ahead}`))
    info.append(meta)

    repoBadge.className = 'uc-badge muted'
    repoBadge.textContent = checked ? '状态未知' : '未检查'
    if (repo?.error) {
      repoBadge.className = 'uc-badge err'
      repoBadge.textContent = '仓库不可用'
    } else if (git.dirty) {
      repoBadge.className = 'uc-badge warn'
      repoBadge.textContent = '有未提交改动'
    } else if (checked && repo?.fetchOk === false) {
      repoBadge.className = 'uc-badge err'
      repoBadge.textContent = '检查失败'
    } else if (checked && git.behind > 0) {
      repoBadge.className = 'uc-badge update'
      repoBadge.textContent = `落后 ${git.behind} 个提交`
    } else if (checked && typeof git.behind === 'number') {
      repoBadge.className = 'uc-badge ok'
      repoBadge.textContent = '已是最新'
    }

    const actions = el('div', 'uc-actions')
    const fullButton = actionButton('完整更新')
    const pullButton = actionButton('仅拉取代码', 'secondary')
    const canUpdate = checked && !repo?.error && !git.dirty && Number(git.behind) > 0
    fullButton.disabled = !canUpdate
    pullButton.disabled = !canUpdate
    bindAction(fullButton, '/update-dsh', { full: true }, '完整更新会在独立后台任务中拉取代码、安装依赖并重新构建 dsh。任务完成后再重启，是否继续？', '正在创建后台更新任务…')
    bindAction(pullButton, '/update-dsh', { full: false }, '仅拉取代码不会安装依赖或重新构建，重启后仍可能运行旧产物。确认继续？', '正在创建后台更新任务…')
    actions.append(fullButton, pullButton)
    row.append(info, actions)
    repoContent.append(row)

    if (git.dirty && Array.isArray(git.dirtyFiles) && git.dirtyFiles.length) {
      const dirty = el('div', 'uc-msg info', `为保护现有工作，更新已禁用：\n${git.dirtyFiles.join('\n')}`)
      repoContent.append(dirty)
    }
  }

  function renderPlugins(plugins: any[]): void {
    pluginList.textContent = ''
    pluginCount.textContent = `${plugins.length} 个`
    if (!plugins.length) {
      pluginList.append(el('li', 'uc-empty', '当前 profile 没有外部插件，去“插件市场”看看？'))
      return
    }

    for (const plugin of plugins) {
      const item = el('li', 'uc-item')
      const identity = el('div')
      identity.append(el('div', 'uc-name', String(plugin.name)))
      const marketEntry = marketEntryFor(String(plugin.name))
      const description = marketEntry?.description?.zh || marketEntry?.description?.en
      if (description) identity.append(el('div', 'uc-desc', String(description)))
      const tags = el('div', 'uc-tags')
      const kind = plugin.kind === 'preset' ? 'preset' : plugin.kind === 'link' ? 'link' : 'npm'
      tags.append(el('span', 'uc-tag ' + kind, kind))
      if (plugin.bundled) tags.append(el('span', 'uc-tag', 'bundle'))
      if (plugin.upstream && String(plugin.upstream).includes('/')) {
        tags.append(externalLink(String(plugin.upstream), `https://github.com/${plugin.upstream}`))
      } else if (plugin.upstream) {
        tags.append(el('span', 'uc-meta', String(plugin.upstream)))
      }
      if (plugin.linkDir) tags.append(el('span', 'uc-meta uc-path', String(plugin.linkDir)))
      identity.append(tags)

      const status = el('div', 'uc-status')
      status.append(el('span', 'uc-meta', plugin.version ? `v${plugin.version}` : '版本未知'))
      const git = plugin.git ?? {}
      let updateAvailable = false
      let blocked = false
      if (plugin.disabled) {
        status.append(badge('已禁用', 'muted'))
      }
      if ((kind === 'link' || kind === 'preset') && git.dirty) {
        status.append(badge('有未提交改动', 'warn'))
        blocked = true
      } else if ((kind === 'link' || kind === 'preset') && checked && git.fetchOk === false) {
        status.append(badge('检查失败', 'err'))
      } else if ((kind === 'link' || kind === 'preset') && checked && Number(git.behind) > 0) {
        status.append(badge(`落后 ${git.behind}`, 'update'))
        updateAvailable = true
      } else if (kind === 'npm' && checked && plugin.latest && plugin.latest !== plugin.version) {
        status.append(badge(`可更新至 ${plugin.latest}`, 'update'))
        updateAvailable = true
      } else if (checked && ((kind === 'npm' && plugin.latest) || typeof git.behind === 'number')) {
        status.append(badge('已是最新', 'ok'))
      } else if (!plugin.disabled) {
        status.append(badge('未检查', 'muted'))
      }

      const actions = el('div', 'uc-actions')
      const updateButton = actionButton('更新')
      updateButton.disabled = !updateAvailable || blocked
      if (kind === 'npm') {
        bindAction(updateButton, '/update-npm', { name: plugin.name }, `后台更新 ${plugin.name} 到最新版，并核对实际安装版本。任务完成后再重启，是否继续？`, '正在创建后台更新任务…')
      } else {
        bindAction(updateButton, '/update-link', { name: plugin.name }, `后台更新本地插件 ${plugin.name}；若只更新源码，会自动重新构建运行产物。是否继续？`, '正在创建后台更新任务…')
      }
      actions.append(updateButton)
      if (kind === 'npm') {
        const toggleButton = actionButton(plugin.disabled ? '启用' : '禁用', 'secondary')
        bindAction(toggleButton, plugin.disabled ? '/enable' : '/disable', { name: plugin.name },
          plugin.disabled ? `恢复启用 ${plugin.name}？重启 dsh web 后生效。` : `禁用 ${plugin.name}？只是写入配置不卸载，重启 dsh web 后生效。`,
          '正在更新配置…')
        actions.append(toggleButton)
        const removeButton = actionButton('卸载', 'danger')
        bindAction(removeButton, '/uninstall', { name: plugin.name }, `从 profile 卸载 ${plugin.name}（pnpm remove + 移出 bundles）。已禁用状态会一并清理。任务完成后再重启，是否继续？`, '正在创建后台卸载任务…')
        actions.append(removeButton)
      }
      item.append(identity, status, actions)
      pluginList.append(item)
    }
  }

  // ── 市场渲染 ──
  function renderCategorySelect(): void {
    const categories = marketData?.categories ?? {}
    const previous = marketCategory
    categorySelect.textContent = ''
    const all = el('option', undefined, '全部分类')
    all.value = ''
    categorySelect.append(all)
    for (const [key, label] of Object.entries<any>(categories)) {
      const option = el('option', undefined, String(label?.zh || label?.en || key))
      option.value = key
      categorySelect.append(option)
    }
    marketCategory = previous && [...categorySelect.options].some((o) => o.value === previous) ? previous : ''
    categorySelect.value = marketCategory
  }

  function renderMarket(): void {
    marketList.textContent = ''
    if (!marketData) {
      marketList.append(el('li', 'uc-empty', '清单尚未加载'))
      return
    }
    const plugins: any[] = Array.isArray(marketData.plugins) ? marketData.plugins : []
    const installedSet = new Set<string>(Array.isArray(marketData.installed) ? marketData.installed.map(String) : [])
    const query = marketQuery.trim().toLowerCase()
    const filtered = plugins.filter((entry) => {
      if (marketCategory && entry.category !== marketCategory) return false
      if (!query) return true
      const haystack = [entry.name, entry.owner, entry.npm, entry.description?.zh, entry.description?.en]
        .filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(query)
    })
    // 排序：星标最多 / 最近添加；同值保持清单原顺序（sort 稳定）。
    if (marketSort === 'stars') {
      filtered.sort((a, b) => Number(b.stars ?? 0) - Number(a.stars ?? 0))
    } else if (marketSort === 'added') {
      filtered.sort((a, b) => (Date.parse(String(b.added ?? '')) || 0) - (Date.parse(String(a.added ?? '')) || 0))
    }
    const sourceLabel = { network: 'awesome-dsh-plugin.com', github: 'GitHub 清单（降级）', disk: '本地缓存', snapshot: '内置快照' }[String(marketData.source)] ?? marketData.source
    const githubExtra = Number(marketData.githubExtra ?? 0)
    const extraNote = githubExtra > 0 ? `，其中 GitHub 主题发现 ${githubExtra} 个` : ''
    marketMeta.textContent = `来源：${sourceLabel} · 清单更新 ${String(marketData.updated || '未知')} · 共 ${plugins.length} 个${extraNote}，筛选出 ${filtered.length} 个${filtered.length > 300 ? '（仅显示前 300）' : ''}`
    if (!filtered.length) {
      marketList.append(el('li', 'uc-empty', '没有匹配的插件'))
      return
    }
    for (const entry of filtered.slice(0, 300)) {
      const installed = installedSet.has(String(entry.name)) || (entry.npm && installedSet.has(String(entry.npm)))
      const item = el('li', 'uc-item')
      const identity = el('div')
      const nameRow = el('div', 'uc-name')
      if (entry.url) {
        nameRow.append(externalLink(String(entry.name), String(entry.url)))
      } else {
        nameRow.textContent = String(entry.name)
      }
      identity.append(nameRow)
      const description = entry.description?.zh || entry.description?.en || ''
      if (description) identity.append(el('div', 'uc-desc', String(description)))
      const tags = el('div', 'uc-tags')
      if (entry.owner) tags.append(el('span', 'uc-meta', String(entry.owner)))
      if (entry.npm) tags.append(el('span', 'uc-tag npm', 'npm'))
      else tags.append(el('span', 'uc-tag', 'github'))
      identity.append(tags)

      const status = el('div', 'uc-status')
      const stars = Number(entry.stars ?? 0)
      status.append(el('span', 'uc-meta', stars > 0 ? `★ ${stars}` : '暂无星标'))
      const statusPlugin = (lastStatusData?.plugins ?? []).find((plugin: any) =>
        plugin.name === entry.npm || plugin.name === entry.name)
      const updatable = statusPlugin
        && ((statusPlugin.kind === 'npm' && statusPlugin.latest && statusPlugin.latest !== statusPlugin.version)
          || Number(statusPlugin.git?.behind) > 0)

      const actions = el('div', 'uc-actions')
      if (installed) {
        status.append(updatable ? badge('可更新', 'update') : badge('已安装', 'ok'))
        const removeButton = actionButton('卸载', 'danger')
        bindAction(removeButton, '/uninstall', { name: entry.npm || entry.name }, `从 profile 卸载 ${entry.npm || entry.name}？任务完成后再重启，是否继续？`, '正在创建后台卸载任务…')
        actions.append(removeButton)
      } else {
        const installButton = actionButton('安装')
        bindAction(installButton, '/install', { name: entry.name }, `在后台安装 ${entry.name}（优先 npm，来源不一致时回退 GitHub）。安装完成后需要重启 dsh web，是否继续？`, '正在创建后台安装任务…')
        actions.append(installButton)
      }
      item.append(identity, status, actions)
      marketList.append(item)
    }
  }

  async function loadMarket(force: boolean, silent: boolean): Promise<void> {
    if (force) setBusy(true, refreshButton, '刷新中…')
    if (!silent) say('正在加载插件市场清单…', 'info')
    try {
      const data = await fetchJson(force ? '/market/refresh' : '/market')
      if (!data?.ok) throw new Error(data?.error || '清单加载失败')
      marketData = data
      renderCategorySelect()
      renderMarket()
      if (lastStatusData) renderPlugins(lastStatusData.plugins ?? [])
      if (!silent) say('', 'info')
    } catch (error) {
      if (!silent) say('市场清单加载失败：' + String(error), 'err')
    } finally {
      if (force) setBusy(false, refreshButton)
    }
  }

  function switchTab(target: 'installed' | 'market'): void {
    const showMarket = target === 'market'
    installedTab.className = showMarket ? 'uc-tab' : 'uc-tab active'
    marketTab.className = showMarket ? 'uc-tab active' : 'uc-tab'
    installedView.style.display = showMarket ? 'none' : 'block'
    marketView.style.display = showMarket ? 'block' : 'none'
    if (showMarket && !marketData) void loadMarket(false, false)
  }

  function render(data: any): void {
    lastStatusData = data
    renderRepo(data?.repo)
    renderPlugins(Array.isArray(data?.plugins) ? data.plugins : [])
    updateSummary(data)
    updateAllButton.disabled = !checked || pluginUpdateCount(data?.plugins ?? []) === 0
  }

  function refreshStatus(showJob = true, fresh = false): Promise<void> {
    return fetchJson(fresh ? '/status?fresh=1' : '/status')
      .then((data) => {
        if (!data?.ok) throw new Error(data?.error || '状态读取失败')
        render(data)
        if (showJob) {
          resumeJob(data.job)
          if (data?.job?.status === 'completed') say(jobText(data.job), 'ok')
          if (data?.job?.status === 'failed') say(jobText(data.job), 'err')
        }
      })
      .catch((error) => say('状态读取失败：' + String(error), 'err'))
  }

  installedTab.addEventListener('click', () => switchTab('installed'))
  marketTab.addEventListener('click', () => switchTab('market'))
  searchInput.addEventListener('input', () => {
    marketQuery = searchInput.value
    renderMarket()
  })
  categorySelect.addEventListener('change', () => {
    marketCategory = categorySelect.value
    renderMarket()
  })
  sortSelect.addEventListener('change', () => {
    marketSort = sortSelect.value
    renderMarket()
  })
  refreshButton.addEventListener('click', () => void loadMarket(true, false))
  bindAction(updateAllButton, '/update-all', {}, '把所有可更新的插件（不含 dsh 本体）排成一个后台批量任务串行执行，单个失败不影响其余。任务完成后再重启，是否继续？', '正在检查并创建批量更新任务…')

  checkButton.addEventListener('click', () => {
    setBusy(true, checkButton, '检查中…')
    say('正在检查 dsh 和插件的远端状态…', 'info')
    fetchJson('/check', { method: 'POST', body: '{}' })
      .then((data) => {
        if (!data?.ok) throw new Error(data?.error || '检查失败')
        checked = true
        render(data)
        if (marketData) renderMarket()
        const total = Number(data?.summary?.totalUpdates ?? 0)
        const failed = Number(data?.summary?.failedChecks ?? 0)
        if (failed > 0) {
          say(`检查完成，发现 ${total} 项可更新，另有 ${failed} 项检查失败。`, 'err')
        } else {
          say(total > 0 ? `检查完成，发现 ${total} 项可更新。` : '检查完成，当前全部为最新。', total > 0 ? 'info' : 'ok')
        }
      })
      .catch((error) => say('检查失败：' + String(error), 'err'))
      .finally(() => setBusy(false, checkButton))
  })

  void refreshStatus()
  return page
}

function UpdateCenterPanel(): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const panel = buildPanel()
    host.appendChild(panel)
    return () => { panel.remove() }
  }, [])
  return createElement('div', { ref: hostRef })
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'update-center',
      order: 60,
      label: () => '更新中心',
    }, UpdateCenterPanel),
  ), '@dsh-external/dsh-update-center: panel')
}
