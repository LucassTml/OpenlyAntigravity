/**
 * Helpers around the local Antigravity CLI (`agy`).
 *
 * Every call spawns `agy` as a child process, so requests run under the login
 * that already exists in your terminal. No API keys are read or stored here.
 */
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"

export const PROVIDER_ID = "agy"

// Set by the plugin's `model.request` hook so the provider knows which
// OpenCode session (and project directory) a model call belongs to.
export const HEADER_SESSION = "x-agy-session-id"
export const HEADER_DIRECTORY = "x-agy-directory"
export const HEADER_KIND = "x-agy-request-kind"

const home = os.homedir()
const dataDir = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share")
const cacheDir = process.env.XDG_CACHE_HOME ?? path.join(home, ".cache")
export const LOG_FILE = path.join(dataDir, "opencode", "log", "agy-provider.log")
export const MODEL_CACHE_FILE = path.join(cacheDir, "opencode", "agy-models.json")
export const CONVERSATION_FILE = path.join(cacheDir, "opencode", "agy-conversations.json")
const CONVERSATION_TTL_MS = 7 * 24 * 60 * 60_000

export class AgyError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = "AgyError"
    this.details = details
  }
}

/** Explicit setting → $AGY_PATH → default install location → `agy` on PATH. */
export function resolveAgyPath(configured) {
  if (configured) return configured
  if (process.env.AGY_PATH) return process.env.AGY_PATH
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
  const installed =
    process.platform === "win32" ? path.join(localAppData, "agy", "bin", "agy.exe") : path.join(home, ".local", "bin", "agy")
  return existsSync(installed) ? installed : "agy"
}

/**
 * "edit" (default): agy may read and write files inside the session folder and `addDirs`;
 *                   shell commands and everything else stay blocked.
 * "read-only":      agy's own defaults; in headless mode writes are auto-denied.
 * "skip":           --dangerously-skip-permissions, no restrictions at all.
 */
export function permissionLevel(settings) {
  const value = settings.permissions ?? "edit"
  if (value === "default") return "read-only" // name used by earlier versions of this plugin
  if (value === "edit" || value === "read-only" || value === "skip") return value
  log("warn", `unknown permissions value ${JSON.stringify(value)}; using "read-only"`)
  return "read-only"
}

export function buildAgyArgs(modelId, settings, conversationId) {
  const level = permissionLevel(settings)
  const args = ["--output-format", "stream-json", "--input-format", "stream-json", "--disable-slash-commands"]
  args.push("--model", modelId)
  if (conversationId) args.push("--conversation", conversationId)
  if (settings.effort) args.push("--effort", String(settings.effort))
  // accept-edits auto-approves file reads/writes inside the workspace only (verified:
  // writes outside it and shell commands are still denied).
  const mode = settings.mode ?? (level === "edit" ? "accept-edits" : undefined)
  if (mode) args.push("--mode", String(mode))
  for (const dir of settings.addDirs ?? []) args.push("--add-dir", String(dir))
  if (settings.sandbox) args.push("--sandbox")
  if (level === "skip") args.push("--dangerously-skip-permissions")
  if (settings.printTimeout) args.push("--print-timeout", String(settings.printTimeout))
  // `-p=` turns on print mode with an empty inline prompt; the real prompt goes
  // over stdin, which avoids the ~32K-character Windows command-line limit.
  args.push("-p=")
  return args
}

/**
 * Run one print-mode turn. Yields the NDJSON events agy writes to stdout
 * (`init`, `step_update`, `result`); `done` settles when the process exits.
 */
export function startAgyTurn({ agyPath, args, prompt, cwd, abortSignal }) {
  const child = spawn(agyPath, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })

  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-16_000)
  })

  const kill = () => {
    if (child.exitCode !== null || child.pid === undefined) return
    if (process.platform === "win32") {
      // agy starts helper processes; kill the whole tree.
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {})
    } else {
      child.kill("SIGTERM")
    }
  }
  if (abortSignal?.aborted) kill()
  abortSignal?.addEventListener("abort", kill, { once: true })

  const done = new Promise((resolve, reject) => {
    child.once("error", (error) => reject(error))
    child.once("close", (code) => {
      abortSignal?.removeEventListener("abort", kill)
      resolve({ code, stderr: stripAnsi(stderr) })
    })
  })
  // Surface spawn failures through `done`, not as an unhandled rejection.
  done.catch(() => {})

  child.stdin.on("error", () => {}) // EPIPE if agy exits before reading stdin
  const message = { event: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }
  child.stdin.end(JSON.stringify(message) + "\n")

  async function* events() {
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    for await (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        yield JSON.parse(trimmed)
      } catch {
        yield { event: "raw", line: trimmed }
      }
    }
  }

  return { events: events(), done, kill, pid: child.pid }
}

/** `agy models` prints one `id<TAB>display name` line per model on stdout. */
export async function listAgyModels({ agyPath, timeoutMs = 30_000 } = {}) {
  const bin = resolveAgyPath(agyPath)
  const { code, stdout, stderr } = await new Promise((resolve, reject) => {
    const child = spawn(bin, ["models"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    child.stdout.setEncoding("utf8").on("data", (c) => (out += c))
    child.stderr.setEncoding("utf8").on("data", (c) => (err = (err + c).slice(-4_000)))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("close", (exit) => {
      clearTimeout(timer)
      resolve({ code: exit, stdout: out, stderr: err })
    })
  })
  if (code !== 0) throw new AgyError(`\`agy models\` exited with code ${code}: ${summarize(stripAnsi(stderr))}`)
  return parseModelList(stdout)
}

export function parseModelList(stdout) {
  const models = []
  for (const raw of stripAnsi(stdout).split(/\r?\n/)) {
    const [id, ...rest] = raw.trim().split("\t")
    if (!id || !/^[\w.:-]+$/.test(id)) continue
    models.push({ id, name: rest.join(" ").trim() || id })
  }
  return models
}

export function readModelCache() {
  try {
    const data = JSON.parse(readFileSync(MODEL_CACHE_FILE, "utf8"))
    return Array.isArray(data.models) && data.models.length ? data.models : undefined
  } catch {
    return undefined
  }
}

export function writeModelCache(models) {
  try {
    mkdirSync(path.dirname(MODEL_CACHE_FILE), { recursive: true })
    writeFileSync(MODEL_CACHE_FILE, JSON.stringify({ updated: new Date().toISOString(), models }, null, 2))
  } catch (error) {
    log("warn", "could not write model cache", { error: String(error) })
  }
}

/**
 * OpenCode session ID → the agy conversation that already holds its history.
 * Kept on disk so resuming survives OpenCode restarts; a lost or stale entry
 * only means the next turn replays the transcript.
 */
export function getConversation(sessionID) {
  const entry = readConversations()[sessionID]
  return entry && Date.now() - entry.at < CONVERSATION_TTL_MS ? entry : undefined
}

export function setConversation(sessionID, value) {
  const now = Date.now()
  const all = readConversations()
  if (value) all[sessionID] = { ...value, at: now }
  else delete all[sessionID]
  const kept = Object.entries(all)
    .filter(([, entry]) => now - entry.at < CONVERSATION_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 500)
  try {
    mkdirSync(path.dirname(CONVERSATION_FILE), { recursive: true })
    const temp = `${CONVERSATION_FILE}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(Object.fromEntries(kept)))
    renameSync(temp, CONVERSATION_FILE)
  } catch (error) {
    log("warn", "could not save agy conversation map", { error: String(error) })
  }
}

function readConversations() {
  try {
    return JSON.parse(readFileSync(CONVERSATION_FILE, "utf8"))
  } catch {
    return {}
  }
}

/** Explain how to allow what agy was denied, per permission kind. */
export function denialHint(actions, settings) {
  const kinds = new Set(actions.map((action) => action.action))
  const hints = []
  if (kinds.has("write_file") || kinds.has("read_file")) {
    hints.push(
      permissionLevel(settings) === "read-only"
        ? `File writes are off ("permissions": "read-only"); set "permissions": "edit" in providers.agy.settings.`
        : `agy may only read/write inside the folder this session was opened in; add other folders to "addDirs" in providers.agy.settings.`,
    )
    kinds.delete("write_file")
    kinds.delete("read_file")
  }
  if (kinds.has("command")) {
    hints.push(`Shell commands are blocked; allow specific ones in agy's settings.json (e.g. "command(git status)") or set "permissions": "skip".`)
    kinds.delete("command")
  }
  if (kinds.size) hints.push(`Allow ${[...kinds].join(", ")} in agy's settings.json permissions.allow, or set "permissions": "skip".`)
  return hints.join(" ")
}

/** Turn raw agy/stderr output into an actionable message. */
export function describeFailure(text, agyPath) {
  const detail = summarize(text)
  if (/ENOENT|not recognized as an internal|no such file/i.test(detail))
    return `Could not start agy (${agyPath}). Install it or set "agyPath" in providers.agy.settings. ${detail}`
  if (/not recognized as a known model/i.test(detail))
    return `agy does not offer this model any more; run \`agy models\` and restart OpenCode to refresh the list. (${detail})`
  if (/not authenticated|unauthenticated|sign[ -]?in|log[ -]?in required|oauth|credential/i.test(detail))
    return `agy is not signed in. Run \`agy\` once in a terminal, finish the login, then retry. (${detail})`
  if (/quota|rate limit|resource.?exhausted|429/i.test(detail)) return `agy hit a quota or rate limit: ${detail}`
  return detail || "agy failed without output"
}

export function debugEnabled(settings) {
  return Boolean(settings?.debug) || process.env.AGY_OPENCODE_DEBUG === "1"
}

export function log(level, message, data) {
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level.toUpperCase()} ${message}${data ? " " + JSON.stringify(data) : ""}\n`)
  } catch {
    // Logging must never break a request.
  }
}

export function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[⠀-⣿]/g, "") // spinner glyphs
}

/** agy puts the cause on the first error line and details (e.g. model lists) after it. */
function summarize(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const first = lines.findIndex((line) => /error|failed|invalid|denied|not recognized|unauthenticated|ENOENT/i.test(line))
  return (first >= 0 ? lines.slice(first, first + 3) : lines.slice(-6)).join(" | ").slice(0, 1_500)
}
