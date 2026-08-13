import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'
import {
  AI_PROVIDERS,
  GENSPARK_AGENT_TYPE,
  GENSPARK_LLM_BASE_URLS,
  NVIDIA_NIM_BASE_URL,
  OPENROUTER_BASE_URL,
} from './providers'
import { createStreamWatchdog } from './watchdog'
import { toGeminiSchema } from './gemini-schema'
import type { AiProviderConfig, AiProviderId } from './types'

export interface RobustStreamCallbacks {
  onDelta: (text: string) => void
  onToolCall: (call: AgentToolCall) => void
  onStopReason?: (reason: string) => void
  onActivity?: () => void
  signal: AbortSignal
}

type CreditsErrorCtor = new (notice: string) => Error
type PendingTool = { id: string; name: string; args: string }

async function* lines(body: ReadableStream<Uint8Array>, touch: () => void): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    touch()
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n')
    buffer = chunks.pop() ?? ''
    for (const line of chunks) yield line.replace(/\r$/, '')
  }
  buffer += decoder.decode()
  if (buffer) yield buffer.replace(/\r$/, '')
}

function jsonRepair(raw: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      out += ch
      escaped = true
      continue
    }
    if (ch !== '"') {
      out += ch
      continue
    }
    if (!inString) {
      inString = true
      out += ch
      continue
    }
    let j = i + 1
    while (j < raw.length && /\s/.test(raw[j]!)) j += 1
    if (raw[j] === '}' || raw[j] === ']' || raw[j] === ',') {
      inString = false
      out += ch
    } else {
      out += '\\"'
    }
  }
  return out
}

function parseTool(raw: string): { input: Record<string, unknown>; inputError?: string } {
  if (!raw.trim()) return { input: {} }
  try {
    return { input: JSON.parse(raw) as Record<string, unknown> }
  } catch {}
  try {
    return { input: JSON.parse(jsonRepair(raw)) as Record<string, unknown> }
  } catch {
    return { input: {}, inputError: `Could not parse tool input; raw: ${raw}` }
  }
}

function emitTool(cb: RobustStreamCallbacks, tool: PendingTool, truncated: boolean): void {
  const parsed = parseTool(tool.args)
  cb.onToolCall({
    id: tool.id,
    name: tool.name,
    input: parsed.input,
    ...(parsed.inputError ? { inputError: parsed.inputError } : {}),
    ...(truncated ? { truncated: true } : {}),
  })
}

function isCredits(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('credits have been exhausted') ||
    lower.includes('insufficient credits') ||
    lower.includes('out of quota') ||
    (lower.includes('pricing') &&
      (lower.includes('quota') || lower.includes('credit') || lower.includes('top up')))
  )
}

function jsonResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')
}

async function parseBody(response: Response, label: string): Promise<any> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label}: ${text || 'empty body'}`)
  }
}

function bodySummary(body: unknown): string {
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

function normalizeStop(reason: string | undefined): string | undefined {
  if (!reason) return undefined
  return reason === 'length' || reason === 'MAX_TOKENS' ? 'max_tokens' : reason.toLowerCase()
}

function assistantMessages(system: string, messages: AgentMessage[]): unknown[] {
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
      } else {
        out.push({ role: 'user', content: m.text })
      }
    } else if (m.role === 'assistant') {
      const tools = m.toolCalls?.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
      }))
      // Do not send an artificial empty assistant turn. It is unnecessary and
      // some OpenAI-compatible gateways reject an empty assistant message.
      if (m.text || tools?.length) {
        out.push({
          role: 'assistant',
          content: m.text || null,
          ...(tools?.length ? { tool_calls: tools } : {}),
        })
      }
    } else {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.id, content: r.output })
      }
    }
  }
  return out
}

function anthropicMessages(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === 'user') {
      if (!m.images?.length) return { role: 'user', content: m.text ?? '' }
      const content = [
        ...(m.text ? [{ type: 'text', text: m.text }] : []),
        ...m.images.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mime, data: img.base64 },
        })),
      ]
      return { role: 'user', content }
    }
    if (m.role === 'assistant') {
      const content: unknown[] = []
      if (m.text) content.push({ type: 'text', text: m.text })
      for (const c of m.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input })
      }
      return {
        role: 'assistant',
        content: content.length ? content : [{ type: 'text', text: '' }],
      }
    }
    return {
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.output,
      })),
    }
  })
}

function geminiMessages(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === 'user') {
      const parts: unknown[] = []
      if (m.text) parts.push({ text: m.text })
      for (const img of m.images ?? []) {
        parts.push({ inlineData: { mimeType: img.mime, data: img.base64 } })
      }
      return { role: 'user', parts: parts.length ? parts : [{ text: '' }] }
    }
    if (m.role === 'assistant') {
      const parts: unknown[] = []
      if (m.text) parts.push({ text: m.text })
      for (const c of m.toolCalls ?? []) {
        parts.push({ functionCall: { id: c.id, name: c.name, args: c.input } })
      }
      return { role: 'model', parts: parts.length ? parts : [{ text: '' }] }
    }
    return {
      role: 'user',
      parts: m.results.map((r) => ({
        functionResponse: { id: r.id, name: r.name, response: { result: r.output } },
      })),
    }
  })
}

async function withWatchdog<T>(
  cb: RobustStreamCallbacks,
  run: (signal: AbortSignal, touch: () => void) => Promise<T>,
): Promise<T> {
  const watchdog = createStreamWatchdog(cb.signal)
  return watchdog.guard(() =>
    run(watchdog.signal, () => {
      watchdog.touch()
      cb.onActivity?.()
    }),
  )
}

function validate(provider: AiProviderId, messages: AgentMessage[], tools: AgentToolDef[]): void {
  const meta = AI_PROVIDERS.find((p) => p.id === provider)
  if (!meta) throw new Error(`Unknown provider: ${provider}`)
  if (tools.length && !meta.supportsTools) {
    throw new Error(`${meta.label} does not support the office tools required by this action`)
  }
  if (
    messages.some((m) => m.role === 'user' && Boolean(m.images?.length)) &&
    !meta.supportsVision
  ) {
    throw new Error(`${meta.label} does not support image input for this request`)
  }
  if (!meta.supportsStreaming) {
    throw new Error(`${meta.label} does not support streaming in this build`)
  }
}

async function openAi(
  baseUrl: string,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: RobustStreamCallbacks,
  CreditsError: CreditsErrorCtor,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  await withWatchdog(cb, async (signal, touch) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        messages: assistantMessages(system, messages),
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                },
              })),
            }
          : {}),
        temperature:
          config.model.includes('nemotron-3-super') || config.model.includes('nemotron-3-ultra')
            ? 1
            : 0.3,
        ...(config.model.includes('nemotron-3-super') || config.model.includes('nemotron-3-ultra')
          ? { top_p: 0.95 }
          : {}),
        stream: true,
      }),
    })
    cb.onActivity?.()
    if (!response.ok) {
      const text = await response.text()
      throw isCredits(text) ? new CreditsError(text) : new Error(`HTTP ${response.status}: ${text}`)
    }
    if (jsonResponse(response)) {
      const body = await parseBody(response, 'The model returned an unparseable JSON body')
      const choice = body?.choices?.[0]
      const message = choice?.message
      const content = typeof message?.content === 'string' ? message.content : ''
      if (body?.error?.message) {
        throw isCredits(body.error.message)
          ? new CreditsError(body.error.message)
          : new Error(body.error.message)
      }
      if (content && isCredits(content)) throw new CreditsError(content)
      const truncated = choice?.finish_reason === 'length'
      for (const tc of message?.tool_calls ?? []) {
        const fn = tc?.function
        if (!fn?.name) continue
        const parsed = parseTool(fn.arguments ?? '')
        cb.onToolCall({
          id: tc.id ?? crypto.randomUUID(),
          name: fn.name,
          input: parsed.input,
          ...(parsed.inputError ? { inputError: parsed.inputError } : {}),
          ...(truncated ? { truncated: true } : {}),
        })
      }
      if (content) cb.onDelta(content)
      const reason = normalizeStop(choice?.finish_reason)
      if (reason) cb.onStopReason?.(reason)
      if (!content && !message?.tool_calls?.length && !choice?.finish_reason) {
        throw new Error(`The model returned no content: ${bodySummary(body)}`)
      }
      if (
        !content &&
        !message?.tool_calls?.length &&
        choice?.finish_reason &&
        !['stop', 'tool_calls'].includes(choice.finish_reason)
      ) {
        throw new Error(`The model returned no content (finish_reason=${choice.finish_reason})`)
      }
      return
    }
    if (!response.body) throw new Error('The model returned no response body')
    const pending = new Map<number, PendingTool>()
    let finishReason: string | undefined
    let emitted = false
    for await (const line of lines(response.body, touch)) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      let event: any
      try {
        event = JSON.parse(raw)
      } catch {
        throw new Error(`Invalid AI stream event: ${raw.slice(0, 300)}`)
      }
      if (event.error) throw new Error(event.error.message ?? 'AI stream error')
      const choice = event.choices?.[0]
      if (!choice) continue
      if (choice.delta?.content) {
        emitted = true
        cb.onDelta(choice.delta.content)
      }
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
    for (const [, tool] of [...pending.entries()].sort(([a], [b]) => a - b)) {
      emitTool(cb, tool, finishReason === 'length')
      emitted = true
    }
    const normalized = normalizeStop(finishReason)
    if (normalized) cb.onStopReason?.(normalized)
    if (!emitted && !finishReason) throw new Error('The model returned no content')
    if (!emitted && finishReason && !['stop', 'tool_calls'].includes(finishReason)) {
      throw new Error(`The model returned no content (finish_reason=${finishReason})`)
    }
  })
}

async function anthropic(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: RobustStreamCallbacks,
  CreditsError: CreditsErrorCtor,
  baseUrl = 'https://api.anthropic.com',
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  await withWatchdog(cb, async (signal, touch) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        system,
        messages: anthropicMessages(messages),
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
    if (!response.ok) {
      const text = await response.text()
      if (/<html[ >]|<!doctype html/i.test(text)) {
        throw new Error(`Claude HTTP ${response.status}: web page instead of an API response`)
      }
      throw isCredits(text)
        ? new CreditsError(text)
        : new Error(`Claude HTTP ${response.status}: ${text}`)
    }
    if (jsonResponse(response)) {
      const body = await parseBody(response, 'Claude returned an unparseable JSON body')
      const parts = Array.isArray(body?.content) ? body.content : []
      const text = parts
        .filter((p: any) => p?.type === 'text')
        .map((p: any) => p.text)
        .join('')
      if (body?.error?.message) {
        throw isCredits(body.error.message)
          ? new CreditsError(body.error.message)
          : new Error(body.error.message)
      }
      if (isCredits(text)) throw new CreditsError(text)
      const truncated = body?.stop_reason === 'max_tokens'
      for (const part of parts) {
        if (part?.type !== 'tool_use' || !part.name) continue
        cb.onToolCall({
          id: part.id ?? crypto.randomUUID(),
          name: part.name,
          input: part.input ?? {},
          ...(truncated ? { truncated: true } : {}),
        })
      }
      if (text) cb.onDelta(text)
      if (body?.stop_reason) cb.onStopReason?.(normalizeStop(body.stop_reason)!)
      if (!text && !parts.some((p: any) => p?.type === 'tool_use')) {
        throw body?.content && Array.isArray(body.content) && body.content.length === 0
          ? new Error('Claude returned no content')
          : new Error(`Claude returned no content: ${bodySummary(body)}`)
      }
      return
    }
    if (!response.body) throw new Error('Claude returned no response body')
    const pending = new Map<number, PendingTool>()
    let current = -1
    let stopReason: string | undefined
    let emitted = false
    for await (const line of lines(response.body, touch)) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      let event: any
      try {
        event = JSON.parse(raw)
      } catch {
        throw new Error(`Invalid Claude stream event: ${raw.slice(0, 300)}`)
      }
      if (event.type === 'error' || event.error) {
        throw new Error(event.error?.message ?? event.message ?? 'Claude stream error')
      }
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        current = event.index ?? pending.size
        pending.set(current, {
          id: event.content_block.id ?? crypto.randomUUID(),
          name: event.content_block.name ?? '',
          args: event.content_block.input ? JSON.stringify(event.content_block.input) : '',
        })
      }
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          emitted = true
          cb.onDelta(event.delta.text)
        }
        if (event.delta?.type === 'input_json_delta' && current >= 0) {
          const tool = pending.get(current)
          if (tool && event.delta.partial_json) tool.args += event.delta.partial_json
        }
      }
      if (event.type === 'message_delta' && event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason
      }
    }
    for (const [, tool] of [...pending.entries()].sort(([a], [b]) => a - b)) {
      emitTool(cb, tool, stopReason === 'max_tokens')
      emitted = true
    }
    if (stopReason) cb.onStopReason?.(normalizeStop(stopReason)!)
    if (!emitted && !stopReason) throw new Error('Claude returned no content')
  })
}

async function gemini(
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: RobustStreamCallbacks,
  CreditsError: CreditsErrorCtor,
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  await withWatchdog(cb, async (signal, touch) => {
    const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
        ...extraHeaders,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: geminiMessages(messages),
        // Keep this payload minimal. The legacy generateContent endpoint is
        // stricter than the newer Interactions API about optional fields.
        generationConfig: { maxOutputTokens: maxTokens },
        ...(tools.length
          ? {
              tools: [
                {
                  functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: toGeminiSchema(t.inputSchema),
                  })),
                },
              ],
            }
          : {}),
      }),
    })
    cb.onActivity?.()
    if (!response.ok) {
      const text = await response.text()
      throw isCredits(text)
        ? new CreditsError(text)
        : new Error(`Gemini HTTP ${response.status}: ${text}`)
    }
    if (jsonResponse(response)) {
      return consumeGemini(
        await parseBody(response, 'Gemini returned an unparseable JSON body'),
        cb,
        CreditsError,
      )
    }
    if (!response.body) throw new Error('Gemini returned no response body')
    let finishReason: string | undefined
    let emitted = false
    const seen = new Set<string>()
    for await (const line of lines(response.body, touch)) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      let event: any
      try {
        event = JSON.parse(raw)
      } catch {
        throw new Error(`Invalid Gemini stream event: ${raw.slice(0, 300)}`)
      }
      if (event.error) throw new Error(event.error.message ?? 'Gemini stream error')
      if (event.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the prompt (${event.promptFeedback.blockReason})`)
      }
      const candidate = event.candidates?.[0]
      if (!candidate) continue
      if (candidate.finishReason) finishReason = candidate.finishReason
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          if (isCredits(part.text)) throw new CreditsError(part.text)
          emitted = true
          cb.onDelta(part.text)
        }
        if (part.functionCall?.name) {
          const sig =
            part.functionCall.id ??
            `${part.functionCall.name}:${JSON.stringify(part.functionCall.args ?? {})}`
          if (!seen.has(sig)) {
            seen.add(sig)
            emitted = true
            cb.onToolCall({
              id: part.functionCall.id ?? crypto.randomUUID(),
              name: part.functionCall.name,
              input: part.functionCall.args ?? {},
            })
          }
        }
      }
    }
    if (finishReason) cb.onStopReason?.(normalizeStop(finishReason)!)
    if (!emitted && !finishReason) throw new Error('Gemini returned no content')
    if (!emitted && finishReason && !['STOP', 'END_TURN'].includes(finishReason)) {
      throw new Error(`Gemini returned no content (finishReason=${finishReason})`)
    }
  })
}

function consumeGemini(body: any, cb: RobustStreamCallbacks, CreditsError: CreditsErrorCtor): void {
  const chunks = Array.isArray(body) ? body : [body]
  let emitted = false
  let reason: string | undefined
  for (const chunk of chunks) {
    if (chunk?.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt (${chunk.promptFeedback.blockReason})`)
    }
    for (const candidate of chunk?.candidates ?? []) {
      if (candidate.finishReason) reason = candidate.finishReason
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) {
          if (isCredits(part.text)) throw new CreditsError(part.text)
          cb.onDelta(part.text)
          emitted = true
        }
        if (part.functionCall?.name) {
          cb.onToolCall({
            id: part.functionCall.id ?? crypto.randomUUID(),
            name: part.functionCall.name,
            input: part.functionCall.args ?? {},
          })
          emitted = true
        }
      }
    }
  }
  if (reason) cb.onStopReason?.(normalizeStop(reason)!)
  if (!emitted && reason && !['STOP', 'END_TURN'].includes(reason)) {
    throw new Error(`Gemini returned no content (finishReason=${reason})`)
  }
  if (!emitted && !reason) {
    throw new Error(`Gemini returned no content: ${bodySummary(body)}`)
  }
}

const DIRECT_URLS: Partial<Record<AiProviderId, string>> = {
  openrouter: OPENROUTER_BASE_URL,
  nvidia: NVIDIA_NIM_BASE_URL,
  deepseek: 'https://api.deepseek.com/v1',
  openai: 'https://api.openai.com/v1',
}

export async function streamForProviderEnhanced(
  provider: AiProviderId,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: RobustStreamCallbacks,
  CreditsError: CreditsErrorCtor,
): Promise<void> {
  validate(provider, messages, tools)
  if (provider === 'custom') {
    if (!config.baseUrl) throw new Error('A custom provider requires a Base URL')
    return openAi(config.baseUrl, config, system, messages, tools, maxTokens, cb, CreditsError)
  }
  if (provider === 'anthropic') {
    return anthropic(config, system, messages, tools, maxTokens, cb, CreditsError)
  }
  if (provider === 'gemini') {
    return gemini(config, system, messages, tools, maxTokens, cb, CreditsError)
  }
  if (provider === 'genspark') {
    if (config.model.startsWith('claude-')) {
      return anthropic(
        config,
        system,
        messages,
        tools,
        maxTokens,
        cb,
        CreditsError,
        GENSPARK_LLM_BASE_URLS.anthropic,
        { 'X-Agent-Type': GENSPARK_AGENT_TYPE },
      )
    }
    if (config.model.startsWith('gemini-')) {
      return gemini(
        config,
        system,
        messages,
        tools,
        maxTokens,
        cb,
        CreditsError,
        GENSPARK_LLM_BASE_URLS.gemini,
        { 'X-Agent-Type': GENSPARK_AGENT_TYPE },
      )
    }
    return openAi(
      GENSPARK_LLM_BASE_URLS.openai,
      config,
      system,
      messages,
      tools,
      maxTokens,
      cb,
      CreditsError,
      { 'X-Agent-Type': GENSPARK_AGENT_TYPE },
    )
  }
  const baseUrl = DIRECT_URLS[provider]
  if (!baseUrl) throw new Error(`Unknown provider: ${provider}`)
  return openAi(baseUrl, config, system, messages, tools, maxTokens, cb, CreditsError)
}
