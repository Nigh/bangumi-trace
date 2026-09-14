import { describe, expect, it } from "vitest"
import { validData } from "../src/validation"

describe("data boundary", () => {
  const show = { id: "show-1", title: ["Primary", "Alternative"], status: "watching" }

  it("accepts title arrays and rejects aliases", () => {
    expect(validData({ version: 1, shows: [show], watchEvents: [] })).toBe(true)
    expect(validData({ version: 1, shows: [{ ...show, aliases: [] }], watchEvents: [] })).toBe(false)
    expect(validData({ version: 1, shows: [{ ...show, title: [] }], watchEvents: [] })).toBe(false)
  })
})
