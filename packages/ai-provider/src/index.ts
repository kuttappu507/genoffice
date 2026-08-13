export type {
  AiChatRequest,
  AiChatResponse,
  AiProviderConfig,
  AiProviderId,
  AiProviderMeta,
  AiSettings,
  AiStreamChunk,
  AiStreamRequest,
  GenSparkAccountStatus,
  LegacyAiSettings,
} from './types'
export {
  AI_PROVIDERS,
  GENSPARK_LLM_BASE_URLS,
  defaultAiSettings,
  resolveAiSettings,
} from './providers'
export { chatForProvider } from './chat'
export { setRescueFetch } from './fetch'
export { AiCreditsError, sseLines, streamForProvider } from './stream'
export type { StreamCallbacks } from './stream'
export {
  AI_CHAT_RESPONSE_TIMEOUT_MS,
  AI_CONNECT_TIMEOUT_MS,
  AI_IDLE_TIMEOUT_MS,
  AiTimeoutError,
  createStreamWatchdog,
} from './watchdog'
export type { StreamWatchdog } from './watchdog'

// Install the Electron-main IPC secret adapter before any editor registers its
// ai:* handlers. In renderer processes this import is a no-op.
import './electron-secure-ipc'
