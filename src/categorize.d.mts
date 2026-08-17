export interface CategoryLabel {
  en: string
  zh: string
}

export declare const CATEGORY_LABELS: Record<string, CategoryLabel>

export declare function classifyPlugin(
  plugin: { owner?: string, name?: string, description?: { en?: string, zh?: string } } | null | undefined,
  awesomeMap?: Record<string, string> | null,
): string

export declare function applyCategories(
  data: { plugins?: Array<Record<string, unknown>>, [key: string]: unknown } | null | undefined,
  awesomeMap?: Record<string, string> | null,
): { counts: Record<string, number>, bySource: { awesome: number, keyword: number, other: number } }

export declare function flattenAwesomeMap(awesomeData: unknown): Record<string, string>
