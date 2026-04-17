import { describe, it, afterEach, mock } from "bun:test"
import { expect } from "bun:test"
import fs from "fs"

const writeFileSyncSpy = mock(() => {})

mock.module("fs", () => ({
  ...fs,
  writeFileSync: writeFileSyncSpy,
}))

const { warpNotify } = await import("../src/notify")

describe("warpNotify", () => {
  const originalVersion = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION

  afterEach(() => {
    writeFileSyncSpy.mockClear()
    if (originalVersion === undefined) {
      delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    } else {
      process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = originalVersion
    }
  })

  it("skips when WARP_CLI_AGENT_PROTOCOL_VERSION is not set", () => {
    delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    warpNotify("title", "body")
    expect(writeFileSyncSpy).not.toHaveBeenCalled()
  })

  it("writes OSC 777 sequence when Warp declares protocol support", () => {
    process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = "1"
    warpNotify("warp://cli-agent", '{"event":"stop"}')
    expect(writeFileSyncSpy).toHaveBeenCalledTimes(1)
    expect(writeFileSyncSpy).toHaveBeenCalledWith("/dev/tty", expect.stringMatching(/^\x1b\]777;notify;warp:\/\/cli-agent;.*\x07$/))
  })
})