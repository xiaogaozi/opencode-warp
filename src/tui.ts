import { Plugin } from "@opencode/plugin/tui"

import { buildPayload } from "./payload"
import { warpNotify } from "./notify"
import { truncate, extractTextFromParts } from "./utils"
import { classifyEventWithFallback, type LocatableEvent } from "./location"
import pkg from "../package.json" with { type: "json" }

const PLUGIN_VERSION = pkg.version
const NOTIFICATION_TITLE = "warp://cli-agent"

type Logger = (msg: string) => void
type SessionOutcome = "succeeded" | "failed"

interface PermissionRequestData {
  sessionID: string
  action?: string
  resources?: readonly string[]
  metadata?: Record<string, unknown>
}

function sendPermissionNotification(
  data: PermissionRequestData,
  cwd: string,
  log?: Logger,
): void {
  const sessionId = data.sessionID
  const action = data.action || "unknown"
  const resources = data.resources ?? []
  const metadata = data.metadata || {}

  let preview = resources.join(", ")
  if (!preview) {
    if (typeof metadata.command === "string") {
      preview = metadata.command
    } else if (typeof metadata.file_path === "string") {
      preview = metadata.file_path
    } else if (typeof metadata.filePath === "string") {
      preview = metadata.filePath
    } else if (Object.keys(metadata).length > 0) {
      preview = JSON.stringify(metadata).slice(0, 80)
    }
  }

  let summary = `Wants to run ${action}`
  if (preview) {
    summary += `: ${truncate(preview, 120)}`
  }

  const body = buildPayload("permission_request", sessionId, cwd, {
    summary,
    tool_name: action,
    tool_input: metadata,
  })
  const result = warpNotify(NOTIFICATION_TITLE, body)
  if (!result.success && log) {
    log(`warpNotify failed: ${result.error}`)
  }
}

export default Plugin.define({
  id: "opencode-warp",
  setup(context) {
    if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) {
      return
    }

    const debugEnabled = Boolean(process.env.OPENCODE_WARP_DEBUG)
    const debug: Logger = (msg) => {
      if (debugEnabled) console.error(`[opencode-warp] ${msg}`)
    }

    const localDirectory =
      context.location?.directory ?? context.data.location.default().directory ?? ""

    const knownSessions = new Set<string>()
    const subagentCache = new Map<string, boolean>()

    const sessionDirectory = (sessionId?: string): string | undefined =>
      sessionId ? context.data.session.get(sessionId)?.location.directory : undefined

    const scopeEvent = async (
      type: string,
      event: LocatableEvent,
      sessionId?: string,
    ) => {
      const scope = await classifyEventWithFallback(
        event,
        localDirectory,
        sessionId,
        {
          local: (id) => sessionDirectory(id),
          // Execution lifecycle events carry no location; ask the server when
          // the local session store can't attribute them.
          remote: async (id) =>
            (await context.client.session.get({ sessionID: id })).location?.directory,
        },
      )
      if (!scope.local) {
        debug(`Skipping ${type}: location ${scope.directory}`)
      } else if (!scope.known) {
        debug(`Event location unknown; assuming local: ${type}`)
      }
      return scope
    }

    const isSubagentSession = async (sessionId?: string): Promise<boolean> => {
      if (!sessionId) return false
      const cached = subagentCache.get(sessionId)
      if (cached !== undefined) return cached

      const local = context.data.session.get(sessionId)
      if (local) {
        const result = !!local.parentID
        subagentCache.set(sessionId, result)
        return result
      }

      try {
        const session = await context.client.session.get({ sessionID: sessionId })
        const result = !!session.parentID
        subagentCache.set(sessionId, result)
        return result
      } catch {
        // If we can't resolve the session, fall through and notify anyway
        return false
      }
    }

    const sendSessionStart = (sessionId: string, cwd: string) => {
      knownSessions.add(sessionId)
      const body = buildPayload("session_start", sessionId, cwd, {
        plugin_version: PLUGIN_VERSION,
      })
      const result = warpNotify(NOTIFICATION_TITLE, body)
      if (!result.success) {
        debug(`warpNotify failed: ${result.error}`)
      }
    }

    const handleSessionDone = async (
      sessionId: string,
      cwd: string,
      outcome: SessionOutcome,
    ) => {
      debug(`session execution ${outcome}`)

      if (await isSubagentSession(sessionId)) {
        debug(`Suppressing notifications for subagent session: ${sessionId}`)
        return
      }

      if (sessionId && !knownSessions.has(sessionId)) {
        debug(`Resending session_start for unknown session: ${sessionId}`)
        sendSessionStart(sessionId, cwd)
      }

      let query = ""
      let response = ""

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), 5000)
        })
        const messages = await Promise.race([
          context.client.session.context({ sessionID: sessionId }),
          timeoutPromise,
        ])

        const reversed = [...messages].reverse()
        for (const message of reversed) {
          if (!query && message.type === "user") {
            query = message.text
          }
          if (!response && message.type === "assistant") {
            response = extractTextFromParts(message.content)
          }
          if (query && response) break
        }
      } catch (err) {
        debug(`Session messages fetch failed or timed out: ${err}`)
        // If we can't fetch messages, send the notification without query/response
      }

      const failed = outcome === "failed"
      const body = buildPayload(failed ? "stop_failure" : "stop", sessionId, cwd, {
        query: truncate(query, 200),
        response: truncate(response, 200),
        transcript_path: "",
        ...(failed ? { error_type: "execution_failed" } : {}),
      })
      const notifyResult = warpNotify(NOTIFICATION_TITLE, body)
      if (!notifyResult.success) {
        debug(`warpNotify failed: ${notifyResult.error}`)
      } else {
        debug(`warpNotify succeeded for session ${outcome}`)
      }
    }

    const unsubscribers = [
      context.data.on("session.created", (event) => {
        if (event.data.parentID) return
        void (async () => {
          const scope = await scopeEvent(event.type, event, event.data.sessionID)
          if (!scope.local) return
          sendSessionStart(event.data.sessionID, scope.directory ?? localDirectory)
        })()
      }),

      context.data.on("session.execution.succeeded", (event) => {
        void (async () => {
          const scope = await scopeEvent(event.type, event, event.data.sessionID)
          if (!scope.local) return
          await handleSessionDone(
            event.data.sessionID,
            scope.directory ?? localDirectory,
            "succeeded",
          )
        })().catch((err) => debug(`session done handler failed: ${err}`))
      }),

      context.data.on("session.execution.failed", (event) => {
        void (async () => {
          const scope = await scopeEvent(event.type, event, event.data.sessionID)
          if (!scope.local) return
          await handleSessionDone(
            event.data.sessionID,
            scope.directory ?? localDirectory,
            "failed",
          )
        })().catch((err) => debug(`session done handler failed: ${err}`))
      }),

      context.data.on("permission.asked", (event) => {
        void (async () => {
          const scope = await scopeEvent(event.type, event, event.data.sessionID)
          if (!scope.local) return
          if (await isSubagentSession(event.data.sessionID)) return
          sendPermissionNotification(
            event.data,
            scope.directory ?? localDirectory,
            debug,
          )
        })()
      }),

      context.data.on("permission.replied", (event) => {
        void (async () => {
          const { sessionID, reply } = event.data
          const scope = await scopeEvent(event.type, event, sessionID)
          if (!scope.local) return
          if (reply === "reject") return
          if (await isSubagentSession(sessionID)) return
          const body = buildPayload(
            "permission_replied",
            sessionID,
            scope.directory ?? localDirectory,
          )
          const result = warpNotify(NOTIFICATION_TITLE, body)
          if (!result.success) {
            debug(`warpNotify failed: ${result.error}`)
          }
        })()
      }),

      context.data.on("form.created", (event) => {
        void (async () => {
          const form = event.data.form
          const scope = await scopeEvent(event.type, event, form.sessionID)
          if (!scope.local) return
          if (await isSubagentSession(form.sessionID)) return
          const field = form.fields[0]
          const fieldText = field?.title || field?.description || field?.key || ""
          const summary = `${form.title || "Question"}${fieldText ? `: ${truncate(fieldText, 120)}` : ""}`

          const body = buildPayload(
            "permission_request",
            form.sessionID,
            scope.directory ?? localDirectory,
            {
              summary,
              tool_name: "question",
              tool_input: { id: form.id, fields: form.fields },
            },
          )
          const result = warpNotify(NOTIFICATION_TITLE, body)
          if (!result.success) {
            debug(`warpNotify failed: ${result.error}`)
          }
        })()
      }),
    ]

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  },
})
