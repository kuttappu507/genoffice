import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'
import { streamForProviderEnhanced } from './robust-stream'
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

/** Backwards-compatible SSE line splitter used by the public package API and tests. */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n')
    buffer = chunks.pop() ?? ''
    for (const line of chunks) yield line.replace(/\r$/, '')
  }
  buffer += decoder.decode()
  if (buffer) yield buffer.replace(/\r$/, '')
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
  return streamForProviderEnhanced(
    provider,
    config,
    system,
    messages,
    tools,
    maxTokens,
    cb,
    AiCreditsError,
  )
}
