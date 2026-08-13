import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'
import { httpBodyDetail } from './http-error'
import { AI_PROVIDERS, NVIDIA_NIM_BASE_URL, OPENROUTER_BASE_URL } from './providers'
import type { AiProviderConfig, AiProviderId } from './types'

export interface StreamCallbacks {
  onDelta: (text: string) => void
  onToolCall: (call: AgentToolCall) => void
  onStopReason?: (reason: string) => void
  onActivity?: () => void
  signal: AbortSignal
}

export class AiCreditsError extends Error {
  constructor(notice: string) {
    super(notice)
    this.name = 'AiCreditsError'
  }
}

export async function* sseLines(
  body: NodeJS.ReadableStream | ReadableStream<Uint8Array>,
  onBytes?: () => void,
): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    onBytes?.()
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) yield line
  }
  if (buffer) yield buffer
}

function openAiMessages(system: string, messages: AgentMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.images?.length) {
        out.push({
          role: 'user',
          content: [
            ...(m.text ? [{ type: 'text', text: m.text }] : []),
            ...m.images.map((img) => ({
              type: 'image_url',
              image_url: { url: `data:${img.mime};base64,${img.base64}` },
            })),
          ],
        })
      } else out.push({ role: 'user', content: m.text })
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      })
    } else {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.output })
    }
  }
  return out
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return { _raw: raw }
  }
}

function generationConfig(config: AiProviderConfig): Record<string, number> {
  if (config.model.includes('nemotron-3-super') || config.model.includes('nemotron-3-ultra')) {
    return { temperature: 1.0, top_p: 0.95 }
  }
  return { temperature: 0.3 }
}

function validateCapabilities(provider: AiProviderId, messages: AgentMessage[], tools: AgentToolDef[]): void {
  const meta = AI_PROVIDERS.find((item) => item.id === provider)
  if (!meta) throw new Error(`Provider ${provider} is not enabled in this build`)
  if (tools.length && !meta.supportsTools) {
    throw new Error(`${meta.label} does not support the office tools required by this action`)
  }
  const hasImages = messages.some((message) => message.role === 'user' && Boolean(message.images?.length))
  if (hasImages && !meta.supportsVision) {
    throw new Error(`${meta.label} does not support image input for this request`)
  }
  if (!meta.supportsStreaming) {
    throw new Error(`${meta.label} does not support streaming in this build`)
  }
}

async function streamOpenAiCompatible(
  baseUrl: string,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
): Promise<void> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: cb.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      messages: openAiMessages(system, messages),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
      ...generationConfig(config),
      stream: true,
    }),
  })
  cb.onActivity?.()
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
  }
  const pending = new Map<number, { id: string; name: string; args: string }>()
  let finishReason: string | undefined
  for await (const line of sseLines(response.body, () => cb.onActivity?.())) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    const event = JSON.parse(payload) as {
      error?: { message?: string }
      choices?: Array<{
        delta?: {
          content?: string
          tool_calls?: Array<{
            index: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        finish_reason?: string | null
      }>
    }
    if (event.error) throw new Error(event.error.message ?? 'AI stream error')
    const choice = event.choices?.[0]
    if (!choice) continue
    if (choice.delta?.content) cb.onDelta(choice.delta.content)
    for (const tc of choice.delta?.tool_calls ?? []) {
      const p = pending.get(tc.index) ?? {
        id: tc.id ?? crypto.randomUUID(),
        name: '',
        args: '',
      }
      if (tc.id) p.id = tc.id
      if (tc.function?.name) p.name += tc.function.name
      if (tc.function?.arguments) p.args += tc.function.arguments
      pending.set(tc.index, p)
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }
  for (const [, p] of [...pending.entries()].sort(([a], [b]) => a - b)) {
    if (p.name) cb.onToolCall({ id: p.id, name: p.name, input: parseArgs(p.args) })
  }
  if (finishReason === 'length') cb.onStopReason?.('max_tokens')
  else if (finishReason) cb.onStopReason?.(finishReason)
}

function anthropicContents(system: string, messages: AgentMessage[]) {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = []
  for (const m of messages) {
    if (m.role === 'user') {
      const content = [
        ...(m.text ? [{ type: 'text', text: m.text }] : []),
        ...(m.images ?? []).map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mime, data: img.base64 },
        })),
      ]
      out.push({ role: 'user', content: content.length ? content : [{ type: 'text', text: '' }] })
    } else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: [
          ...(m.text ? [{ type: 'text', text: m.text }] : []),
          ...(m.toolCalls ?? []).map((c) => ({
            type: 'tool_use',
            id: c.id,
            name: c.name,
            input: c.input,
          })),
        ],
      })
    } else {
      out.push({
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.output,
        })),
      })
    }
  }
  return { system, messages: out }
}

async function streamAnthropic(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
): Promise<void> {
  const payload = anthropicContents(system, messages)
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: cb.signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      system: payload.system,
      messages: payload.messages,
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
      temperature: 0.3,
      stream: true,
    }),
  })
  cb.onActivity?.()
  if (!response.ok || !response.body) {
    throw new Error(`Claude HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
  }
  const pending = new Map<number, { id: string; name: string; args: string }>()
  let currentToolIndex: number | null = null
  let stopReason: string | undefined
  for await (const line of sseLines(response.body, () => cb.onActivity?.())) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice(5).trim()
    if (!raw) continue
    const event = JSON.parse(raw) as {
      type?: string
      index?: number
      content_block?: {
        type?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
      }
      delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string | null }
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const index = event.index ?? pending.size
      pending.set(index, {
        id: event.content_block.id ?? crypto.randomUUID(),
        name: event.content_block.name ?? '',
        args: event.content_block.input ? JSON.stringify(event.content_block.input) : '',
      })
      currentToolIndex = index
    } else if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta' && event.delta.text) cb.onDelta(event.delta.text)
      if (event.delta?.type === 'input_json_delta' && currentToolIndex !== null) {
        const tool = pending.get(currentToolIndex)
        if (tool && event.delta.partial_json) tool.args += event.delta.partial_json
      }
    } else if (event.type === 'message_delta' && event.delta?.stop_reason) {
      stopReason = event.delta.stop_reason
    } else if (event.type === 'message_stop') {
      break
    }
  }
  for (const [, p] of [...pending.entries()].sort(([a], [b]) => a - b)) {
    if (p.name) cb.onToolCall({ id: p.id, name: p.name, input: parseArgs(p.args) })
  }
  if (stopReason === 'max_tokens') cb.onStopReason?.('max_tokens')
  else if (stopReason) cb.onStopReason?.(stopReason)
}

function geminiContents(messages: AgentMessage[]) {
  const out: Array<{ role: 'user' | 'model'; parts: unknown[] }> = []
  for (const m of messages) {
    if (m.role === 'user') {
      const parts: unknown[] = []
      if (m.text) parts.push({ text: m.text })
      for (const img of m.images ?? []) parts.push({ inlineData: { mimeType: img.mime, data: img.base64 } })
      out.push({ role: 'user', parts: parts.length ? parts : [{ text: '' }] })
    } else if (m.role === 'assistant') {
      const parts: unknown[] = []
      if (m.text) parts.push({ text: m.text })
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.input } })
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] })
    } else {
      out.push({
        role: 'user',
        parts: m.results.map((r) => ({
          functionResponse: { name: r.name, response: { result: r.output } },
        })),
      })
    }
  }
  return out
}

async function streamGemini(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
): Promise<void> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: geminiContents(messages),
    generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
  }
  if (tools.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      },
    ]
  }
  const response = await fetch(url, {
    method: 'POST',
    signal: cb.signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify(body),
  })
  cb.onActivity?.()
  if (!response.ok || !response.body) {
    throw new Error(`Gemini HTTP ${response.status}: ${httpBodyDetail(await response.text())}`)
  }
  const seenCalls = new Set<string>()
  let finishReason: string | undefined
  for await (const line of sseLines(response.body, () => cb.onActivity?.())) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice(5).trim()
    if (!raw) continue
    const event = JSON.parse(raw) as {
      error?: { message?: string }
      candidates?: Array<{
        finishReason?: string
        content?: {
          parts?: Array<{
            text?: string
            functionCall?: { name?: string; args?: Record<string, unknown> }
          }>
        }
      }>
    }
    if (event.error) throw new Error(event.error.message ?? 'Gemini stream error')
    const candidate = event.candidates?.[0]
    if (!candidate) continue
    if (candidate.finishReason) finishReason = candidate.finishReason
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) cb.onDelta(part.text)
      const call = part.functionCall
      if (call?.name) {
        const signature = `${call.name}:${JSON.stringify(call.args ?? {})}`
        if (!seenCalls.has(signature)) {
          seenCalls.add(signature)
          cb.onToolCall({ id: crypto.randomUUID(), name: call.name, input: call.args ?? {} })
        }
      }
    }
  }
  if (finishReason === 'MAX_TOKENS') cb.onStopReason?.('max_tokens')
  else if (finishReason) cb.onStopReason?.(finishReason.toLowerCase())
}

const OPENAI_COMPATIBLE_BASE_URLS: Partial<Record<AiProviderId, string>> = {
  openrouter: OPENROUTER_BASE_URL,
  nvidia: NVIDIA_NIM_BASE_URL,
  deepseek: 'https://api.deepseek.com/v1',
  openai: 'https://api.openai.com/v1',
}

export async function streamForProvider(
  provider: AiProviderId,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
): Promise<void> {
  validateCapabilities(provider, messages, tools)
  switch (provider) {
    case 'custom':
      if (!config.baseUrl) throw new Error('A custom provider requires a Base URL')
      return streamOpenAiCompatible(config.baseUrl, config, system, messages, tools, maxTokens, cb)
    case 'anthropic':
      return streamAnthropic(config, system, messages, tools, maxTokens, cb)
    case 'gemini':
      return streamGemini(config, system, messages, tools, maxTokens, cb)
    case 'openrouter':
    case 'nvidia':
    case 'deepseek':
    case 'openai': {
      const baseUrl = OPENAI_COMPATIBLE_BASE_URLS[provider]
      if (!baseUrl) throw new Error(`Provider ${provider} is not enabled in this build`)
      return streamOpenAiCompatible(baseUrl, config, system, messages, tools, maxTokens, cb)
    }
    case 'genspark':
      throw new Error('Genspark is legacy-only and is not available in direct-provider agent mode')
    default:
      throw new Error(`Provider ${provider} is not enabled in this build`)
  }
}
