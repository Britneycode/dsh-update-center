/**
 * 按功能给市场条目分类（awesome-dsh-plugin 的分类体系）。
 *
 * 两条规则按优先级生效：
 * 1. awesome-dsh-plugin 精选清单的仓库 → 分类映射（data/awesome-categories.json，
 *    键为小写 owner/name，值为清单小节名）；
 * 2. 名称 + 中英文描述的有序关键词匹配（靠前的分类更特定，先命中先得）；
 * 3. 都不中则归入 other。
 */

/** 分类键 → 中英文标签（下拉顺序即此对象的键序）。 */
export const CATEGORY_LABELS = {
  ui: { en: 'UI Enhancements', zh: '界面增强' },
  billing: { en: 'Usage & Billing', zh: '用量与计费' },
  themes: { en: 'Themes & Appearance', zh: '主题与外观' },
  models: { en: 'Models & Providers', zh: '模型与供应商' },
  sessions: { en: 'Sessions & Messages', zh: '会话与消息' },
  memory: { en: 'Memory', zh: '记忆' },
  tools: { en: 'Tools & Capabilities', zh: '工具与能力' },
  vision: { en: 'Vision & Multimodal', zh: '视觉与多模态' },
  skills: { en: 'Skills', zh: '技能' },
  workflow: { en: 'Workflow & Automation', zh: '工作流与自动化' },
  notifications: { en: 'Notifications & Integrations', zh: '通知与集成' },
  dev: { en: 'Development & Runtime', zh: '开发与运行时' },
  markets: { en: 'Plugin Markets & Managers', zh: '插件市场与管理' },
  fun: { en: 'Just for Fun', zh: '趣味' },
  other: { en: 'Other', zh: '其他' },
}

/** awesome 清单小节名 → 分类键。 */
const SECTION_TO_KEY = {
  'UI Enhancements': 'ui',
  'Usage & Billing': 'billing',
  'Themes & Appearance': 'themes',
  'Models & Providers': 'models',
  'Sessions & Messages': 'sessions',
  Memory: 'memory',
  'Tools & Capabilities': 'tools',
  'Vision & Multimodal': 'vision',
  Skills: 'skills',
  'Workflow & Automation': 'workflow',
  'Notifications & Integrations': 'notifications',
  'Development & Runtime': 'dev',
  'Plugin Markets & Managers': 'markets',
  'Just for Fun': 'fun',
}

/** 个别仓库的关键词覆盖不到，显式指定（小写 owner/name → 分类键）。 */
const MANUAL_OVERRIDES = {
  'deepseek-ai/deepseek-harness': 'dev',
  'britneycode/dsh-update-center': 'markets',
}

/**
 * 关键词规则（有序，先命中先得；英文匹配小写子串，中文直接子串）。
 * 无意义的通用词（dsh、plugin、插件）不参与匹配。
 */
const KEYWORD_RULES = [
  ['markets', ['market', '市场', 'registry', '注册表', 'plugin manager', '插件管理', 'plugin store', '插件商店', 'installer', '安装器', 'updater', '更新器', '商店', '插件生态', 'oh-my', 'update-center', 'update center', '更新中心', 'healthcheck', '健康检测', '木马', 'malware']],
  ['billing', ['billing', '计费', 'usage', '用量', 'cost', '费用', 'spend', '开销', 'quota', '配额', '账单', 'invoice', '价格监控', 'price', 'subscription', '订阅', 'balance', '余额']],
  ['vision', ['vision', '视觉', 'ocr', '文字识别', 'multimodal', '多模态', 'screenshot', '截图', '看图', '识图', 'image', '图像', '图片', 'photo', '照片', 'video', '视频', 'camera', '摄像头', 'pdf', 'chart recog', '图表识别']],
  ['memory', ['memory', '记忆', 'knowledge base', '知识库', 'knowledge graph', '知识图谱', 'rag', 'embedding', '向量', 'retrieval', '检索增强', 'long-term', '长期记忆', 'flashback', '回忆']],
  ['notifications', ['notify', 'notification', '通知', '提醒', 'telegram', 'slack', 'discord', '钉钉', 'dingtalk', '飞书', 'feishu', 'lark', '微信', 'wechat', 'email', '邮件', 'smtp', 'webhook', '推送', 'bark', '提示音', 'alert', '警报', 'integration', '集成', 'qq', '机器人', 'bot', '频道', 'channel', '兼容', 'compatib', 'tavern']],
  ['themes', ['theme', '主题', 'appearance', '外观', 'color scheme', '配色', '色彩', 'font', '字体', 'icon', '图标', '美化', 'beautif', 'skin', '皮肤', 'splash', '启动画面', 'wallpaper', '壁纸']],
  ['models', ['provider', '供应商', 'model switch', '模型切换', '模型路由', 'model rout', 'llm', 'anthropic', 'openai', 'gpt', 'claude', 'gemini', 'ollama', 'vllm', 'llama', 'qwen', '通义', 'deepseek api', 'openrouter', 'one-api', 'new-api', '中转', 'api key', '模型管理', 'models manage', 'inference', '推理引擎', '免费模型', 'free model', '模型对比', '模型评测', 'reasoning-effort', '思考强度', 'model config', 'model-config', '模型配置']],
  ['skills', ['skill', '技能', 'slash command', '斜杠命令', 'slash-command', 'prompt librar', '提示词', 'persona', '人设', '角色扮演', 'roleplay', '角色', 'clarify', '澄清', 'awesome', '精选', 'curated', 'command palette', '命令面板', 'system prompt', '系统提示']],
  ['workflow', ['workflow', '工作流', 'automation', '自动化', 'cron', '定时', 'schedul', '计划任务', 'pipeline', '流水线', '编排', 'orchestr', 'multi-agent', '多智能体', '多 agent', 'agent team', 'swarm', 'hook', '钩子', '触发', 'trigger', '联动', '一键', 'one-click', 'batch', '批处理', 'macro', '宏', 'permission', '权限', 'auto-approve', '自动批准', 'flow', '流程', '协作', 'collaborat', 'team ']],
  ['sessions', ['session', '会话', 'conversation', '对话', 'chat history', '聊天历史', '历史记录', 'message', '消息', 'export', '导出', 'archive', '归档', 'transcript', 'summar', '总结', '摘要', 'fork', '会话分支', 'pin', '置顶', '标签页', 'chat search', '搜索对话', 'rename', '重命名', 'resume', '恢复会话', 'compact', '压缩上下文', 'attachment', '附件']],
  ['dev', ['debug', '调试', 'runtime', '运行时', 'develop', '开发', 'lint', 'eslint', 'test', '测试', 'coverage', '覆盖率', 'build', '构建', 'bundle', 'repl', 'terminal', '终端', 'shell', 'bash', 'zsh', 'docker', 'kubernetes', 'k8s', 'ci/cd', 'cicd', 'deploy', '部署', 'server', '服务端', 'sdk', 'log', '日志', 'monitor', '监控', 'profiler', '性能分析', 'hot reload', '热重载', 'devtool', '开发工具', 'scaffold', '脚手架', 'git ', '代码审查', 'code review', 'refactor', '重构', '类型', 'typescript', 'bridge', '桥接', 'abi', 'safety', '安全', 'security', 'guardrail', 'sandbox', '沙箱', 'code execution', '代码执行', 'coding agent', '编程', '逆向', 'reverse engineer', 'protocol', '协议', 'vscode', 'ide', 'gateway', '网关', '远程', 'injector', '注入', 'opencode', 'data backend', '数据后端', '后端']],
  ['fun', ['game', '游戏', 'fun', '趣味', '彩蛋', 'easter', 'meme', '表情包', 'emoji', '宠物', 'pet', 'music', '音乐', '闲聊', '无聊', '小说', 'novel', '彩铃', 'pixel', '像素', 'ascii art', '文字画', 'toy']],
  ['ui', ['ui', '界面', 'statusline', '状态栏', 'status bar', 'sidebar', '侧边栏', '侧栏', 'menu', '菜单', 'layout', '布局', 'shortcut', '快捷键', 'keybind', '键位', 'keyboard', 'vim', 'neovim', 'emacs', 'editor', '编辑器', 'input', '输入框', 'render', '渲染', 'markdown', 'panel', '面板', 'fullscreen', '全屏', '动画', 'animation', 'tooltip', 'progress', '进度', 'tui', 'window', '窗口', 'display', '展示', '预览', 'preview', 'tree', '树状', '滚动', 'scroll', 'zen mode', '专注模式', 'desktop', '桌面', '客户端', 'client', 'mobile', '移动端', 'gui', 'activity', '活动状态', '思考状态', 'chain of thought', '思维链', '思考过程']],
  ['tools', ['tool', '工具', 'search', '搜索', 'translate', '翻译', '词典', 'dictionary', 'calc', '计算', 'convert', '转换', '格式化', 'format', 'weather', '天气', '汇率', 'currency', 'qr', '二维码', 'clipboard', '剪贴板', 'file', '文件', '加密', 'encrypt', 'password', '密码', 'generator', '生成器', '爬虫', 'crawler', 'fetch', '抓取', 'download', '下载', 'upload', '上传', 'mcp', '浏览器', 'browser', '数据库', 'database', 'sql', '表格', 'spreadsheet', '地图', 'map', '内容发现', 'rss', '广告', 'ad block', 'anti-ads', '拦截', 'wireframe', '线框', '原型']],
]

const NOISE_WORDS = new Set(['dsh', 'plugin', '插件', 'deepseek', 'harness', 'extension', '扩展'])

/**
 * 单个条目 → 分类键。awesomeMap 为可选的预加载映射
 * （小写 owner/name → 清单小节名）。
 */
export function classifyPlugin(plugin, awesomeMap) {
  if (plugin?.owner && plugin?.name) {
    const key = `${String(plugin.owner).toLowerCase()}/${String(plugin.name).toLowerCase()}`
    if (MANUAL_OVERRIDES[key]) return MANUAL_OVERRIDES[key]
    const section = awesomeMap?.[key]
    if (section && SECTION_TO_KEY[section]) return SECTION_TO_KEY[section]
  }
  const desc = plugin?.description ?? {}
  const haystack = `${plugin?.name ?? ''} ${desc.en ?? ''} ${desc.zh ?? ''}`.toLowerCase()
  if (!haystack.trim()) return 'other'
  for (const [key, words] of KEYWORD_RULES) {
    for (const word of words) {
      if (!word || NOISE_WORDS.has(word)) continue
      if (haystack.includes(word)) return key
    }
  }
  return 'other'
}

/**
 * 给整个 registry 数据重算分类（原地修改）：每个条目的 category 字段 +
 * 顶层的 categories 标签表。返回 { counts, bySource } 供日志/预览。
 */
export function applyCategories(data, awesomeMap) {
  const counts = {}
  const bySource = { awesome: 0, keyword: 0, other: 0 }
  if (!data || !Array.isArray(data.plugins)) return { counts, bySource }
  for (const plugin of data.plugins) {
    const key = `${String(plugin?.owner ?? '').toLowerCase()}/${String(plugin?.name ?? '').toLowerCase()}`
    const inAwesome = !!(awesomeMap && awesomeMap[key])
    const cat = classifyPlugin(plugin, awesomeMap)
    plugin.category = cat
    counts[cat] = (counts[cat] ?? 0) + 1
    if (inAwesome) bySource.awesome += 1
    else if (cat === 'other') bySource.other += 1
    else bySource.keyword += 1
  }
  data.categories = { ...CATEGORY_LABELS }
  return { counts, bySource }
}

/** 从 awesome 清单映射 JSON（data/awesome-categories.json 的内容）展开成查找表。 */
export function flattenAwesomeMap(awesomeData) {
  const flat = {}
  if (!awesomeData || typeof awesomeData !== 'object') return flat
  for (const [section, repos] of Object.entries(awesomeData)) {
    if (!Array.isArray(repos)) continue
    for (const repo of repos) flat[String(repo).toLowerCase()] = section
  }
  return flat
}
