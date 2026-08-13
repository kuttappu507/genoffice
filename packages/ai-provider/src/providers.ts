import type { AiProviderId, AiProviderMeta, AiSettings, LegacyAiSettings } from './types'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1'

/** Legacy Genspark endpoints retained only for saved-settings compatibility. */
export const GENSPARK_LLM_BASE_URLS = {
  anthropic: 'https://www.genspark.ai/api/anthropic',
  gemini: 'https://www.genspark.ai/api/llm_proxy/gemini/v1beta',
  openai: 'https://www.genspark.ai/api/llm_proxy/v1',
} as const
export const GENSPARK_AGENT_TYPE = 'genoffice'
export function gensparkAttributionHeaders(baseUrl?: string): Record<string, string> {
  return baseUrl?.startsWith('https://www.genspark.ai') ? { 'X-Agent-Type': GENSPARK_AGENT_TYPE } : {}
}

/** Curated Nemotron IDs surfaced immediately in Settings. Users can still type any model ID into a compatible provider. */
export const OPENROUTER_NEMOTRON_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'openrouter/free',
]

export const NVIDIA_NEMOTRON_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nvidia-nemotron-nano-9b-v2-dgx-spark',
]

export const AI_PROVIDERS: AiProviderMeta[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    models: OPENROUTER_NEMOTRON_MODELS,
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    keyPlaceholder: 'sk-or-v1-...',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    models: NVIDIA_NEMOTRON_MODELS,
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
    keyPlaceholder: 'nvapi-...',
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    id: 'genspark',
    label: 'Genspark (Legacy)',
    models: ['claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'gpt-5.2', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
    defaultModel: 'claude-opus-4-7',
    keyPlaceholder: 'Legacy account login',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'anthropic',
    label: 'Claude',
    models: ['claude-opus-4-1', 'claude-opus-4-0', 'claude-sonnet-4-0', 'claude-sonnet-4-5'],
    defaultModel: 'claude-sonnet-4-0',
    keyPlaceholder: 'sk-ant-api03-...',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    models: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-3.6-flash',
    keyPlaceholder: 'AIza...',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    defaultModel: 'gpt-4.1-mini',
    keyPlaceholder: 'sk-...',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    models: [],
    defaultModel: '',
    keyPlaceholder: 'API Key',
    needsBaseUrl: true,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
]

export function defaultAiSettings(defaultApiKeys?: Partial<Record<AiProviderId, string>>): AiSettings {
  const providers = {} as AiSettings['providers']
  for (const meta of AI_PROVIDERS) {
    providers[meta.id] = {
      apiKey: defaultApiKeys?.[meta.id] ?? '',
      model: meta.defaultModel,
      baseUrl: meta.needsBaseUrl ? '' : undefined,
    }
  }
  return { provider: 'openrouter', providers }
}

/**
 * Normalize legacy/invalid saved settings into a plain JSON-safe object.
 * The old provider-reset behavior is intentionally gone; no editor should
 * silently replace the user's selected provider.
 */
export function resolveAiSettings(
  stored: Partial<AiSettings> & LegacyAiSettings,
  defaults: AiSettings,
): AiSettings {
  const providers = { ...defaults.providers }

  if (stored.providers) {
    for (const meta of AI_PROVIDERS) {
      const saved = stored.providers[meta.id]
      if (!saved) continue
      providers[meta.id] = {
        apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
        model: typeof saved.model === 'string' && saved.model ? saved.model : meta.defaultModel,
        baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : providers[meta.id]?.baseUrl,
      }
    }
  } else if (stored.apiKey) {
    providers.custom = {
      apiKey: stored.apiKey,
      model: stored.model ?? '',
      baseUrl: stored.baseUrl ?? 'https://api.openai.com/v1',
    }
  }

  const candidate = stored.provider
  const provider: AiProviderId = candidate && AI_PROVIDERS.some((meta) => meta.id === candidate)
    ? candidate
    : defaults.provider

  // Never persist or surface legacy Genspark as the active provider after migration.
  return {
    provider: provider === 'genspark' ? defaults.provider : provider,
    providers,
  }
}
