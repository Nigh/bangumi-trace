import { describe, expect, it } from "vitest"
import worker from "../src/index"
import { validData } from "../src/validation"

describe("data boundary", () => {
  const show = { id: "show-1", title: ["Primary", "Alternative"], status: "watching" }

  it("accepts title arrays and rejects aliases", () => {
    expect(validData({ version: 1, shows: [show], watchEvents: [] })).toBe(true)
    expect(validData({ version: 1, shows: [{ ...show, aliases: [] }], watchEvents: [] })).toBe(false)
    expect(validData({ version: 1, shows: [{ ...show, title: [] }], watchEvents: [] })).toBe(false)
  })
})


describe("frontend URL", () => {
  it("accepts the origin of a frontend deployed under a path", async () => {
    const request = new Request("https://worker.test/api/data", { method: "OPTIONS", headers: { Origin: "https://nigh.github.io" } })
    const response = await worker.fetch(request, { FRONTEND_ORIGIN: "https://nigh.github.io/bangumi-trace/" } as Env)
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("https://nigh.github.io")
  })
})
