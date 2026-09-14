import type { BangumiData, Show, Status, WatchEvent } from "./model"

type LegacyItem = { kind?: string; title?: string; raw?: string; status?: Status; source?: string; progress?: number; children?: LegacyItem[] }
type LegacyCurrent = { items?: LegacyItem[] }
type LegacyHistory = { events?: { commit?: string; files?: { added?: LegacyItem[]; removed?: LegacyItem[] }[] }[] }
const flatten = (items: LegacyItem[]): LegacyItem[] => items.flatMap((item) => [item, ...flatten(item.children ?? [])])

export function importCurrent(value: unknown): Show[] {
  const input = value as LegacyCurrent
  if (!Array.isArray(input?.items)) throw new Error("不是有效的 bangumi.json")
  return flatten(input.items).filter((item) => item.kind === "item" && item.title?.trim()).map((item) => ({
    id: crypto.randomUUID(), title: [item.title!.trim()], status: item.status ?? "planned",
    volumes: [{ id: crypto.randomUUID(), type: "正剧", episodeCount: Math.max(1, item.progress ?? 1) }],
    notes: item.progress ? [`导入时进度：${item.progress}`] : [], import: { raw: item.raw, source: item.source },
  }))
}

export function importHistory(value: unknown, data: BangumiData): WatchEvent[] {
  const input = value as LegacyHistory
  if (!Array.isArray(input?.events)) throw new Error("不是有效的 bangumi-history.json")
  const showByTitle = new Map(data.shows.flatMap((show) => show.title.map((title) => [title, show] as const)))
  const inferred: WatchEvent[] = []
  for (const commit of input.events) for (const file of commit.files ?? []) for (const added of file.added ?? []) {
    if (!added.title || !added.progress) continue
    const removed = (file.removed ?? []).find((item) => item.title === added.title && item.progress && item.progress < added.progress!)
    const show = showByTitle.get(added.title)
    if (!removed?.progress || !show) continue
    const volume = show.volumes.find((item) => item.type === "正剧")
    if (!volume || added.progress > volume.episodeCount) continue
    inferred.push({
      id: crypto.randomUUID(), showId: show.id, episodes: { volumeId: volume.id, from: removed.progress + 1, to: added.progress },
      watchedAt: { precision: "unknown" }, recordedAt: new Date().toISOString(), source: "import-inferred",
      confidence: "high", sourceCommit: commit.commit,
    })
  }
  return inferred
}
