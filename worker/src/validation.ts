export function validData(value: unknown) {
  if (!value || typeof value !== "object") return false
  const data = value as { version?: unknown; shows?: unknown; watchEvents?: unknown }
  const showsValid = data.version === 1 && Array.isArray(data.shows) && data.shows.every((show) => {
    if (!show || typeof show !== "object" || "aliases" in show) return false
    const item = show as { id?: unknown; title?: unknown; status?: unknown }
    return typeof item.id === "string" && Array.isArray(item.title) && item.title.length > 0 && item.title.every((title) => typeof title === "string" && title.trim().length > 0) && ["planned", "watching", "completed", "dropped"].includes(String(item.status))
  })
  if (!showsValid || !Array.isArray(data.watchEvents)) return false
  const showIds = new Set((data.shows as { id: string }[]).map((show) => show.id))
  return data.watchEvents.every((event) => {
    if (!event || typeof event !== "object") return false
    const item = event as { id?: unknown; showId?: unknown; episodes?: unknown; watchedAt?: unknown; recordedAt?: unknown; source?: unknown }
    if (typeof item.id !== "string" || typeof item.showId !== "string" || !showIds.has(item.showId) || typeof item.recordedAt !== "string" || !["manual", "import-inferred"].includes(String(item.source))) return false
    if (!item.episodes || typeof item.episodes !== "object" || !Object.values(item.episodes).some((value) => Number.isInteger(value) && Number(value) > 0)) return false
    if (!item.watchedAt || typeof item.watchedAt !== "object") return false
    return ["exact", "day", "range", "unknown"].includes(String((item.watchedAt as { precision?: unknown }).precision))
  })
}
