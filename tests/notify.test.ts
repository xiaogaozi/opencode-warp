import { describe, it, afterEach, mock } from "bun:test"
import { expect } from "bun:test"
import fs from "fs"

const writeSyncSpy = mock(() => {})
const openSyncSpy = mock(() => 42)
const closeSyncSpy = mock(() => {})

mock.module("fs", () => ({
  ...fs,
  openSync: openSyncSpy,
  writeSync: writeSyncSpy,
  closeSync: closeSyncSpy,
}))

const { warpNotify } = await import("../src/notify")

describe("warpNotify", () => {
  const originalVersion = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION

  afterEach(() => {
    openSyncSpy.mockClear()
    writeSyncSpy.mockClear()
    closeSyncSpy.mockClear()
    if (originalVersion === undefined) {
      delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    } else {
      process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalVersion
    }
  })

  it("skips when WARP_CLI_AGENT_PROTOCOL_VERSION is not set", () => {
    delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    warpNotify("title", "body")
    expect(openSyncSpy).not.toHaveBeenCalled()
  })

  it("writes OSC 777 sequence when Warp declares protocol support", () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    warpNotify("warp://cli-agent", '{"event":"stop"}')
    expect(openSyncSpy).toHaveBeenCalledTimes(1)
    expect(openSyncSpy).toHaveBeenCalledWith("/dev/tty", "w")
    expect(writeSyncSpy).toHaveBeenCalledTimes(1)
    expect(closeSyncSpy).toHaveBeenCalledTimes(1)

    const [, data] = writeSyncSpy.mock.calls[0] as [number, string]
    expect(data).toContain("warp://cli-agent")
    expect(data).toContain('{"event":"stop"}')
    expect(data).toMatch(/^\x1b\]777;notify;/)
    expect(data).toMatch(/\x07$/)
  })
})