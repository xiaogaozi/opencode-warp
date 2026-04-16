import { writeFileSync } from "fs"

const MAX_OSC_LENGTH = 4096

function warpNotify(title: string, body: string): void {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return

  const maxBodyLength = MAX_OSC_LENGTH - title.length - 20
  const truncatedBody =
    body.length > maxBodyLength ? body.slice(0, maxBodyLength - 3) + "..." : body

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