// DeepSeek's own API only takes response_format json_object, so @ai-sdk/deepseek sends that and puts the schema in the
// prompt. Other OpenAI-compatible APIs (OpenAI, Anthropic's /v1/ compat endpoint, OpenRouter...) take json_schema, and
// Anthropic's refuses json_object outright, so everything that is not DeepSeek goes through openai-compatible.
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export const isDeepSeek = (baseUrl: string) => {
  try { return /(^|\.)deepseek\.com$/i.test(new URL(baseUrl).hostname) } catch { return false }
}

// Anthropic's structured outputs reject numeric and length limits, and zod puts some in on its own (.int() adds the safe
// integer range). Dropping them loses nothing: the SDK still checks every reply and tool call against the zod schema.
const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems']
export function loosen(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(loosen)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED.includes(k) || (k === 'minItems' && typeof v === 'number' && v > 1)) continue
    out[k] = k === 'properties' || k === '$defs' || k === 'definitions' // keys here are names, not keywords
      ? Object.fromEntries(Object.entries(v as object).map(([name, s]) => [name, loosen(s)]))
      : loosen(v)
  }
  return out
}

function loosenBody(body: Record<string, any>) {
  const rf = body.response_format
  return {
    ...body,
    ...rf?.type === 'json_schema' && { response_format: { ...rf, json_schema: { ...rf.json_schema, schema: loosen(rf.json_schema.schema) } } },
    ...Array.isArray(body.tools) && {
      tools: body.tools.map((t: any) => t.function?.parameters ? { ...t, function: { ...t.function, parameters: loosen(t.function.parameters) } } : t),
    },
  }
}

export function createModel(llm: { base_url: string; model: string }, apiKey: string): LanguageModel {
  if (isDeepSeek(llm.base_url)) return createDeepSeek({ apiKey, baseURL: llm.base_url })(llm.model)
  return createOpenAICompatible({ name: 'llm', apiKey, baseURL: llm.base_url, supportsStructuredOutputs: true, transformRequestBody: loosenBody })(llm.model)
}
