export interface RegistryReadmeEntry {
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

export interface RegistryReadmeData {
  name: string
  url: string
  source: string
  updated: string
  count: number
  categories: Record<string, { en: string, zh: string }>
  plugins: RegistryReadmeEntry[]
}

export declare function parseAwesomeReadme(text: string): RegistryReadmeData | null
