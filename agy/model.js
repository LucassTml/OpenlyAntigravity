/**
 * AI SDK language model (LanguageModelV3) that answers through the local `agy` CLI.
 *
 * Loaded on demand by provider.js, which re-imports this file (and agy.js) whenever
 * they change, so edits here apply without restarting OpenCode.
 *
 * Settings (providers.agy.settings in opencode.json):
 *   agyPath        agy executable (default: $AGY_PATH, the default install dir, then PATH)
 *   permissions    "edit" (default: read/write files in the session folder, no shell commands)
 *                  | "read-only" | "skip" (no restrictions)
 *   addDirs        extra folders agy may read/write, e.g. ["C:/Users/me/Notes"] → --add-dir
 *   mode           "plan" | "accept-edits" — overrides the mode chosen by `permissions`
 *   effort         "low" | "medium" | "high" | "max"       → --effort
 *   sandbox        true                                    → --sandbox
 *   printTimeout   e.g. "15m"                              → --print-timeout
 *   toolActivity   "reasoning" (default) | "off"  — show agy's own tool steps as reasoning
 *   system         "wrap" (default) | "omit"      — forward OpenCode's system prompt or not
 *   resume         true (default) — continue agy's conversation while history is unchanged
 *   cwd            fallback working directory when the session directory is unknown
 *   debug          true — log prompts and arguments to agy-provider.log
 */
import { createHash } from "node:crypto"
import {
  AgyError,
  HEADER_DIRECTORY,
  HEADER_KIND,
  HEADER_SESSION,
  PROVIDER_ID,
  buildAgyArgs,
  debugEnabled,
  denialHint,
  describeFailure,
  getConversation,
  log,
  resolveAgyPath,
  setConversation,
  startAgyTurn,
} from "./agy.js"

export class AgyLanguageModel {
  specificationVersion = "v3"
  provider = PROVIDER_ID
  supportedUrls = {}

  constructor(modelId, settings) {
    this.modelId = modelId
    this.settings = settings
  }

  async doGenerate(options) {
    const { stream } = await this.doStream(options)
    const reader = stream.getReader()
    let text = ""
    let reasoning = ""
    let warnings = []
    let usage = mapUsage()
    let finishReason = { unified: "other", raw: undefined }
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (value.type === "stream-start") warnings = value.warnings
      if (value.type === "text-delta") text += value.delta
      if (value.type === "reasoning-delta") reasoning += value.delta
      if (value.type === "finish") ({ usage, finishReason } = value)
      if (value.type === "error") throw value.error
    }
    const content = reasoning ? [{ type: "reasoning", text: reasoning }] : []
    content.push({ type: "text", text })
    return { content, finishReason, usage, warnings }
  }

  async doStream(options) {
    const settings = this.settings
    const headers = lowerKeys(options.headers)
    const sessionID = headers[HEADER_SESSION]
    const kind = headers[HEADER_KIND] ?? "primary"
    const cwd = headers[HEADER_DIRECTORY] || settings.cwd || process.cwd()
    const agyPath = resolveAgyPath(settings.agyPath)
    const { system, messages } = splitPrompt(options.prompt)

    // Resume agy's own conversation (which also remembers agy's tool results)
    // only when OpenCode's history matches what agy saw on the previous turn.
    // Anything else (edits, reverts, compaction, restarts) replays the transcript.
    const canResume = settings.resume !== false && Boolean(sessionID) && kind === "primary"
    const prior = canResume ? getConversation(sessionID) : undefined
    const lastAssistant = messages.findLastIndex((message) => message.role === "assistant")
    const newInput = renderMessages(messages.slice(lastAssistant + 1))
    const resumed =
      prior && lastAssistant >= 0 && newInput && prior.key === historyKey(messages.slice(0, lastAssistant + 1))
        ? prior
        : undefined
    const prompt = resumed ? newInput : renderTranscript(system, messages, settings)
    const args = buildAgyArgs(this.modelId, settings, resumed?.conversationId)

    const warnings = []
    if (options.tools?.length)
      warnings.push({ type: "unsupported", feature: "tools", details: "agy uses its own tools; OpenCode tools are not forwarded" })
    if (options.responseFormat?.type === "json")
      warnings.push({ type: "unsupported", feature: "responseFormat", details: "JSON mode is not forwarded to agy" })

    const started = Date.now()
    const meta = { session: sessionID, kind, model: this.modelId, cwd, resumed: Boolean(resumed), promptChars: prompt.length }
    log("info", "agy turn start", debugEnabled(settings) ? { ...meta, args, prompt } : meta)

    const turn = startAgyTurn({ agyPath, args, prompt, cwd, abortSignal: options.abortSignal })
    const showTools = settings.toolActivity !== "off"
    const modelId = this.modelId

    const stream = new ReadableStream({
      start(controller) {
        void pump(controller)
      },
      cancel() {
        turn.kill()
      },
    })

    async function pump(controller) {
      const emit = (part) => {
        try {
          controller.enqueue(part)
        } catch {
          // Consumer went away; the process is killed in cancel().
        }
      }

      let text = ""
      let openText
      let openActivity
      let activityCount = 0
      let conversationId
      let result

      const closeText = () => {
        if (openText) emit({ type: "text-end", id: openText })
        openText = undefined
      }
      const closeActivity = () => {
        if (openActivity) emit({ type: "reasoning-end", id: openActivity })
        openActivity = undefined
      }
      const writeText = (id, delta) => {
        if (openText !== id) {
          closeActivity()
          closeText()
          openText = id
          emit({ type: "text-start", id })
        }
        emit({ type: "text-delta", id, delta })
        text += delta
      }
      const writeActivity = (line) => {
        if (!openActivity) {
          closeText()
          openActivity = `agy-activity-${activityCount++}`
          emit({ type: "reasoning-start", id: openActivity })
        }
        emit({ type: "reasoning-delta", id: openActivity, delta: line + "\n" })
      }

      emit({ type: "stream-start", warnings })
      try {
        for await (const event of turn.events) {
          if (event.event === "init") {
            conversationId = event.conversation_id
            emit({ type: "response-metadata", id: conversationId, modelId: event.init?.model ?? modelId, timestamp: new Date() })
          } else if (event.event === "result") {
            result = event.result
          } else if (event.event === "step_update") {
            const step = event.step_update ?? {}
            const terminal = step.state === "DONE" || step.state === "ERROR"
            if (step.step_type === "tool") {
              if (!showTools) continue
              if (step.state === "ACTIVE") writeActivity(`▸ ${describeTool(step)}`)
              if (step.state === "ERROR") {
                const reason = String(step.tool_info?.error?.message ?? "failed").split(/\r?\n/)[0]
                writeActivity(`✗ ${step.tool_name}: ${truncate(reason, 300)}`)
              }
              continue
            }
            if (step.step_type === "user_input") continue
            const id = `agy-text-${step.step_index ?? 0}`
            if (typeof step.text_delta === "string" && step.text_delta) writeText(id, step.text_delta)
            if (terminal && openText === id) closeText()
          }
        }

        const { code, stderr } = await turn.done
        closeActivity()

        if (options.abortSignal?.aborted) {
          controller.error(options.abortSignal.reason ?? new DOMException("Aborted", "AbortError"))
          return
        }

        const ok = result ? result.status === "SUCCESS" : code === 0
        if (!ok) {
          closeText()
          if (canResume) setConversation(sessionID, undefined)
          const message = describeFailure(result?.error || stderr || `agy exited with code ${code}`, agyPath)
          log("error", "agy turn failed", { ...meta, code, status: result?.status, message })
          emit({ type: "error", error: new AgyError(message, { code, status: result?.status, stderr }) })
          controller.close()
          return
        }

        if (!text && result?.response) writeText("agy-text-final", result.response)
        const deniedActions = result?.denied_actions ?? []
        const denied = deniedActions.map((action) => action.display_name ?? action.action)
        if (denied.length) {
          const names = [...new Set(denied)].join(", ")
          const hint = denialHint(deniedActions, settings)
          if (showTools) writeActivity(`✗ agy denied: ${names}. ${hint}`)
          closeActivity()
          if (!text) writeText("agy-text-denied", `agy stopped because it was not allowed to use: ${names}. ${hint}`)
        }
        closeText()

        if (canResume && conversationId)
          setConversation(sessionID, {
            conversationId,
            key: historyKey([...messages, { role: "assistant", content: [{ type: "text", text }] }]),
          })

        log("info", "agy turn done", { ...meta, conversationId, ms: Date.now() - started, usage: result?.usage, denied })
        emit({ type: "finish", usage: mapUsage(result?.usage), finishReason: { unified: "stop", raw: result?.status ?? "SUCCESS" } })
        controller.close()
      } catch (error) {
        closeActivity()
        closeText()
        const message = describeFailure(error?.code === "ENOENT" ? `ENOENT ${error.message}` : String(error?.message ?? error), agyPath)
        log("error", "agy turn crashed", { ...meta, message })
        emit({ type: "error", error: new AgyError(message, { cause: error }) })
        controller.close()
      }
    }

    return { stream, request: { body: { args, prompt } } }
  }
}

function splitPrompt(prompt) {
  const system = []
  const messages = []
  for (const message of prompt) {
    if (message.role === "system") system.push(message.content)
    else messages.push(message)
  }
  return { system: system.join("\n\n").trim(), messages }
}

// agy's permission rules match commands by prefix, so improvised scripts
// (`powershell -Command ...`, `;` chains, pipes) are denied even when the plain
// command is allowed. Steer agy to the single commands a user can allow-list.
const FILE_COMMANDS =
  process.platform === "win32"
    ? [
        "Copy a file (e.g. save a generated image here): Copy-Item -LiteralPath '<source>' -Destination '<target>'",
        "Move a file: Move-Item -LiteralPath '<source>' -Destination '<target>'",
        "Rename: Rename-Item -LiteralPath '<path>' -NewName '<name>'",
        "Create a folder: New-Item -ItemType Directory -Force -Path '<path>'",
        "List files: Get-ChildItem -LiteralPath '<folder>'",
        "Download a file (e.g. an image found on the web): Invoke-WebRequest -Uri '<url>' -OutFile '<path>'",
      ]
    : [
        "Copy a file (e.g. save a generated image here): cp '<source>' '<target>'",
        "Move a file: mv '<source>' '<target>'",
        "Create a folder: mkdir -p '<path>'",
        "List files: ls '<folder>'",
        "Download a file (e.g. an image found on the web): curl -L -o '<path>' '<url>'",
      ]

const FILE_COMMAND_GUIDE =
  "<file_command_guide>\n" +
  "When you need a shell command for files, use exactly one of these forms, one command per call, " +
  "with no `powershell -Command` wrapper, no `;`/`&&` chaining and no pipes (other forms are denied):\n" +
  FILE_COMMANDS.map((line) => `- ${line}`).join("\n") +
  "\nWhen adding images to a Markdown file, store them next to the note (or in a subfolder) and use a " +
  "relative path like ![description](imagens/foto.png). For web images you may also link the direct image URL.\n" +
  "</file_command_guide>"

function renderTranscript(system, messages, settings) {
  const blocks = []
  if (settings.fileCommandGuide !== false) blocks.push(FILE_COMMAND_GUIDE)
  if (system && settings.system !== "omit")
    blocks.push(
      "<opencode_instructions>\n" +
        "Instructions from the OpenCode client that is relaying this conversation. Tool names mentioned " +
        "here belong to OpenCode and are not available to you; use your own tools instead.\n\n" +
        system +
        "\n</opencode_instructions>",
    )
  const turns = messages.map((message) => [message.role, messageText(message).trim()]).filter(([, body]) => body)
  if (!blocks.length && turns.length === 1 && turns[0][0] === "user") return turns[0][1]
  blocks.push("<conversation>\n" + turns.map(([role, body]) => `<${role}>\n${body}\n</${role}>`).join("\n") + "\n</conversation>")
  blocks.push("Reply to the last user message in the conversation above.")
  return blocks.join("\n\n")
}

function renderMessages(messages) {
  return messages
    .map((message) => messageText(message).trim())
    .filter(Boolean)
    .join("\n\n")
}

function messageText(message) {
  if (typeof message.content === "string") return message.content
  return message.content.map(partText).filter(Boolean).join("\n")
}

function partText(part) {
  switch (part.type) {
    case "text":
      return part.text
    case "file":
      return `[attached file${part.filename ? ` ${part.filename}` : ""} (${part.mediaType}) was not forwarded to agy]`
    case "tool-call":
      return `[called tool ${part.toolName}: ${truncate(JSON.stringify(part.input), 2_000)}]`
    case "tool-result":
      return `[result of ${part.toolName}: ${truncate(toolOutputText(part.output), 4_000)}]`
    default:
      return "" // reasoning and approval parts are not replayed
  }
}

function toolOutputText(output) {
  if (!output) return ""
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value
    case "json":
    case "error-json":
      return JSON.stringify(output.value)
    case "execution-denied":
      return `denied${output.reason ? `: ${output.reason}` : ""}`
    case "content":
      return output.value.map((item) => item.text ?? `[${item.type}]`).join("\n")
    default:
      return ""
  }
}

/** Stable fingerprint of the visible conversation, used to decide whether agy can resume. */
function historyKey(messages) {
  const normalized = messages.map((message) => {
    const text = Array.isArray(message.content)
      ? message.content.map((part) => (part.type === "text" ? part.text : part.type === "file" ? part.filename ?? "" : "")).join("")
      : String(message.content)
    return [message.role, text.replace(/\s+/g, " ").trim()]
  })
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
}

function describeTool(step) {
  const name = step.tool_info?.name ?? step.tool_name ?? "tool"
  const params = step.tool_info?.parameters
  if (!params || typeof params !== "object") return name
  const first = Object.values(params).find((value) => typeof value === "string" && value.trim())
  return `${name} ${truncate(first ?? JSON.stringify(params), 160)}`
}

/** agy reports output_tokens including thinking tokens. */
function mapUsage(usage = {}) {
  const count = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
  const input = count(usage.input_tokens)
  const cached = count(usage.cache_read_tokens)
  const output = count(usage.output_tokens)
  const thinking = count(usage.thinking_tokens)
  return {
    inputTokens: {
      total: input,
      noCache: input === undefined ? undefined : input - (cached ?? 0),
      cacheRead: cached,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: output,
      text: output === undefined ? undefined : Math.max(0, output - (thinking ?? 0)),
      reasoning: thinking,
    },
    raw: usage,
  }
}

function lowerKeys(headers) {
  const out = {}
  for (const [key, value] of Object.entries(headers ?? {})) if (typeof value === "string") out[key.toLowerCase()] = value
  return out
}

function truncate(text, max) {
  const value = String(text ?? "")
  return value.length > max ? value.slice(0, max) + "…" : value
}
