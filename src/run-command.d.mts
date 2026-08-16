export interface RunCommandResult {
  ok: boolean
  code: number | null
  out: string
  err: string
}

export declare function runCommandAsync(
  command: string,
  args: string[],
  cwd?: string,
  timeoutMs?: number,
  extraEnv?: Record<string, string>,
): Promise<RunCommandResult>
