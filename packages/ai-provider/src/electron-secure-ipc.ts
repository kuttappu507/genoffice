/*
 * Main-process AI IPC security adapter.
 *
 * The office apps register their legacy ai:* handlers in different modules, but
 * all of them import @genoffice/ai-provider before registration. This adapter
 * wraps those handlers once, so API keys are encrypted with Electron's OS-backed
 * safeStorage before they reach ai-settings.json and are never returned to a
 * renderer. Runtime chat/stream requests are hydrated with the decrypted key
 * only inside the main process.
 */

const SECURE_PREFIX = 'genoffice-secure:v1:'
const MASKED_KEY = ''
const SETTINGS_FILE = 'ai-settings.json'

interface StoredProviderConfig {
  apiKey?: unknown
  model?: unknown
  baseUrl?: unknown
}

interface StoredSettings {
  provider?: unknown
  providers?: Record<string, StoredProviderConfig>
  apiKey?: unknown
  model?: unknown
  baseUrl?: unknown
}

function tryGetElectronMain(): { ipcMain: any; safeStorage: any; app: any } | null {
  try {
    if (typeof process === 'undefined' || process.type !== 'browser') return null
    // Keep the electron import out of renderer bundles. electron-vite leaves this
    // path available in the main process, while renderer execution never reaches it.
    const getRequire = Function('return require') as () => NodeRequire
    const req = getRequire()
    const electron = req('electron') as { ipcMain: any; safeStorage: any; app: any }
    return electron
  } catch {
    return null
  }
}

function settingsPath(app: any): string {
  const path = requirePath()
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function requirePath(): { join: (a: string, b: string) => string } {
  const getRequire = Function('return require') as () => NodeRequire
  return getRequire()('node:path') as { join: (a: string, b: string) => string }
}

function readFileJson(filePath: string): StoredSettings {
  const getRequire = Function('return require') as () => NodeRequire
  const fs = getRequire()('node:fs') as typeof import('node:fs')
  try {
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredSettings
  } catch {
    return {}
  }
}

function writeFileJson(filePath: string, value: StoredSettings): void {
  const getRequire = Function('return require') as () => NodeRequire
  const fs = getRequire()('node:fs') as typeof import('node:fs')
  fs.mkdirSync(requirePath().join(filePath, '..'), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function encryptKey(safeStorage: any, value: string): string {
  if (!value) return ''
  if (value.startsWith(SECURE_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure API-key storage is unavailable on this system. Enable the OS keychain/keyring and try again.')
  }
  const encrypted = safeStorage.encryptString(value).toString('base64')
  return `${SECURE_PREFIX}${encrypted}`
}

function decryptKey(safeStorage: any, value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  if (!value.startsWith(SECURE_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(SECURE_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

function normalizeProviders(stored: StoredSettings, safeStorage: any): Record<string, StoredProviderConfig> {
  const providers = { ...(stored.providers ?? {}) }
  for (const [id, cfg] of Object.entries(providers)) {
    providers[id] = {
      ...(cfg ?? {}),
      apiKey: decryptKey(safeStorage, cfg?.apiKey),
    }
  }
  return providers
}

function encryptSettings(input: any, existing: StoredSettings, safeStorage: any): any {
  const next = structuredClone(input ?? {}) as any
  const existingProviders = existing.providers ?? {}
  const providers = { ...(next.providers ?? {}) }
  for (const [id, cfg] of Object.entries(providers)) {
    const old = existingProviders[id] ?? {}
    const incoming = typeof (cfg as any)?.apiKey === 'string' ? (cfg as any).apiKey : ''
    const keepExisting = incoming === ''
    providers[id] = {
      ...(cfg as any),
      apiKey: keepExisting
        ? (typeof old.apiKey === 'string' ? old.apiKey : '')
        : encryptKey(safeStorage, incoming),
    }
  }
  next.providers = providers
  return next
}

function sanitizeSettings(result: any, safeStorage: any): any {
  if (!result || typeof result !== 'object') return result
  const next = structuredClone(result)
  if (next.providers && typeof next.providers === 'object') {
    for (const [id, cfg] of Object.entries(next.providers as Record<string, StoredProviderConfig>)) {
      const key = decryptKey(safeStorage, (cfg as StoredProviderConfig)?.apiKey)
      ;(next.providers as any)[id] = { ...(cfg as any), apiKey: key ? MASKED_KEY : '' }
    }
  }
  if (next.provider === 'genspark') next.provider = 'openrouter'
  return next
}

function hydrateRequest(request: any, existing: StoredSettings, safeStorage: any): any {
  const next = structuredClone(request ?? {}) as any
  const provider = next?.settings?.provider
  if (!provider) return next
  const saved = existing.providers?.[provider] ?? {}
  const incoming = next.settings?.providers?.[provider]
  const key = typeof incoming?.apiKey === 'string' && incoming.apiKey ? incoming.apiKey : decryptKey(safeStorage, saved.apiKey)
  if (next.settings?.providers?.[provider]) {
    next.settings.providers[provider] = {
      ...next.settings.providers[provider],
      apiKey: key,
    }
  }
  return next
}

let installed = false

export function installSecureAiIpcAdapter(): void {
  if (installed) return
  const electron = tryGetElectronMain()
  if (!electron) return
  const { ipcMain, safeStorage, app } = electron
  if (!ipcMain?.handle || !app?.getPath) return

  installed = true
  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel: string, listener: (...args: any[]) => any) => {
    if (!['ai:get-settings', 'ai:set-settings', 'ai:stream', 'ai:chat'].includes(channel)) {
      return originalHandle(channel, listener)
    }

    const wrapped = async (event: any, ...args: any[]) => {
      const filePath = settingsPath(app)
      const existing = readFileJson(filePath)

      if (channel === 'ai:get-settings') {
        const result = await listener(event, ...args)
        // Opportunistically migrate legacy plaintext keys to OS-backed storage.
        if (existing.providers && safeStorage.isEncryptionAvailable()) {
          const encrypted = { ...existing, providers: { ...(existing.providers ?? {}) } }
          let changed = false
          for (const [id, cfg] of Object.entries(encrypted.providers)) {
            const raw = typeof cfg?.apiKey === 'string' ? cfg.apiKey : ''
            if (raw && !raw.startsWith(SECURE_PREFIX)) {
              encrypted.providers[id] = { ...cfg, apiKey: encryptKey(safeStorage, raw) }
              changed = true
            }
          }
          if (changed) writeFileJson(filePath, encrypted)
        }
        return sanitizeSettings(result, safeStorage)
      }

      if (channel === 'ai:set-settings') {
        const input = args[0]
        const encrypted = encryptSettings(input, existing, safeStorage)
        return listener(event, encrypted)
      }

      if (channel === 'ai:stream' || channel === 'ai:chat') {
        return listener(event, hydrateRequest(args[0], existing, safeStorage))
      }

      return listener(event, ...args)
    }

    return originalHandle(channel, wrapped)
  }) as typeof ipcMain.handle
}

installSecureAiIpcAdapter()
