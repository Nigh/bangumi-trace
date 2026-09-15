import { emptyData, normalizeBangumiData, type BangumiData } from "./model"
const origin = (import.meta.env.PUBLIC_WORKER_ORIGIN || "http://localhost:8787").replace(/\/$/, "")
async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${origin}${path}`, { credentials: "include", ...init })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string; code?: string } | null
    throw Object.assign(new Error(body?.error || response.statusText), { status: response.status, code: body?.code })
  }
  return response
}
export const loginUrl = `${origin}/auth/login`
export const logout = () => request("/auth/logout", { method: "POST" })
export async function loadData(): Promise<{ data: BangumiData; sha: string | null }> {
  const payload = await (await request("/api/data")).json() as { data?: unknown; sha?: string | null }
  const source = payload.data ?? emptyData(), data = normalizeBangumiData(source)
  if (!data) throw new Error("远端数据格式无效")
  return { data, sha: payload.sha ?? null }
}
export async function saveData(data: BangumiData, sha: string | null) {
  return (await request("/api/data", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data, sha }) })).json() as Promise<{ sha: string }>
}
export async function searchTmdb(query: string) {
  return (await request(`/api/tmdb/search?q=${encodeURIComponent(query)}`)).json() as Promise<{ data: { id: number; name: string; originalName: string; firstAirDate?: string; poster?: string }[] }>
}
export async function getTmdbSeries(id: number) {
  return (await request(`/api/tmdb/series/${id}`)).json() as Promise<{ id: number; titles: string[]; seasons: { seasonNumber: number; name: string; episodeCount: number; airDate?: string }[] }>
}
