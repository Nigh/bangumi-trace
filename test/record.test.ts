import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import ts from "typescript"
import { emptyData, nextEpisode } from "../src/lib/model"

// Run the form's actual handlers without a browser or additional test dependencies.
const source = readFileSync(new URL("../src/components/App.svelte", import.meta.url), "utf8")
const handlers = source.slice(source.indexOf("  function overlapsRecorded("), source.indexOf("  function record()"))
function form(watched: [number, number][], editing = "") {
  const show = { id: "show", volumes: [{ id: "full", episodeCount: 2 }, { id: "partial", episodeCount: 6 }] }
  const data = { ...emptyData(), shows: [show], watchEvents: [
    { id: "full-event", showId: "show", episodes: { volumeId: "full", from: 1, to: 2 } },
    ...watched.map(([from, to], index) => ({ id: `event-${index}`, showId: "show", episodes: { volumeId: "partial", from, to } }))
  ] }
  return new Function("data", "nextEpisode", `
    let selectedId = 'show', volumeId = 'partial', editingEventId = ${JSON.stringify(editing)}, episodeFrom = 0, episodeTo = 0, rangeAnchor = null, recordError = '', precision, watchedValue;
    const go = () => {}, nowForInput = () => '';
    ${ts.transpile(handlers)}
    return { start: () => startRecord(data.shows[0]), reset: resetRecordRange, select: selectRange, blocked: overlapsRecorded,
      state: () => ({ volumeId, episodeFrom, episodeTo, recordError }) };
  `)(data, nextEpisode)
}

describe("custom recording selection", () => {
  it("defaults to a volume with unwatched episodes and its first gap", () => {
    const f = form([[1, 2], [4, 4]])
    f.start()
    expect(f.state()).toMatchObject({ volumeId: "partial", episodeFrom: 3, episodeTo: 3 })
  })
  it("blocks watched endpoints and ranges crossing watched episodes in either direction", () => {
    const f = form([[3, 3]])
    f.reset(); f.select(3)
    expect(f.state()).toMatchObject({ episodeFrom: 1, episodeTo: 1 })
    f.select(2); f.select(5)
    expect(f.state()).toMatchObject({ episodeFrom: 2, episodeTo: 2 })
    const reverse = form([[3, 3]])
    reverse.select(5); reverse.select(2)
    expect(reverse.state()).toMatchObject({ episodeFrom: 5, episodeTo: 5 })
    f.select(1)
    expect(f.state()).toMatchObject({ episodeFrom: 1, episodeTo: 2, recordError: "" })
  })
  it("leaves no selection when full and excludes the record being edited", () => {
    const f = form([[1, 6]])
    f.reset()
    expect(f.state().episodeFrom).toBe(0)
    expect(form([[1, 3], [4, 4]], "event-0").blocked(1, 3)).toBe(false)
    expect(form([[1, 3], [4, 4]], "event-0").blocked(1, 4)).toBe(true)
  })
})
