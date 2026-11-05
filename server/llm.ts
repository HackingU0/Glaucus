// DeepSeek's own API only takes response_format json_object, so @ai-sdk/deepseek sends that and puts the schema in the
// prompt. Other OpenAI-compatible APIs (OpenAI, Anthropic's /v1/ compat endpoint, OpenRouter...) take json_schema, and
// Anthropic's refuses json_object outright, so everything that is not DeepSeek goes through openai-compatible.
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export const isDeepSeek = (baseUrl: string) => {
  try { return /(^|\.)deepseek\.com$/i.test(new URL(baseUrl).hostname) } catch { return false }
}

export function createModel(llm: { base_url: string; model: string }, apiKey: string): LanguageModel {
  if (isDeepSeek(llm.base_url)) return createDeepSeek({ apiKey, baseURL: llm.base_url })(llm.model)
  return createOpenAICompatible({ name: 'llm', apiKey, baseURL: llm.base_url, supportsStructuredOutputs: true })(llm.model)
}
