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

/** Curated defaults shown as recommendations in docs/comments; direct providers accept any model ID. */
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
    models: [],
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    keyPlaceholder: 'sk-or-v1-...',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    models: [],
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
    keyPlaceholder: 'nvapi-...',
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    id: 'genspark',
    label: 'Genspark (Legacy)',
    models: [
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'gpt-5.2',
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
    ],
    defaultModel: 'claude-opus-4-7',
    keyPlaceholder: 'Legacy account login',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'anthropic',
    label: 'Claude',
    models: [],
    defaultModel: 'claude-sonnet-4-0',
    keyPlaceholder: 'sk-ant-api03-...',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    models: [],
    defaultModel: 'gemini-3.6-flash',
    keyPlaceholder: 'AIza...',
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    models: [],
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [],
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

/** Normalize legacy saved settings while remaining compatible with one old main-process assignment that still exists in upstream-derived code. */
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
        baseUrl:
          typeof saved.baseUrl === 'string' ? saved.baseUrl : providers[meta.id]?.baseUrl,
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
  const migratedProvider: AiProviderId =
    candidate && AI_PROVIDERS.some((meta) => meta.id === candidate) ? candidate : defaults.provider
  let activeProvider: AiProviderId =
    migratedProvider === 'genspark' ? defaults.provider : migratedProvider
  const settings = { provider: activeProvider, providers }

  // Temporary compatibility fence: upstream-derived main-process code may still assign
  // settings.provider = 'genspark'. Ignore that one obsolete assignment while allowing
  // every real provider selection to remain writable. This will be removed when that
  // upstream-derived handler is fully deleted.
  Object.defineProperty(settings, 'provider', {
    enumerable: true,
    configurable: true,
    get: () => activeProvider,
    set: (value: AiProviderId) => {
      if (value !== 'genspark' && AI_PROVIDERS.some((meta) => meta.id === value)) {
        activeProvider = value
      }
    },
  })
  return settings
}
