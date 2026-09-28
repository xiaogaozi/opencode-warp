export interface DirectoryRef {
  directory?: string
}

export interface LocatableEvent {
  location?: DirectoryRef
  data?: {
    location?: DirectoryRef
    [key: string]: unknown
  }
}

export interface EventScope {
  /** Whether the event belongs to the plugin instance's location. */
  local: boolean
  /** Whether the event's directory could be resolved from the event or session data. */
  known: boolean
  /** Resolved event directory, when known. */
  directory?: string
}

export interface SessionDirectoryLookups {
  /** Synchronous lookup, e.g. the client-local session store. */
  local?: (sessionId: string) => string | undefined
  /** Authoritative asynchronous lookup, e.g. `client.session.get`. */
  remote?: (sessionId: string) => Promise<string | undefined>
}

export function normalizeDirectory(directory: string): string {
  const trimmed = directory.replace(/\/+$/, "")
  return trimmed === "" ? "/" : trimmed
}

/**
 * Resolves the directory an event belongs to, preferring explicit event data:
 * `event.location` -> `event.data.location` -> the session's cached location.
 */
export function resolveEventDirectory(
  event: LocatableEvent,
  sessionDirectory?: string,
): string | undefined {
  const directory =
    event.location?.directory ??
    event.data?.location?.directory ??
    sessionDirectory
  return directory || undefined
}

/**
 * Classifies an event against the local plugin location. V2 delivers durable
 * events for every location to every CLI plugin instance, so handlers must
 * ignore events that belong to another location. Unknown directories are
 * treated as local so notifications are not lost.
 */
export function classifyEvent(
  event: LocatableEvent,
  localDirectory: string,
  sessionDirectory?: string,
): EventScope {
  const directory = resolveEventDirectory(event, sessionDirectory)
  if (!directory) {
    return { local: true, known: false }
  }
  return {
    local: normalizeDirectory(directory) === normalizeDirectory(localDirectory),
    known: true,
    directory,
  }
}

/**
 * Classifies an event, falling back to session lookups when the event itself
 * carries no location. Some V2 execution lifecycle events (for example
 * `session.execution.succeeded`) have no `location`, so the client-local
 * session store or an authoritative `client.session.get` call is needed to
 * attribute them.
 */
export async function classifyEventWithFallback(
  event: LocatableEvent,
  localDirectory: string,
  sessionId: string | undefined,
  lookups: SessionDirectoryLookups = {},
): Promise<EventScope> {
  const local = sessionId ? lookups.local?.(sessionId) : undefined
  const scope = classifyEvent(event, localDirectory, local)
  if (scope.known || !sessionId || !lookups.remote) {
    return scope
  }

  let remote: string | undefined
  try {
    remote = await lookups.remote(sessionId)
  } catch {
    remote = undefined
  }
  if (!remote) {
    return scope
  }
  return classifyEvent(event, localDirectory, remote)
}
