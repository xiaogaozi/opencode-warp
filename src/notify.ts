import { writeFileSync } from "fs"

const MAX_OSC_LENGTH = 4096

function escapeOSCString(str: string): string {
  return str
    .replace(/\x1b/g, "\x1b\x5d")
    .replace(/\x07/g, "\x1b\x5c\x07")
    .replace(/;/g, "\\;")
}

function warpNotify(title: string, body: string): void {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return

  const maxBodyLength = MAX_OSC_LENGTH - title.length - 20
  const escapedBody = escapeOSCString(body)
  const truncatedBody =
    escapedBody.length > maxBodyLength
      ? escapedBody.slice(0, maxBodyLength - 3) + "..."
      : escapedBody

  const sequence = `\x1b]777;notify;${title};${truncatedBody}\x07`

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync("/dev/tty", sequence)
      return
    } catch (err) {
      lastError = err as Error
    }
  }

  console.error(
    `[opencode-warp] Failed to send Warp notification after 3 attempts: ${lastError?.message}`,
  )
}

export { warpNotify }