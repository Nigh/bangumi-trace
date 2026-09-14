export type Status = "planned" | "watching" | "completed" | "dropped"
export type Precision = "exact" | "day" | "range" | "unknown"

export interface Volume {
  id: string
  type: string
  episodeCount: number
}

export interface Show {
  id: string
  title: [string, ...string[]]
  status: Status
  volumes: Volume[]
  externalRef?: { provider: "bangumi"; id: string }
  note: string
  import?: { raw?: string; source?: string }
}

export interface WatchEvent {
  id: string
  showId: string
  episodes: { volumeId: string; from: number; to: number }
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

export interface BangumiData { version: 3; shows: Show[]; watchEvents: WatchEvent[] }
export const emptyData = (): BangumiData => ({ version: 3, shows: [], watchEvents: [] })

export function isBangumiData(value: unknown): value is BangumiData {
  if (!value || typeof value !== "object") return false
  const data = value as Record<string, unknown>
  if (data.version !== 3 || !Array.isArray(data.shows) || !Array.isArray(data.watchEvents)) return false
  const shows = data.shows as Record<string, unknown>[]
  if (!shows.every((show) => typeof show?.id === "string" && Array.isArray(show.title) && show.title.length > 0 &&
    show.title.every((title) => typeof title === "string" && title.trim()) &&
    ["planned", "watching", "completed", "dropped"].includes(String(show.status)) &&
    typeof show.note === "string" && show.note.length <= 2048 && Array.isArray(show.volumes) &&
    show.volumes.every((volume) => validVolume(volume)))) return false
  const volumes = new Map(shows.flatMap((show) => (show.volumes as Volume[]).map((volume) => [volume.id, { volume, showId: show.id }])))
  return data.watchEvents.every((event) => validEvent(event, volumes))
}

function validVolume(value: unknown): value is Volume {
  if (!value || typeof value !== "object") return false
  const volume = value as Record<string, unknown>
  return typeof volume.id === "string" && typeof volume.type === "string" && Boolean(volume.type.trim()) &&
    Number.isInteger(volume.episodeCount) && Number(volume.episodeCount) > 0
}

function validEvent(value: unknown, volumes: Map<string, { volume: Volume; showId: unknown }>) {
  if (!value || typeof value !== "object") return false
  const event = value as Record<string, unknown>, episodes = event.episodes as Record<string, unknown> | undefined
  const target = episodes && volumes.get(String(episodes.volumeId))
  return typeof event.id === "string" && typeof event.showId === "string" && target?.showId === event.showId &&
    Number.isInteger(episodes?.from) && Number.isInteger(episodes?.to) && Number(episodes!.from) > 0 &&
    Number(episodes!.to) >= Number(episodes!.from) && Number(episodes!.to) <= target.volume.episodeCount &&
    typeof event.recordedAt === "string" && ["manual", "import-inferred"].includes(String(event.source)) &&
    !!event.watchedAt && typeof event.watchedAt === "object" &&
    ["exact", "day", "range", "unknown"].includes(String((event.watchedAt as Record<string, unknown>).precision))
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

const numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
const ordinal = (value: number) => value <= 10 ? numerals[value] : String(value)

export function volumeLabel(show: Show, volume: Volume) {
  const index = show.volumes.filter((item) => item.type === volume.type).indexOf(volume) + 1
  return volume.type === "正剧" ? `第${ordinal(index)}季` : `${volume.type} ${index}`
}

export function mapCumulativeEpisode(show: Show, type: string, episode: number) {
  let rest = episode
  for (const volume of show.volumes.filter((item) => item.type === type)) {
    if (rest <= volume.episodeCount) return { volumeId: volume.id, episode: rest }
    rest -= volume.episodeCount
  }
  return null
}

export function nextEpisode(data: BangumiData, volume: Volume) {
  const watched = data.watchEvents.filter((event) => event.episodes.volumeId === volume.id)
    .reduce((maximum, event) => Math.max(maximum, event.episodes.to), 0)
  return watched < volume.episodeCount ? watched + 1 : null
}

export function nextVolumeEpisode(data: BangumiData, show: Show) {
  const latest = [...data.watchEvents].reverse().find((event) => event.showId === show.id)
  const start = Math.max(0, show.volumes.findIndex((volume) => volume.id === latest?.episodes.volumeId))
  const ordered = [...show.volumes.slice(start), ...show.volumes.slice(0, start)]
  const volume = ordered.find((item) => nextEpisode(data, item) !== null)
  return volume ? { volume, episode: nextEpisode(data, volume)! } : null
}

export function eventTime(event: WatchEvent) {
  if (event.watchedAt.precision === "exact" || event.watchedAt.precision === "day") return Date.parse(event.watchedAt.value)
  if (event.watchedAt.precision === "range") return Date.parse(event.watchedAt.to)
  return Date.parse(event.recordedAt)
}

export function sortShowsByActivity(data: BangumiData, shows: Show[]) {
  const latest = new Map<string, number>()
  for (const event of data.watchEvents) latest.set(event.showId, Math.max(latest.get(event.showId) ?? -Infinity, eventTime(event)))
  return [...shows].sort((a, b) => (latest.get(b.id) ?? -Infinity) - (latest.get(a.id) ?? -Infinity))
}

export function episodeLabel(show: Show, event: WatchEvent) {
  const volume = show.volumes.find((item) => item.id === event.episodes.volumeId)
  const range = event.episodes.to === event.episodes.from ? `${event.episodes.from}` : `${event.episodes.from}–${event.episodes.to}`
  return volume ? `${volumeLabel(show, volume)}第 ${range} 话` : `第 ${range} 话`
}

export const expandedEpisodes = (event: WatchEvent) =>
  Array.from({ length: event.episodes.to - event.episodes.from + 1 }, (_, index) => event.episodes.from + index)
