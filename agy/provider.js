/**
 * Entry point OpenCode loads for the "agy" provider.
 *
 * The plugin registers the provider with `package: "aisdk:file:///…/provider.js"`;
 * OpenCode imports this file and calls its `create*` export with the provider
 * settings. Keep exactly one `create*` export.
 *
 * OpenCode keeps this module loaded for the whole life of its background service,
 * so it stays tiny: the real implementation (model.js, agy.js) is imported per
 * request and re-imported when those files change. Plugin updates therefore take
 * effect on the next message without restarting OpenCode. Settings: see model.js.
 */
import { statSync } from "node:fs"
import { fileURLToPath } from "node:url"

const IMPLEMENTATION = ["model.js", "agy.js"]
let loaded

function implementation() {
  const files = IMPLEMENTATION.map((name) => fileURLToPath(new URL(`./${name}`, import.meta.url)))
  const version = files.map((file) => statSync(file).mtimeMs).join(":")
  if (loaded?.version !== version) {
    // Bun (OpenCode's runtime) caches ES modules by path and ignores query strings;
    // dropping the cache entries is how OpenCode itself reloads plugin sources.
    if (typeof require !== "undefined" && require.cache) for (const file of files) delete require.cache[file]
    const module = import(new URL("./model.js", import.meta.url).href)
    loaded = { version, module }
    module.catch(() => {
      if (loaded?.module === module) loaded = undefined
    })
  }
  return loaded.module
}

export function createAgy(settings = {}) {
  const unsupported = (modelType) => (modelId) => {
    const error = new Error(`The agy provider has no ${modelType} "${modelId}"`)
    error.name = "AI_NoSuchModelError"
    throw Object.assign(error, { modelId, modelType })
  }
  const model = async (modelId) => new (await implementation()).AgyLanguageModel(modelId, settings)
  return {
    specificationVersion: "v3",
    languageModel: (modelId) => ({
      specificationVersion: "v3",
      provider: "agy",
      modelId,
      supportedUrls: {},
      doGenerate: async (options) => (await model(modelId)).doGenerate(options),
      doStream: async (options) => (await model(modelId)).doStream(options),
    }),
    embeddingModel: unsupported("embeddingModel"),
    imageModel: unsupported("imageModel"),
  }
}
