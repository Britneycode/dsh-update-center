export interface GithubTopicEntry {
  name: string
  owner: string
  url: string
  page: string
  category: string
  description: { en: string, zh: string }
  npm: string | null
  stars: number
  install: string
  added: string
}

export interface GithubRepo {
  name?: string
  owner?: { login?: string }
  html_url?: string
  description?: string
  stargazers_count?: number
  pushed_at?: string
  fork?: boolean
}

export declare function githubRepoToEntry(repo: GithubRepo): GithubTopicEntry

export declare function mergeGithubTopic(
  data: { plugins: Array<Record<string, unknown>>, categories?: Record<string, unknown>, [key: string]: unknown },
  repos: GithubRepo[],
): { added: number, starsUpdated: number }

export declare function buildRegistryFromRepos(repos: GithubRepo[]): {
  name: string
  url: string
  source: string
  updated: string
  count: number
  categories: Record<string, { en: string, zh: string }>
  plugins: GithubTopicEntry[]
}
