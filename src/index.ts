import type { Plugin } from "@opencode-ai/plugin"
import type { Event, Permission } from "@opencode-ai/sdk"

import { buildPayload } from "./payload"
import { warpNotify } from "./notify"
import { truncate, extractTextFromParts } from "./utils"
import pkg from "../package.json" with { type: "json" }

const PLUGIN_VERSION = pkg.version
const NOTIFICATION_TITLE = "warp://cli-agent"

type Logger = (msg: string) => void | Promise<void>

function sendPermissionNotification(
  perm: Permission,
  cwd: string,
  log?: Logger,
): void {
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
  const result = warpNotify(NOTIFICATION_TITLE, body)
  if (!result.success && log) {
    void log(`warpNotify failed: ${result.error}`)
  }
}

export const WarpPlugin: Plugin = async ({ client, directory }) => {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) {
    await client.app.log({
      body: {
        service: "opencode-warp",
        level: "warn",
        message:
          "⚠️ Detected unsupported Warp version. Please update Warp to use this plugin.",
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

  const log =
    (level: "info" | "error") =>
    (msg: string) => {
      void client.app.log({ body: { service: "opencode-warp", level, message: msg } })
    }

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
            const result = warpNotify(NOTIFICATION_TITLE, body)
            if (!result.success) {
              await log("error")(`warpNotify failed: ${result.error}`)
            }
            return
          }

          case "session.idle": {
            await log("info")("session.idle received")
            const sessionId = event.properties.sessionID

            let query = ""
            let response = ""

            if (sessionId) {
              await log("info")("Fetching session messages")
              try {
                const timeoutPromise = new Promise<never>((_, reject) => {
                  setTimeout(() => reject(new Error("timeout")), 5000)
                })
                const result = await Promise.race([
                  client.session.messages({ path: { id: sessionId } }),
                  timeoutPromise,
                ])
                await log("info")("Session messages fetched successfully")
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
              } catch (err) {
                await log("info")(`Session messages fetch failed or timed out: ${err}`)
                // If we can't fetch messages, send the notification without query/response
              }
            } else {
              await log("info")("No sessionId, skipping message fetch")
            }

            await log("info")("Sending warpNotify for session.idle")
            const body = buildPayload("stop", sessionId, cwd, {
              query: truncate(query, 200),
              response: truncate(response, 200),
              transcript_path: "",
            })
            const notifyResult = warpNotify(NOTIFICATION_TITLE, body)
            if (!notifyResult.success) {
              await log("error")(`warpNotify failed: ${notifyResult.error}`)
            } else {
              await log("info")("warpNotify succeeded for session.idle")
            }
            return
          }

          case "permission.updated": {
            sendPermissionNotification(event.properties, cwd, log("error"))
            return
          }

          case "permission.replied": {
            const { sessionID, response } = event.properties
            if (response === "reject") return
            const body = buildPayload("permission_replied", sessionID, cwd)
            const result = warpNotify(NOTIFICATION_TITLE, body)
            if (!result.success) {
              await log("error")(`warpNotify failed: ${result.error}`)
            }
            return
          }

          default: {
            if ((event as any).type === "permission.asked") {
              sendPermissionNotification(
                (event as any).properties,
                cwd,
                log("error"),
              )
              return
            }
            if ((event as any).type === "question.asked") {
              const props = (event as any).properties as {
                id?: string
                sessionID?: string
                questions?: Array<{ header?: string; question?: string }>
              }
              const sessionId = props?.sessionID || ""
              const questionInfo = props?.questions?.[0]
              const header = questionInfo?.header || "Question"
              const questionText = questionInfo?.question || ""
              const summary = `${header}${questionText ? `: ${truncate(questionText, 120)}` : ""}`

              const body = buildPayload("permission_request", sessionId, cwd, {
                summary,
                tool_name: "question",
                tool_input: { id: props?.id, questions: props?.questions },
              })
              const result = warpNotify(NOTIFICATION_TITLE, body)
              if (!result.success) {
                await log("error")(`warpNotify failed: ${result.error}`)
              }
              return
            }
          }
        }
      } catch (err) {
        await client.app.log({
          body: {
            service: "opencode-warp",
            level: "error",
            message: `Event handler error for ${(event as any).type}: ${err}`,
          },
        })
      }
    },
  }
}