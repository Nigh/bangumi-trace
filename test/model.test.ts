import { describe, expect, it } from "vitest"
import { emptyData, expandedEpisodes, externalEpisodeRange, hasWatchedAll, isBangumiData, mapCumulativeEpisode, matchesTitle, nextEpisode, normalizeBangumiData, nextVolumeEpisode, setDefaultAlias, setDefaultTitle, sortShowsByActivity, statusDisplay, uniqueTitles, volumeLabel, type BangumiData, type Show } from "../src/lib/model"
import { validateData } from "../shared/validation"

const show: Show = {
  id: "show-1", title: ["默认标题", "Japanese title", "English Title"], status: "watching",
  volumes: [
    { id: "s1", type: "正剧", episodeCount: 12 },
    { id: "ova1", type: "OVA", episodeCount: 2 },
    { id: "s2", type: "正剧", episodeCount: 12 },
  ],
}

describe("title arrays", () => {
  it("uses the first item as display title and searches every item", () => {
    expect(setDefaultTitle(show, 2).title).toEqual(["English Title", "默认标题", "Japanese title"])
    expect(matchesTitle(show, "japanese")).toBe(true)
    expect(uniqueTitles("默认标题", ["默认标题", "別名"])).toEqual(["默认标题", "別名"])
    expect(matchesTitle({ ...show, aliases: ["手动别名"] }, "手动")).toBe(true)
    expect(setDefaultAlias({ ...show, aliases: ["手动别名"] }, 0)).toMatchObject({ title: ["手动别名", "默认标题", "Japanese title", "English Title"], aliases: [] })
  })
})

describe("volumes and activity", () => {
  it("numbers each type and maps cumulative episodes", () => {
    expect(volumeLabel(show, show.volumes[2])).toBe("第二季")
    expect(volumeLabel(show, show.volumes[1])).toBe("OVA")
    expect(volumeLabel({ ...show, volumes: [...show.volumes, { id: "ova2", type: "OVA", episodeCount: 1 }] }, show.volumes[1])).toBe("OVA 1")
    expect(mapCumulativeEpisode(show, "正剧", 13)).toEqual({ volumeId: "s2", episode: 1 })
  })

  it("maps matching TMDB seasons continuously by volume type", () => {
    const ref = { provider: "tmdb" as const, seriesId: 1, seasonNumber: 1 }
    const linked = { ...show, volumes: [{ id: "s1", type: "正剧", episodeCount: 13, externalRef: ref }, { id: "ova", type: "OVA", episodeCount: 1, externalRef: ref }, { id: "s2", type: "正剧", episodeCount: 11, externalRef: ref }] }
    expect(externalEpisodeRange(linked, linked.volumes[0])).toEqual({ from: 1, to: 13 })
    expect(externalEpisodeRange(linked, linked.volumes[2])).toEqual({ from: 14, to: 24 })
  })

  it("continues the latest volume, then advances when full", () => {
    const data: BangumiData = { ...emptyData(), shows: [show], watchEvents: [{ ...event("s1", 12, "2026-09-12"), episodes: { volumeId: "s1", from: 1, to: 12 } }] }
    expect(nextEpisode(data, show.volumes[0])).toBeNull()
    expect(nextVolumeEpisode(data, show)).toEqual({ volume: show.volumes[1], episode: 1 })
  })

  it("sorts by watched date and expands ranges", () => {
    const other = { ...show, id: "show-2", title: ["Other"] as [string], volumes: [{ id: "other", type: "正剧", episodeCount: 1 }] }
    const data: BangumiData = { ...emptyData(), shows: [show, other], watchEvents: [event("s1", 1, "2026-09-12"), { ...event("other", 1, "2026-09-13"), showId: other.id }] }
    expect(sortShowsByActivity(data, data.shows).map((item) => item.id)).toEqual([other.id, show.id])
    expect(expandedEpisodes({ ...data.watchEvents[0], episodes: { volumeId: "s1", from: 2, to: 4 } })).toEqual([2, 3, 4])
  })
  it("distinguishes manual and actual completion", () => {
    const watching = { ...show, volumes: [{ id: "s1", type: "正剧", episodeCount: 2 }] }
    const partial: BangumiData = { ...emptyData(), shows: [watching], watchEvents: [event("s1", 2, "2026-09-12")] }
    expect(hasWatchedAll(partial, watching)).toBe(false)
    expect(nextEpisode(partial, watching.volumes[0])).toBe(1)
    expect(statusDisplay(partial, watching).label).toBe("正在追番")
    const complete = { ...partial, watchEvents: [event("s1", 1, "2026-09-12"), event("s1", 2, "2026-09-13")] }
    expect(statusDisplay(complete, watching).label).toBe("等待更新")
    expect(statusDisplay(partial, { ...watching, status: "completed" }).label).toBe("标记完成")
    expect(statusDisplay(complete, { ...watching, status: "completed" }).label).toBe("全部看完")
  })

})

describe("validation", () => {
  it("accepts version 5 and rejects old, oversized, or dangling data", () => {
    const data: BangumiData = { ...emptyData(), shows: [show], watchEvents: [event("s1", 1, "2026-09-12")] }
    expect(isBangumiData(data)).toBe(true)
    expect(isBangumiData({ ...data, shows: [{ ...show, note: "" }] })).toBe(true)
    expect(isBangumiData({ ...data, shows: [{ ...show, volumes: [{ ...show.volumes[0], externalRef: { provider: "tmdb", seriesId: 42, seasonNumber: 1 } }] }] })).toBe(true)
    expect(isBangumiData({ ...data, shows: [{ ...show, volumes: [{ ...show.volumes[0], externalRef: { provider: "bangumi", id: "1" } }] }] })).toBe(false)
    expect(isBangumiData({ ...data, version: 5 })).toBe(false)
    expect(isBangumiData({ ...data, shows: [{ ...show, note: "x".repeat(2049) }] })).toBe(false)
    expect(isBangumiData({ ...data, shows: [{ ...show, volumes: [{ id: "huge", type: "正剧", episodeCount: 257 }] }] })).toBe(false)
    expect(isBangumiData({ ...data, watchEvents: [{ ...data.watchEvents[0], episodes: { volumeId: "missing", from: 1, to: 1 } }] })).toBe(false)
  })
  it("migrates version 5 and validates folder mappings", () => {
    const current = { ...emptyData(), shows: [show] }
    const legacy = { version: 5, shows: current.shows, watchEvents: current.watchEvents, folders: current.folders }
    expect(normalizeBangumiData(legacy)?.version).toBe(6)
    expect(normalizeBangumiData({ ...legacy, version: 4 })).toBeNull()
    expect(isBangumiData({ ...current, folders: [{ id: "folder-1", name: "系列", showIds: [show.id] }] })).toBe(true)
    expect(isBangumiData({ ...current, folders: [{ id: "folder-1", name: "系列", showIds: ["missing"] }] })).toBe(false)
    expect(isBangumiData({ ...current, folders: [{ id: "folder-1", name: "系列", showIds: [show.id] }, { id: "folder-2", name: "重复", showIds: [show.id] }] })).toBe(false)
  })

  it("reports the first invalid data path", () => {
    const data: BangumiData = { ...emptyData(), shows: [show], watchEvents: [event("s1", 13, "2026-09-12")] }
    expect(validateData(data)).toBe("$.watchEvents[0].episodes.to: 必须不小于 from 且不超过 volume 集数")
  })

})

function event(volumeId: string, episode: number, day: string) {
  return { id: crypto.randomUUID(), showId: show.id, episodes: { volumeId, from: episode, to: episode }, watchedAt: { precision: "day" as const, value: day }, recordedAt: `${day}T12:00:00Z`, source: "manual" as const }
}
