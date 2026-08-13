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

export async function streamForProvider(
  provider: AiProviderId,
  config: AiProviderConfig,
  system: string,
  messages: AgentMessage[],
  tools: AgentToolDef[],
  maxTokens: number,
  cb: StreamCallbacks,
): Promise<void> {
  return streamForProviderEnhanced(provider, config, system, messages, tools, maxTokens, cb, AiCreditsError)
}
