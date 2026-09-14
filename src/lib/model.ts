export type Status = "planned" | "watching" | "completed" | "dropped"
export type Precision = "exact" | "day" | "range" | "unknown"

export interface Show {
  id: string
  title: [string, ...string[]]
  status: Status
  externalRef?: { provider: "bangumi"; id: string }
  numbering?: { seasons: { season: number; absoluteStart: number }[] }
  notes?: string[]
  import?: { raw?: string; source?: string }
}

export interface WatchEvent {
  id: string
  showId: string
  episodes: { season?: number; from?: number; to?: number; absoluteFrom?: number; absoluteTo?: number }
  watchedAt:
    | { precision: "exact"; value: string }
    | { precision: "day"; value: string }
    | { precision: "range"; from: string; to: string; label: string }
    | { precision: "unknown" }
  recordedAt: string
  source: "manual" | "import-inferred"
  confidence?: "high" | "medium" | "low"
  sourceCommit?: string
}

export interface BangumiData { version: 1; shows: Show[]; watchEvents: WatchEvent[] }
export const emptyData = (): BangumiData => ({ version: 1, shows: [], watchEvents: [] })

export function isBangumiData(value: unknown): value is BangumiData {
  if (!value || typeof value !== "object") return false
  const data = value as Record<string, unknown>
  return data.version === 1 && Array.isArray(data.shows) && Array.isArray(data.watchEvents) && data.shows.every((show) => {
    if (!show || typeof show !== "object" || "aliases" in show) return false
    const item = show as Record<string, unknown>
    return typeof item.id === "string" && Array.isArray(item.title) && item.title.length > 0 &&
      item.title.every((title) => typeof title === "string" && title.trim().length > 0) &&
      ["planned", "watching", "completed", "dropped"].includes(String(item.status))
  })
}

export function uniqueTitles(primary: string, titles: string[]): [string, ...string[]] {
  const result = [primary, ...titles].map((title) => title.trim()).filter(Boolean)
    .filter((title, index, all) => all.findIndex((item) => item.localeCompare(title, undefined, { sensitivity: "accent" }) === 0) === index)
  if (!result.length) throw new Error("作品标题不能为空")
  return result as [string, ...string[]]
}

export const matchesTitle = (show: Show, query: string) => {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || show.title.some((title) => title.toLocaleLowerCase().includes(needle))
}

export function reorderTitle(show: Show, from: number, to: number): Show {
  if (from < 0 || to < 0 || from >= show.title.length || to >= show.title.length) return show
  const title = [...show.title] as [string, ...string[]]
  const [moved] = title.splice(from, 1)
  title.splice(to, 0, moved)
  return { ...show, title }
}

export function nextEpisodes(data: BangumiData, show: Show) {
  const latest = [...data.watchEvents].reverse().find((event) => event.showId === show.id)
  if (!latest) return { season: 1, from: 1, to: 1 }
  const episodes = latest.episodes
  const result: WatchEvent["episodes"] = {}
  if (episodes.season && episodes.to) Object.assign(result, { season: episodes.season, from: episodes.to + 1, to: episodes.to + 1 })
  if (episodes.absoluteTo) Object.assign(result, { absoluteFrom: episodes.absoluteTo + 1, absoluteTo: episodes.absoluteTo + 1 })
  return result
}

export function withEpisodeMapping(show: Show, episodes: WatchEvent["episodes"]) {
  const mapping = show.numbering?.seasons.find((item) => item.season === episodes.season)
  if (!mapping) return episodes
  const result = { ...episodes }
  if (episodes.from && !episodes.absoluteFrom) result.absoluteFrom = mapping.absoluteStart + episodes.from - 1
  if (episodes.to && !episodes.absoluteTo) result.absoluteTo = mapping.absoluteStart + episodes.to - 1
  if (episodes.absoluteFrom && !episodes.from) result.from = episodes.absoluteFrom - mapping.absoluteStart + 1
  if (episodes.absoluteTo && !episodes.to) result.to = episodes.absoluteTo - mapping.absoluteStart + 1
  return result
}

export function episodeLabel(event: WatchEvent) {
  const e = event.episodes
  const season = e.season && e.from ? `S${e.season}E${String(e.from).padStart(2, "0")}${e.to && e.to !== e.from ? `–E${String(e.to).padStart(2, "0")}` : ""}` : ""
  const absolute = e.absoluteFrom ? `第 ${e.absoluteFrom}${e.absoluteTo && e.absoluteTo !== e.absoluteFrom ? `–${e.absoluteTo}` : ""} 话` : ""
  return [season, absolute].filter(Boolean).join(" / ") || "未指定集数"
}
