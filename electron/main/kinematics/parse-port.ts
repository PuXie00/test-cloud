export const parseListeningPids = (netstatOutput: string, port: number): number[] => {
  const pids = new Set<number>()
  const needle = `:${port}`
  for (const rawLine of netstatOutput.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.toUpperCase().includes('LISTENING')) continue
    if (!line.includes(needle)) continue
    const parts = line.split(/\s+/)
    const pid = Number(parts[parts.length - 1])
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}
