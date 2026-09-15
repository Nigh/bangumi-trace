import { afterEach, describe, expect, it, vi } from "vitest"
import worker from "../src/index"
import { compressionWindow, needsCompression, sameUtcDay, saveParents } from "../src/history"
import { validData } from "../src/validation"

const env = {
  FRONTEND_ORIGIN: "https://nigh.github.io/bangumi-trace/",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "secret",
  SESSION_SECRET: btoa("12345678901234567890123456789012"),
  GITHUB_BRANCH: "main",
  GITHUB_DATA_PATH: "data/bangumi-app.json",
} as Env

const data = {
  version: 4,
  folders: [],
  shows: [{ id: "show-1", title: ["Primary", "Alternative"], status: "watching", volumes: [{ id: "s1", type: "正剧", episodeCount: 12 }] }],
  watchEvents: [{ id: "event-1", showId: "show-1", episodes: { volumeId: "s1", from: 1, to: 1 }, watchedAt: { precision: "day", value: "2026-09-14" }, recordedAt: "2026-09-14T12:00:00Z", source: "manual" }],
}

afterEach(() => vi.unstubAllGlobals())

describe("data boundary", () => {
  it("accepts version 4 and rejects old, oversized, or dangling data", () => {
    expect(validData(data)).toBe(true)
    expect(validData({ ...data, shows: [{ ...data.shows[0], note: "" }] })).toBe(true)
    expect(validData({ ...data, folders: [{ id: "folder-1", name: "系列", showIds: ["show-1"] }] })).toBe(true)
    expect(validData({ ...data, folders: [{ id: "folder-1", name: "系列", showIds: ["missing"] }] })).toBe(false)
    expect(validData({ ...data, version: 3 })).toBe(false)
    expect(validData({ ...data, shows: [{ ...data.shows[0], note: "x".repeat(2049) }] })).toBe(false)
    expect(validData({ ...data, shows: [{ ...data.shows[0], volumes: [{ id: "huge", type: "正剧", episodeCount: 257 }] }] })).toBe(false)
    expect(validData({ ...data, watchEvents: [{ ...data.watchEvents[0], watchedAt: { precision: "month", value: "2026-09" } }] })).toBe(true)
    expect(validData({ ...data, watchEvents: [{ ...data.watchEvents[0], watchedAt: { precision: "year", value: "2026" } }] })).toBe(true)
    expect(validData({ ...data, watchEvents: [{ ...data.watchEvents[0], episodes: { volumeId: "missing", from: 1, to: 1 } }] })).toBe(false)
    expect(validData({ ...data, watchEvents: [{ ...data.watchEvents[0], watchedAt: { precision: "year", value: "20" } }] })).toBe(false)
  })
})

describe("history policy", () => {
  it("uses UTC calendar days and keeps a baseline plus 30 operations", () => {
    expect(sameUtcDay("2026-09-14T00:01:00Z", "2026-09-14T23:59:00Z")).toBe(true)
    expect(sameUtcDay("2026-09-14T23:59:00Z", "2026-09-15T00:01:00Z")).toBe(false)
    expect(needsCompression(31)).toBe(false)
    expect(needsCompression(32)).toBe(true)
    expect(saveParents("head", ["parent"], "2026-09-14T00:01:00Z", "2026-09-14T23:59:00Z")).toEqual({ amend: true, parents: ["parent"] })
    expect(saveParents("head", ["parent"], "2026-09-14T23:59:00Z", "2026-09-15T00:01:00Z")).toEqual({ amend: false, parents: ["head"] })
    const commits = Array.from({ length: 32 }, (_, index) => index)
    expect(compressionWindow(commits)).toEqual({ recent: commits.slice(0, 30), cutoff: 30 })
  })
})

describe("frontend URL", () => {
  it("accepts the origin of a frontend deployed under a path", async () => {
    const request = new Request("https://worker.test/api/data", { method: "OPTIONS", headers: { Origin: "https://nigh.github.io" } })
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://nigh.github.io")
  })
})

describe("repository availability", () => {
  it("returns a stable error when the configured repository is unavailable", async () => {
    const cookie = await loginCookie()
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith("/repos/tester/bangumi-trace-data")) return new Response("{}", { status: 404 })
      throw new Error(`Unexpected request: ${url}`)
    }))
    const response = await worker.fetch(new Request("https://worker.test/api/data", { headers: { Origin: "https://nigh.github.io", Cookie: cookie } }), env)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: "DATA_REPOSITORY_UNAVAILABLE" })
  })

  it("treats a missing data file in an accessible repository as first use", async () => {
    const cookie = await loginCookie()
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith("/repos/tester/bangumi-trace-data")) return Response.json({})
      if (url.includes("/contents/data/bangumi-app.json")) return new Response("{}", { status: 404 })
      throw new Error(`Unexpected request: ${url}`)
    }))
    const response = await worker.fetch(new Request("https://worker.test/api/data", { headers: { Origin: "https://nigh.github.io", Cookie: cookie } }), env)
    expect(await response.json()).toEqual({ data: null, sha: null })
  })
})

async function loginCookie() {
  const login = await worker.fetch(new Request("https://worker.test/auth/login"), env)
  const oauthCookie = login.headers.get("set-cookie")!.split(";")[0]
  const state = new URL(login.headers.get("location")!).searchParams.get("state")!
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes("/login/oauth/access_token")) return Response.json({ access_token: "token" })
    if (url.endsWith("/user")) return Response.json({ login: "tester" })
    throw new Error(`Unexpected request: ${url}`)
  }))
  const callback = await worker.fetch(new Request(`https://worker.test/auth/callback?state=${state}&code=code`, { headers: { Cookie: oauthCookie } }), env)
  return callback.headers.get("set-cookie")!.match(/bt_session=[^;,]+/)![0]
}
