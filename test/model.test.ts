import { describe, expect, it } from "vitest"
import { emptyData, isBangumiData, matchesTitle, nextEpisodes, reorderTitle, uniqueTitles, withEpisodeMapping } from "../src/lib/model"

const show = { id: "show-1", title: ["默认标题", "Japanese title", "English Title"] as [string, ...string[]], status: "watching" as const, numbering: { seasons: [{ season: 2, absoluteStart: 12 }] } }

describe("title arrays", () => {
  it("uses the first item as display title and searches every item", () => {
    expect(reorderTitle(show, 2, 0).title[0]).toBe("English Title")
    expect(matchesTitle(show, "japanese")).toBe(true)
    expect(uniqueTitles("默认标题", ["默认标题", "別名"])).toEqual(["默认标题", "別名"])
  })
  it("rejects aliases and empty title arrays", () => {
    expect(isBangumiData({ version: 1, shows: [{ ...show, aliases: [] }], watchEvents: [] })).toBe(false)
    expect(isBangumiData({ version: 1, shows: [{ ...show, title: [] }], watchEvents: [] })).toBe(false)
  })
})

describe("episodes", () => {
  it("maps season numbering and finds the next episode", () => {
    expect(withEpisodeMapping(show, { season: 2, from: 3, to: 3 })).toEqual({ season: 2, from: 3, to: 3, absoluteFrom: 14, absoluteTo: 14 })
    const data = { ...emptyData(), shows: [show], watchEvents: [{ id: "e", showId: show.id, episodes: { season: 2, from: 3, to: 3, absoluteFrom: 14, absoluteTo: 14 }, watchedAt: { precision: "unknown" as const }, recordedAt: "2026-09-14T00:00:00Z", source: "manual" as const }] }
    expect(nextEpisodes(data, show)).toEqual({ season: 2, from: 4, to: 4, absoluteFrom: 15, absoluteTo: 15 })
  })
})
