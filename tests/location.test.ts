import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  classifyEvent,
  classifyEventWithFallback,
  normalizeDirectory,
  resolveEventDirectory,
} from "../src/location"

describe("resolveEventDirectory", () => {
  it("prefers event.location over data.location", () => {
    assert.strictEqual(
      resolveEventDirectory({
        location: { directory: "/project/a" },
        data: { location: { directory: "/project/b" } },
      }),
      "/project/a",
    )
  })

  it("falls back to data.location", () => {
    assert.strictEqual(
      resolveEventDirectory({ data: { location: { directory: "/project/b" } } }),
      "/project/b",
    )
  })

  it("falls back to the session directory", () => {
    assert.strictEqual(resolveEventDirectory({}, "/project/c"), "/project/c")
  })

  it("returns undefined when nothing is known", () => {
    assert.strictEqual(resolveEventDirectory({}), undefined)
  })

  it("ignores empty directories", () => {
    assert.strictEqual(resolveEventDirectory({ location: { directory: "" } }), undefined)
  })
})

describe("normalizeDirectory", () => {
  it("strips trailing slashes", () => {
    assert.strictEqual(normalizeDirectory("/project/a/"), "/project/a")
  })

  it("keeps the root directory", () => {
    assert.strictEqual(normalizeDirectory("/"), "/")
    assert.strictEqual(normalizeDirectory("///"), "/")
  })

  it("returns the directory unchanged when there is nothing to strip", () => {
    assert.strictEqual(normalizeDirectory("/project/a"), "/project/a")
  })
})

describe("classifyEvent", () => {
  it("marks an event in the local directory as local", () => {
    assert.deepStrictEqual(
      classifyEvent({ location: { directory: "/project/a" } }, "/project/a"),
      { local: true, known: true, directory: "/project/a" },
    )
  })

  it("marks an event in another directory as foreign", () => {
    const scope = classifyEvent({ location: { directory: "/project/b" } }, "/project/a")
    assert.strictEqual(scope.local, false)
    assert.strictEqual(scope.known, true)
    assert.strictEqual(scope.directory, "/project/b")
  })

  it("treats trailing slashes as equal", () => {
    assert.strictEqual(
      classifyEvent({ location: { directory: "/project/a/" } }, "/project/a").local,
      true,
    )
  })

  it("uses the session directory fallback", () => {
    const scope = classifyEvent({}, "/project/a", "/project/a")
    assert.strictEqual(scope.local, true)
    assert.strictEqual(scope.known, true)
  })

  it("assumes local when the directory is unknown", () => {
    assert.deepStrictEqual(classifyEvent({}, "/project/a"), {
      local: true,
      known: false,
    })
  })
})

describe("classifyEventWithFallback", () => {
  it("prefers an event location over the lookups", async () => {
    let remoteCalled = false
    const scope = await classifyEventWithFallback(
      { location: { directory: "/project/a" } },
      "/project/a",
      "ses_1",
      {
        local: () => "/project/b",
        remote: async () => {
          remoteCalled = true
          return "/project/b"
        },
      },
    )
    assert.strictEqual(scope.local, true)
    assert.strictEqual(remoteCalled, false)
  })

  it("uses the local session lookup when the event has no location", async () => {
    const scope = await classifyEventWithFallback({}, "/project/a", "ses_1", {
      local: () => "/project/b",
      remote: async () => "/project/b",
    })
    assert.strictEqual(scope.local, false)
    assert.strictEqual(scope.known, true)
    assert.strictEqual(scope.directory, "/project/b")
  })

  it("falls back to the remote lookup when the local store misses", async () => {
    let remoteId: string | undefined
    const scope = await classifyEventWithFallback({}, "/project/a", "ses_1", {
      local: () => undefined,
      remote: async (id) => {
        remoteId = id
        return "/project/b"
      },
    })
    assert.strictEqual(remoteId, "ses_1")
    assert.strictEqual(scope.local, false)
    assert.strictEqual(scope.directory, "/project/b")
  })

  it("treats an unresolvable session as local and unknown", async () => {
    const scope = await classifyEventWithFallback({}, "/project/a", "ses_1", {
      local: () => undefined,
      remote: async () => undefined,
    })
    assert.deepStrictEqual(scope, { local: true, known: false })
  })

  it("assumes local when the remote lookup throws", async () => {
    const scope = await classifyEventWithFallback({}, "/project/a", "ses_1", {
      remote: async () => {
        throw new Error("boom")
      },
    })
    assert.deepStrictEqual(scope, { local: true, known: false })
  })

  it("skips the remote lookup without a session id", async () => {
    let remoteCalled = false
    const scope = await classifyEventWithFallback({}, "/project/a", undefined, {
      remote: async () => {
        remoteCalled = true
        return "/project/b"
      },
    })
    assert.strictEqual(remoteCalled, false)
    assert.deepStrictEqual(scope, { local: true, known: false })
  })
})
