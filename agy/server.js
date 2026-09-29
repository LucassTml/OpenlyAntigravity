/**
 * OpenCode plugin: exposes every model from the local Antigravity CLI (`agy`)
 * as the "agy" provider, and routes requests through `agy` (see provider.js).
 *
 * Auto-loaded from ~/.config/opencode/plugins/agy/. Settings live in
 * opencode.json under providers.agy.settings; see provider.js for the list.
 */
import { HEADER_DIRECTORY, HEADER_KIND, HEADER_SESSION, PROVIDER_ID, listAgyModels, log, readModelCache, writeModelCache } from "./agy.js"

// OpenCode imports this file and calls its `createAgy` export (the dynamic AI SDK loader).
const PACKAGE = "aisdk:" + new URL("./provider.js", import.meta.url).href
const DEFAULT_NAME = "Antigravity (agy)"

// agy does not report context sizes; these are overridable per model in opencode.json.
const LIMITS = {
  gemini: { context: 1_048_576, output: 65_536 },
  claude: { context: 200_000, output: 64_000 },
  "gpt-oss": { context: 131_072, output: 32_768 },
}

export default {
  id: "agy",
  async setup(ctx) {
    let models = readModelCache()
    let settings = {}
    const registrations = []

    registrations.push(
      await ctx.provider.transform((editor) => {
        const existing = editor.get(PROVIDER_ID)
        settings = { ...existing?.provider.settings }
        const discovered = (models ?? []).map(toModelInfo)
        const known = new Set(discovered.map((model) => model.id))
        // Keep models declared only in opencode.json (e.g. one agy added after the last refresh).
        const extra = [...(existing?.models.values() ?? [])]
          .filter((model) => !known.has(model.id))
          .map((model) => ({ ...model, package: PACKAGE }))

        if (existing) {
          editor.update(PROVIDER_ID, (provider) => {
            provider.package = PACKAGE
            provider.activation = "enabled"
            if (!provider.name || provider.name === PROVIDER_ID) provider.name = DEFAULT_NAME
          })
          editor.models.set(PROVIDER_ID, [...discovered, ...extra])
        } else {
          editor.add({
            info: { id: PROVIDER_ID, name: DEFAULT_NAME, activation: "enabled", package: PACKAGE },
            models: discovered,
          })
        }
      }),
    )

    // Tell the provider which session and project directory each request belongs to,
    // so agy runs in the right folder and can resume its own conversation.
    registrations.push(
      await ctx.session.hook(
        "model.request",
        async (request) => {
          request.headers[HEADER_SESSION] = request.sessionID
          request.headers[HEADER_KIND] = request.kind
          try {
            const session = await ctx.session.get({ sessionID: request.sessionID })
            const directory = session?.location?.directory ?? session?.data?.location?.directory
            if (directory) request.headers[HEADER_DIRECTORY] = directory
          } catch (error) {
            log("warn", "could not resolve session directory", { session: request.sessionID, error: String(error) })
          }
        },
        { providerID: PROVIDER_ID },
      ),
    )

    // Session titles would otherwise cost a full agy turn (~12K tokens of agy's own
    // system prompt); derive them locally unless settings.titles === "agy".
    registrations.push(
      await ctx.session.hook(
        "title",
        (request) => {
          if (settings.titles === "agy") return
          const title = localTitle(request.messages)
          if (title) request.result = title
        },
        { providerID: PROVIDER_ID },
      ),
    )

    // Refresh from `agy models` after the transform has read providers.agy.settings (agyPath).
    // First run waits so the models appear right away; later runs start from the cache.
    const hadCache = Boolean(models)
    const refreshing = sharedModelList(settings.agyPath)
      .then((fresh) => {
        if (JSON.stringify(fresh) === JSON.stringify(models)) return
        models = fresh
        ctx.provider.reload().catch((error) => log("warn", "provider reload failed", { error: String(error) }))
      })
      .catch((error) => log("error", "agy models failed", { error: String(error?.message ?? error) }))
    if (!hadCache) await refreshing

    log("info", "agy plugin ready", { models: models?.length ?? 0, package: PACKAGE })

    return async () => {
      for (const registration of registrations) await registration.dispose()
    }
  },
}

/**
 * OpenCode sets the plugin up once per open project and again on every hot reload;
 * share one `agy models` call per process for a few minutes instead of one each.
 */
function sharedModelList(agyPath) {
  const state = (globalThis.__agyModelList ??= {})
  if (!state.promise || Date.now() - state.at > 5 * 60_000) {
    state.at = Date.now()
    state.promise = listAgyModels({ agyPath }).then((models) => {
      if (!models.length) throw new Error("`agy models` returned no models")
      writeModelCache(models)
      log("info", "agy models refreshed", { count: models.length })
      return models
    })
    state.promise.catch(() => (state.promise = undefined))
  }
  return state.promise
}

function toModelInfo({ id, name }) {
  const family = id.startsWith("gemini") ? "gemini" : id.startsWith("claude") ? "claude" : id.startsWith("gpt-oss") ? "gpt-oss" : undefined
  return {
    id,
    modelID: id,
    providerID: PROVIDER_ID,
    name,
    ...(family ? { family } : {}),
    package: PACKAGE,
    // agy runs its own tools; OpenCode's tool calls are not forwarded.
    capabilities: { tools: false, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: LIMITS[family] ?? { context: 128_000, output: 32_000 },
  }
}

function localTitle(messages) {
  const user = (messages ?? []).find((message) => message.role === "user")
  const content = Array.isArray(user?.content) ? user.content : [{ type: "text", text: String(user?.content ?? "") }]
  const text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
  if (!line) return undefined
  const clean = line.replace(/\s+/g, " ")
  return clean.length <= 60 ? clean : clean.slice(0, 57).replace(/\s+\S*$/, "") + "…"
}
