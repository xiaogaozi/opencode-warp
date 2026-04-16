import type { Plugin } from "@opencode-ai/plugin"
import type { Event, Permission } from "@opencode-ai/sdk"

import { buildPayload } from "./payload"
import { warpNotify } from "./notify"
import { truncate, extractTextFromParts } from "./utils"
import pkg from "../package.json" with { type: "json" }

const PLUGIN_VERSION = pkg.version
const NOTIFICATION_TITLE = "warp://cli-agent"

function sendPermissionNotification(perm: Permission, cwd: string): void {
  const sessionId = perm.sessionID
  const toolName = perm.type || "unknown"
  const metadata = perm.metadata || {}

  let toolPreview = ""
  if (typeof metadata.command === "string") {
    toolPreview = metadata.command
  } else if (typeof metadata.file_path === "string") {
    toolPreview = metadata.file_path as string
  } else if (typeof metadata.filePath === "string") {
    toolPreview = metadata.filePath as string
  } else {
    const raw = JSON.stringify(metadata)
    toolPreview = raw.slice(0, 80)
  }

  let summary = `Wants to run ${toolName}`
  if (toolPreview) {
    summary += `: ${truncate(toolPreview, 120)}`
  }

  const body = buildPayload("permission_request", sessionId, cwd, {
    summary,
    tool_name: toolName,
    tool_input: metadata,
  })
  warpNotify(NOTIFICATION_TITLE, body)
}

export const WarpPlugin: Plugin = async ({ client, directory }) => {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) {
    await client.app.log({
      body: {
        service: "opencode-warp",
        level: "warn",
        message:
          "⚠️ Detected unsupported Warp version. Please update Warp to use this pluginDetected unsupported Warp version. Please update Warp to use this plugin",
      },
    })
    return {}
  }

  await client.app.log({
    body: {
      service: "opencode-warp",
      level: "info",
      message: "Warp plugin initialized",
    },
  })

  return {
    event: async ({ event }: { event: Event }) => {
      const cwd = directory || ""

      try {
        switch (event.type) {
          case "session.created": {
            const sessionId = event.properties.info.id
            const body = buildPayload("session_start", sessionId, cwd, {
              plugin_version: PLUGIN_VERSION,
            })
            warpNotify(NOTIFICATION_TITLE, body)
            return
          }

          case "session.idle": {
            const sessionId = event.properties.sessionID

            let query = ""
            let response = ""

            if (sessionId) {
              try {
                const result = await client.session.messages({
                  path: { id: sessionId },
                })
                const messages = result.data

                if (messages) {
                  const reversed = [...messages].reverse()

                  const lastUser = reversed.find(
                    (m) => m.info.role === "user",
                  )
                  if (lastUser) {
                    query = extractTextFromParts(lastUser.parts)
                  }

                  const lastAssistant = reversed.find(
                    (m) => m.info.role === "assistant",
                  )
                  if (lastAssistant) {
                    response = extractTextFromParts(lastAssistant.parts)
                  }
                }
              } catch {
                // If we can't fetch messages, send the notification without query/response
              }
            }

            const body = buildPayload("stop", sessionId, cwd, {
              query: truncate(query, 200),
              response: truncate(response, 200),
              transcript_path: "",
            })
            warpNotify(NOTIFICATION_TITLE, body)
            return
          }

          case "permission.updated": {
            sendPermissionNotification(event.properties, cwd)
            return
          }

          case "permission.replied": {
            const { sessionID, response } = event.properties
            if (response === "reject") return
            const body = buildPayload("permission_replied", sessionID, cwd)
            warpNotify(NOTIFICATION_TITLE, body)
            return
          }

          case "message.part.updated": {
            const part = (event.properties as { part: unknown }).part as {
              type: string
              tool?: string
              state?: { status: string }
              sessionID?: string
            }
            if (part?.type !== "tool" || !part?.state) return

            const sessionId = part.sessionID || ""

            if (part.tool === "question" && part.state.status === "running") {
              const body = buildPayload("question_asked", sessionId, cwd, {
                tool_name: part.tool,
              })
              warpNotify(NOTIFICATION_TITLE, body)
              return
            }

            if (part.state.status === "completed") {
              const body = buildPayload("tool_complete", sessionId, cwd, {
                tool_name: part.tool || "unknown",
              })
              warpNotify(NOTIFICATION_TITLE, body)
              return
            }
            return
          }

          case "message.updated": {
            const info = (event.properties as { info: { role?: string; sessionID?: string } }).info
            if (info?.role !== "user") return

            const sessionId = info.sessionID || ""
            const body = buildPayload("prompt_submit", sessionId, cwd, {
              query: "",
            })
            warpNotify(NOTIFICATION_TITLE, body)
            return
          }

          default: {
            // permission.asked is listed in the opencode docs but has no SDK type.
            // Handle it with the same logic as permission.updated.
            if ((event as any).type === "permission.asked") {
              sendPermissionNotification((event as any).properties, cwd)
            }
          }
        }
      } catch (err) {
        console.error(`[opencode-warp] event handler error for "${event.type}":`, err)
      }
    },
  }
}