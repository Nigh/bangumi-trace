export const sameUtcDay = (left: string, right: string) => left.slice(0, 10) === right.slice(0, 10)
export const needsCompression = (commitCount: number) => commitCount > 31

export function saveParents(head: string, parents: string[], committedAt: string, now: string) {
  const amend = sameUtcDay(committedAt, now)
  return { amend, parents: amend ? parents : [head] }
}

export function compressionWindow<T>(commits: T[]) {
  return needsCompression(commits.length) ? { recent: commits.slice(0, 30), cutoff: commits[30] } : null
}
