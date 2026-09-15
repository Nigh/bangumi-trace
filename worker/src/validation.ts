type Volume = { id: string; type: string; episodeCount: number; externalRef?: unknown }

export function validData(value: unknown) {
  if (!value || typeof value !== "object") return false
  const data = value as { version?: unknown; shows?: unknown; watchEvents?: unknown; folders?: unknown }
  if (data.version !== 5 || !Array.isArray(data.shows) || !Array.isArray(data.watchEvents) || !Array.isArray(data.folders)) return false
  const volumeOwners = new Map<string, { showId: string; episodeCount: number }>()
  for (const show of data.shows) {
    if (!show || typeof show !== "object") return false
    const item = show as { id?: unknown; title?: unknown; status?: unknown; note?: unknown; volumes?: unknown }
    if (typeof item.id !== "string" || !Array.isArray(item.title) || !item.title.length ||
      !item.title.every((title) => typeof title === "string" && title.trim()) ||
      !["planned", "watching", "completed", "dropped"].includes(String(item.status)) ||
      item.note !== undefined && (typeof item.note !== "string" || item.note.length > 2048) || !Array.isArray(item.volumes)) return false
    for (const value of item.volumes) {
      const volume = value as Partial<Volume>
      if (!value || typeof value !== "object" || typeof volume.id !== "string" || volumeOwners.has(volume.id) ||
        typeof volume.type !== "string" || !volume.type.trim() || !Number.isInteger(volume.episodeCount) || Number(volume.episodeCount) < 1 || Number(volume.episodeCount) > 256 ||
        volume.externalRef !== undefined && !validExternalRef(volume.externalRef)) return false
      volumeOwners.set(volume.id, { showId: item.id, episodeCount: Number(volume.episodeCount) })
    }
  }
  const showIds = new Set(data.shows.map((show) => (show as { id: string }).id)), folderIds = new Set<string>(), assigned = new Set<string>()
  if (!data.folders.every((folder) => {
    if (!folder || typeof folder !== "object") return false
    const item = folder as { id?: unknown; name?: unknown; showIds?: unknown }
    return typeof item.id === "string" && !folderIds.has(item.id) && Boolean(folderIds.add(item.id)) && typeof item.name === "string" && Boolean(item.name.trim()) && Array.isArray(item.showIds) &&
      item.showIds.every((id) => typeof id === "string" && showIds.has(id) && !assigned.has(id) && Boolean(assigned.add(id)))
  })) return false
  return data.watchEvents.every((event) => {
    if (!event || typeof event !== "object") return false
    const item = event as { id?: unknown; showId?: unknown; episodes?: unknown; watchedAt?: unknown; recordedAt?: unknown; source?: unknown }
    const episodes = item.episodes as { volumeId?: unknown; from?: unknown; to?: unknown } | undefined
    const owner = episodes && volumeOwners.get(String(episodes.volumeId))
    if (typeof item.id !== "string" || typeof item.showId !== "string" || owner?.showId !== item.showId ||
      !Number.isInteger(episodes?.from) || !Number.isInteger(episodes?.to) || Number(episodes!.from) < 1 ||
      Number(episodes!.to) < Number(episodes!.from) || Number(episodes!.to) > owner.episodeCount ||
      typeof item.recordedAt !== "string" || !["manual", "import-inferred"].includes(String(item.source)) ||
      !item.watchedAt || typeof item.watchedAt !== "object") return false
    const watchedAt = item.watchedAt as Record<string, unknown>
    if (watchedAt.precision === "exact" || watchedAt.precision === "day") return typeof watchedAt.value === "string" && !Number.isNaN(Date.parse(watchedAt.value))
    if (watchedAt.precision === "month") return typeof watchedAt.value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(watchedAt.value)
    if (watchedAt.precision === "year") return typeof watchedAt.value === "string" && /^\d{4}$/.test(watchedAt.value)
    if (watchedAt.precision === "range") return typeof watchedAt.from === "string" && typeof watchedAt.to === "string" && typeof watchedAt.label === "string" && Boolean(watchedAt.label.trim()) && !Number.isNaN(Date.parse(watchedAt.from)) && !Number.isNaN(Date.parse(watchedAt.to))
    return watchedAt.precision === "unknown"
  })
}

function validExternalRef(value: unknown) {
  if (!value || typeof value !== "object") return false
  const ref = value as Record<string, unknown>
  return ref.provider === "tmdb" && Number.isInteger(ref.seriesId) && Number(ref.seriesId) > 0 && Number.isInteger(ref.seasonNumber) && Number(ref.seasonNumber) >= 0
}
