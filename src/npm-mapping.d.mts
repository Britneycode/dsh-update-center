export declare function extractOwnerRepo(url: string): string | null

export interface NpmSearchObject {
  package?: {
    name?: string
    links?: { repository?: string }
  }
}

export declare function applyNpmMapping(
  data: { plugins: Array<Record<string, unknown>> } | null | undefined,
  searchObjects: NpmSearchObject[],
): number
