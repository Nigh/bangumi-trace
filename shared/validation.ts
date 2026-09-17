export function validateData(value: unknown): string | null {
  if (!record(value)) return "$: 必须是对象"
  if (value.version !== 6) return "$.version: 必须是 6"
  for (const key of ["shows", "watchEvents", "folders"])
    if (!Array.isArray(value[key])) return `$.${key}: 必须是数组`

  const shows = value.shows as unknown[], events = value.watchEvents as unknown[], folders = value.folders as unknown[]
  const showIds = new Set<string>(), volumes = new Map<string, { showId: string; episodeCount: number }>()
  for (const [i, item] of shows.entries()) {
    const path = `$.shows[${i}]`
    if (!record(item)) return `${path}: 必须是对象`
    if (typeof item.id !== "string") return `${path}.id: 必须是字符串`
    showIds.add(item.id)
    if (!Array.isArray(item.title) || !item.title.length) return `${path}.title: 必须是非空数组`
    const title = item.title.findIndex((title) => typeof title !== "string" || !title.trim())
    if (title >= 0) return `${path}.title[${title}]: 必须是非空字符串`
    if (item.aliases !== undefined) {
      if (!Array.isArray(item.aliases)) return `${path}.aliases: 必须是数组`
      const alias = item.aliases.findIndex((alias) => typeof alias !== "string" || !alias.trim())
      if (alias >= 0) return `${path}.aliases[${alias}]: 必须是非空字符串`
    }
    if (!["planned", "watching", "completed", "dropped"].includes(String(item.status))) return `${path}.status: 不支持的状态`
    if (item.note !== undefined && (typeof item.note !== "string" || item.note.length > 2048)) return `${path}.note: 必须是不超过 2048 字的字符串`
    if (!Array.isArray(item.volumes)) return `${path}.volumes: 必须是数组`
    for (const [j, entry] of item.volumes.entries()) {
      const volumePath = `${path}.volumes[${j}]`
      if (!record(entry)) return `${volumePath}: 必须是对象`
      if (typeof entry.id !== "string") return `${volumePath}.id: 必须是字符串`
      if (volumes.has(entry.id)) return `${volumePath}.id: 与其他 volume 重复`
      if (typeof entry.type !== "string" || !entry.type.trim()) return `${volumePath}.type: 必须是非空字符串`
      if (!Number.isInteger(entry.episodeCount) || Number(entry.episodeCount) < 1 || Number(entry.episodeCount) > 256) return `${volumePath}.episodeCount: 必须是 1–256 的整数`
      if (entry.externalRef !== undefined && !validExternalRef(entry.externalRef)) return `${volumePath}.externalRef: 必须是有效的 TMDB 引用`
      volumes.set(entry.id, { showId: item.id, episodeCount: Number(entry.episodeCount) })
    }
  }

  const folderIds = new Set<string>(), assigned = new Set<string>()
  for (const [i, item] of folders.entries()) {
    const path = `$.folders[${i}]`
    if (!record(item)) return `${path}: 必须是对象`
    if (typeof item.id !== "string") return `${path}.id: 必须是字符串`
    if (folderIds.has(item.id)) return `${path}.id: 与其他目录重复`
    folderIds.add(item.id)
    if (typeof item.name !== "string" || !item.name.trim()) return `${path}.name: 必须是非空字符串`
    if (!Array.isArray(item.showIds)) return `${path}.showIds: 必须是数组`
    for (const [j, id] of item.showIds.entries()) {
      const idPath = `${path}.showIds[${j}]`
      if (typeof id !== "string" || !showIds.has(id)) return `${idPath}: 引用的作品不存在`
      if (assigned.has(id)) return `${idPath}: 作品已属于其他目录`
      assigned.add(id)
    }
  }

  for (const [i, item] of events.entries()) {
    const path = `$.watchEvents[${i}]`
    if (!record(item)) return `${path}: 必须是对象`
    if (typeof item.id !== "string") return `${path}.id: 必须是字符串`
    if (typeof item.showId !== "string") return `${path}.showId: 必须是字符串`
    if (!record(item.episodes)) return `${path}.episodes: 必须是对象`
    const owner = volumes.get(String(item.episodes.volumeId))
    if (!owner) return `${path}.episodes.volumeId: 引用的 volume 不存在`
    if (owner.showId !== item.showId) return `${path}.showId: 与 volume 所属作品不一致`
    if (!Number.isInteger(item.episodes.from) || Number(item.episodes.from) < 1) return `${path}.episodes.from: 必须是正整数`
    if (!Number.isInteger(item.episodes.to) || Number(item.episodes.to) < Number(item.episodes.from) || Number(item.episodes.to) > owner.episodeCount) return `${path}.episodes.to: 必须不小于 from 且不超过 volume 集数`
    if (typeof item.recordedAt !== "string") return `${path}.recordedAt: 必须是字符串`
    if (!["manual", "import-inferred"].includes(String(item.source))) return `${path}.source: 不支持的来源`
    const error = validateWatchedAt(item.watchedAt, `${path}.watchedAt`)
    if (error) return error
  }
  return null
}

export const validData = (value: unknown) => validateData(value) === null

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function validExternalRef(value: unknown) {
  if (!record(value)) return false
  return value.provider === "tmdb" && Number.isInteger(value.seriesId) && Number(value.seriesId) > 0 && Number.isInteger(value.seasonNumber) && Number(value.seasonNumber) >= 0
}

function validateWatchedAt(value: unknown, path: string): string | null {
  if (!record(value)) return `${path}: 必须是对象`
  if (value.precision === "unknown") return null
  if (value.precision === "exact" || value.precision === "day") return typeof value.value === "string" && !Number.isNaN(Date.parse(value.value)) ? null : `${path}.value: 必须是有效日期`
  if (value.precision === "month") return typeof value.value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.value) ? null : `${path}.value: 必须是 YYYY-MM`
  if (value.precision === "year") return typeof value.value === "string" && /^\d{4}$/.test(value.value) ? null : `${path}.value: 必须是 YYYY`
  if (value.precision === "range") return typeof value.from === "string" && typeof value.to === "string" && typeof value.label === "string" && Boolean(value.label.trim()) && !Number.isNaN(Date.parse(value.from)) && !Number.isNaN(Date.parse(value.to)) ? null : `${path}: range 必须包含有效的 from、to 和 label`
  return `${path}.precision: 不支持的精度`
}
