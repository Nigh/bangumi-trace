type Volume = { id: string; type: string; episodeCount: number }

export function validData(value: unknown) {
  if (!value || typeof value !== "object") return false
  const data = value as { version?: unknown; shows?: unknown; watchEvents?: unknown }
  if (data.version !== 3 || !Array.isArray(data.shows) || !Array.isArray(data.watchEvents)) return false
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
        typeof volume.type !== "string" || !volume.type.trim() || !Number.isInteger(volume.episodeCount) || Number(volume.episodeCount) < 1) return false
      volumeOwners.set(volume.id, { showId: item.id, episodeCount: Number(volume.episodeCount) })
    }
  }
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
    if (watchedAt.precision === "range") return typeof watchedAt.from === "string" && typeof watchedAt.to === "string" && typeof watchedAt.label === "string" && Boolean(watchedAt.label.trim()) && !Number.isNaN(Date.parse(watchedAt.from)) && !Number.isNaN(Date.parse(watchedAt.to))
    return watchedAt.precision === "unknown"
  })
}
