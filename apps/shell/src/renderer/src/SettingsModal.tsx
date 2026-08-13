import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AI_PROVIDERS, type AiProviderId, type AiSettings } from '@genoffice/ai-provider'
import { useI18n } from './locale'
import type { StringKey } from './locale'
import type { AccountStatus, UiTheme } from '../../shared/home-api'
import './settings.css'

const LANG_OPTIONS = [
  { value: 'ar', label: 'العربية' },
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'he', label: 'עברית' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'pl', label: 'Polski' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'th', label: 'ไทย' },
  { value: 'zh', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const

const THEME_OPTIONS = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
] as const satisfies readonly { value: UiTheme; labelKey: StringKey }[]
const CHANNEL_OPTIONS = [
  { value: 'stable', labelKey: 'channelStable' },
  { value: 'beta', labelKey: 'channelBeta' },
] as const satisfies readonly { value: 'stable' | 'beta'; labelKey: StringKey }[]

type SectionId = 'account' | 'ai' | 'general' | 'about'
type SectionLabel = StringKey | 'AI'
const SECTIONS: readonly { id: SectionId; label: SectionLabel }[] = [
  { id: 'account', label: 'setSecAccount' },
  { id: 'ai', label: 'AI' },
  { id: 'general', label: 'setSecGeneral' },
  { id: 'about', label: 'setSecAbout' },
]

function SectionIcon({ id }: { id: SectionId }) {
  if (id === 'account')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="5.2" r="2.9" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M2.7 13.6a5.5 5.5 0 0 1 10.6 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    )
  if (id === 'ai')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 1.7l1.15 3.3L12.5 6.1l-3.35 1.15L8 10.6 6.85 7.25 3.5 6.1l3.35-1.1L8 1.7z"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M12.2 10.3l.55 1.65 1.55.55-1.55.55-.55 1.65-.55-1.65-1.55-.55 1.55-.55.55-1.65z"
          fill="currentColor"
        />
      </svg>
    )
  if (id === 'general')
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2 5h8M13 5h1M2 11h1M6 11h8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="11.5" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.5" cy="11" r="1.7" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    )
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.4v3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="5.1" r="0.8" fill="currentColor" />
    </svg>
  )
}

function Field({
  label,
  value,
  valueTitle,
  action,
}: {
  label: string
  value: string
  valueTitle?: string
  action?: ReactNode
}) {
  return (
    <div className="set-field">
      <div className="set-field-text">
        <div className="set-field-label">{label}</div>
        <div className="set-field-value" data-tip={valueTitle}>
          {value}
        </div>
      </div>
      {action}
    </div>
  )
}

export interface SettingsModalProps {
  status: AccountStatus | null
  loggingOut: boolean
  loginWaiting: boolean
  loginUrl: string | null
  urlCopied: boolean
  onOpenLoginUrl: () => void
  onCopyLoginUrl: () => void
  onClose: () => void
  onLogin: () => void
  onLogout: () => void
}

export function SettingsModal({
  status,
  loggingOut,
  loginWaiting,
  loginUrl,
  urlCopied,
  onOpenLoginUrl,
  onCopyLoginUrl,
  onClose,
  onLogin,
  onLogout,
}: SettingsModalProps) {
  const { lang, setLang, t } = useI18n()
  const [section, setSection] = useState<SectionId>('account')
  const [theme, setTheme] = useState<UiTheme>('system')
  const [saveDir, setSaveDir] = useState('')
  const [channel, setChannel] = useState<'stable' | 'beta'>('stable')
  const [appVersion, setAppVersion] = useState('')
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  const [aiProvider, setAiProvider] = useState<AiProviderId>('openrouter')
  const [aiKey, setAiKey] = useState('')
  const [aiModel, setAiModel] = useState('nvidia/nemotron-3-ultra-550b-a55b:free')
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiSaving, setAiSaving] = useState(false)
  const [aiSaved, setAiSaved] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(true)
  const [aiClearKey, setAiClearKey] = useState(false)

  useEffect(() => {
    let alive = true
    void window.aiOffice.getTheme?.().then((th) => {
      if (alive) setTheme(th)
    })
    void window.aiOffice.getDefaultSaveDir?.().then((dir) => {
      if (alive && dir) setSaveDir(dir)
    })
    void window.aiOffice.getUpdateChannel?.().then((ch) => {
      if (alive) setChannel(ch)
    })
    void window.aiOffice.getAppVersion?.().then((v) => {
      if (alive && v) setAppVersion(v)
    })
    void window.aiOffice
      .getAiSettings?.()
      .then((settings) => {
        if (!alive) return
        setAiError(null)
        setAiSettings(settings)
        setAiProvider(settings.provider)
        const current = settings.providers[settings.provider]
        setAiKey(current?.apiKey ?? '')
        setAiClearKey(false)
        setAiModel(current?.model ?? '')
        setAiBaseUrl(current?.baseUrl ?? '')
      })
      .catch((error) => {
        if (!alive) return
        setAiError(error instanceof Error ? error.message : 'Unable to load AI settings')
      })
      .finally(() => {
        if (alive) setAiLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const applyTheme = (next: UiTheme) => {
    setTheme(next)
    void window.aiOffice.setTheme(next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', next)
  }
  const changeSaveDir = () => {
    void window.aiOffice.pickDefaultSaveDir?.().then((dir) => {
      if (dir) setSaveDir(dir)
    })
  }
  const loggedIn = status?.loggedIn ?? false
  const email = status?.email ?? ''
  const aiMeta = AI_PROVIDERS.find((p) => p.id === aiProvider) ?? AI_PROVIDERS[0]
  const selectableProviders = AI_PROVIDERS.filter((p) => p.id !== 'genspark')

  const selectProvider = (provider: AiProviderId) => {
    if (!aiSettings) return
    const meta = AI_PROVIDERS.find((p) => p.id === provider)
    const current = aiSettings.providers[provider]
    setAiProvider(provider)
    setAiKey(current?.apiKey ?? '')
    setAiClearKey(false)
    setAiBaseUrl(current?.baseUrl ?? '')
    setAiModel(current?.model || meta?.defaultModel || '')
    setAiSaved(false)
    setAiError(null)
  }
  const saveAi = async () => {
    if (!aiSettings) return
    setAiSaving(true)
    setAiSaved(false)
    setAiError(null)
    try {
      const providers = { ...aiSettings.providers }
      const previous = providers[aiProvider] ?? { apiKey: '', model: '', baseUrl: undefined }
      providers[aiProvider] = {
        ...previous,
        apiKey: aiKey.trim(),
        clearApiKey: aiClearKey || undefined,
        model: aiModel.trim(),
        baseUrl: aiProvider === 'custom' ? aiBaseUrl.trim() : previous.baseUrl,
      }
      const next: AiSettings = { provider: aiProvider, providers }
      await window.aiOffice.setAiSettings(next)
      setAiSettings(next)
      setAiSaved(true)
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Unable to save AI settings')
    } finally {
      setAiSaving(false)
    }
  }

  return (
    <div
      className="set-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="set-dialog" role="dialog" aria-modal="true" aria-label={t('settings')}>
        <div className="set-header">
          <h2 className="set-title">{t('settings')}</h2>
          <button className="set-close" onClick={onClose} aria-label={t('cancel')}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2 2l10 10M12 2L2 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('settings')}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={`set-nav-item${section === s.id ? ' active' : ''}`}
                aria-current={section === s.id}
                onClick={() => setSection(s.id)}
              >
                <SectionIcon id={s.id} />
                {s.label === 'AI' ? 'AI' : t(s.label)}
              </button>
            ))}
          </nav>
          <div className="set-pane">
            {section === 'account' && (
              <>
                <h3 className="set-pane-title">{t('setSecAccount')}</h3>
                <Field label={t('setEmail')} value={loggedIn ? email : t('setNotLoggedIn')} />
                <div className="set-pane-footer">
                  {loggedIn ? (
                    <button className="set-btn danger" disabled={loggingOut} onClick={onLogout}>
                      {loggingOut ? t('loggingOut') : t('logout')}
                    </button>
                  ) : (
                    <>
                      {loginWaiting && loginUrl && (
                        <>
                          <button className="set-btn" onClick={onOpenLoginUrl}>
                            {t('loginOpenManually')}
                          </button>
                          <button className="set-btn" onClick={onCopyLoginUrl}>
                            {urlCopied ? t('loginCopied') : t('loginCopyUrl')}
                          </button>
                        </>
                      )}
                      <button className="set-btn primary" onClick={onLogin}>
                        {loginWaiting ? t('waitingShort') : t('loginGenspark')}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            {section === 'ai' && (
              <>
                <h3 className="set-pane-title">AI</h3>
                {aiLoading && (
                  <div
                    role="status"
                    style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}
                  >
                    Loading AI settings…
                  </div>
                )}
                {aiError && (
                  <div
                    role="alert"
                    style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}
                  >
                    {aiError}
                  </div>
                )}
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label" htmlFor="ai-provider">
                      Provider
                    </label>
                    <div className="set-field-value">Direct API · no Genspark sign-in</div>
                  </div>
                  <span className="set-select-wrap">
                    <select
                      id="ai-provider"
                      className="set-select"
                      value={aiProvider}
                      onChange={(e) => selectProvider(e.target.value as AiProviderId)}
                    >
                      {selectableProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label" htmlFor="ai-key">
                      API Key
                    </label>
                    <div className="set-field-value">Saved locally on this computer</div>
                  </div>
                  <input
                    id="ai-key"
                    className="set-select"
                    style={{ minWidth: 250, padding: '8px 10px' }}
                    type="password"
                    value={aiKey}
                    placeholder={aiMeta?.keyPlaceholder ?? 'API Key'}
                    onChange={(e) => {
                      setAiKey(e.target.value)
                      setAiClearKey(false)
                      setAiSaved(false)
                    }}
                  />
                  <button
                    className="set-btn danger"
                    type="button"
                    onClick={() => {
                      setAiKey('')
                      setAiClearKey(true)
                      setAiSaved(false)
                    }}
                  >
                    Clear
                  </button>
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label" htmlFor="ai-model">
                      Model
                    </label>
                    <div className="set-field-value">
                      Choose a model supported by the selected provider
                    </div>
                  </div>
                  {aiMeta?.models?.length ? (
                    <span className="set-select-wrap">
                      <select
                        id="ai-model"
                        className="set-select"
                        value={aiModel}
                        onChange={(e) => {
                          setAiModel(e.target.value)
                          setAiSaved(false)
                        }}
                      >
                        {aiMeta.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </span>
                  ) : (
                    <input
                      id="ai-model"
                      className="set-select"
                      style={{ minWidth: 250, padding: '8px 10px' }}
                      value={aiModel}
                      placeholder="Model name"
                      onChange={(e) => {
                        setAiModel(e.target.value)
                        setAiSaved(false)
                      }}
                    />
                  )}
                </div>
                {aiProvider === 'custom' && (
                  <div className="set-field">
                    <div className="set-field-text">
                      <label className="set-field-label" htmlFor="ai-base-url">
                        Base URL
                      </label>
                      <div className="set-field-value">OpenAI-compatible endpoint</div>
                    </div>
                    <input
                      id="ai-base-url"
                      className="set-select"
                      style={{ minWidth: 250, padding: '8px 10px' }}
                      value={aiBaseUrl}
                      placeholder="https://api.example.com/v1"
                      onChange={(e) => {
                        setAiBaseUrl(e.target.value)
                        setAiSaved(false)
                      }}
                    />
                  </div>
                )}
                <div className="set-pane-footer">
                  <span style={{ fontSize: 12, color: '#16824d' }}>{aiSaved ? 'Saved ✓' : ''}</span>
                  <button
                    className="set-btn primary"
                    disabled={aiSaving || !aiModel.trim()}
                    onClick={() => void saveAi()}
                  >
                    {aiSaving ? 'Saving…' : 'Save AI Settings'}
                  </button>
                </div>
              </>
            )}
            {section === 'general' && (
              <>
                <h3 className="set-pane-title">{t('setSecGeneral')}</h3>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label" htmlFor="set-lang">
                      {t('language')}
                    </label>
                  </div>
                  <span className="set-select-wrap">
                    <span className="set-select-text" aria-hidden="true">
                      {LANG_OPTIONS.find((o) => o.value === lang)?.label ?? lang}
                    </span>
                    <select
                      id="set-lang"
                      className="set-select"
                      value={lang}
                      onChange={(e) => setLang(e.target.value as typeof lang)}
                    >
                      {LANG_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label" htmlFor="set-theme">
                      {t('theme')}
                    </label>
                  </div>
                  <span className="set-select-wrap">
                    <span className="set-select-text" aria-hidden="true">
                      {t(THEME_OPTIONS.find((o) => o.value === theme)?.labelKey ?? 'themeSystem')}
                    </span>
                    <select
                      id="set-theme"
                      className="set-select"
                      value={theme}
                      onChange={(e) => applyTheme(e.target.value as UiTheme)}
                    >
                      {THEME_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
                <Field
                  label={t('saveLocation')}
                  value={saveDir || '—'}
                  valueTitle={saveDir}
                  action={
                    <button className="set-btn" onClick={changeSaveDir}>
                      {t('setChange')}
                    </button>
                  }
                />
              </>
            )}
            {section === 'about' && (
              <>
                <h3 className="set-pane-title">{t('setSecAbout')}</h3>
                <Field label={t('versionLabel')} value={appVersion || '—'} />
                <div className="set-field">
                  <div className="set-field-text">
                    <label className="set-field-label" htmlFor="set-channel">
                      {t('updateChannel')}
                    </label>
                  </div>
                  <span className="set-select-wrap">
                    <span className="set-select-text" aria-hidden="true">
                      {t(
                        CHANNEL_OPTIONS.find((o) => o.value === channel)?.labelKey ??
                          'channelStable',
                      )}
                    </span>
                    <select
                      id="set-channel"
                      className="set-select"
                      value={channel}
                      onChange={(e) => {
                        const next = e.target.value === 'beta' ? 'beta' : 'stable'
                        setChannel(next)
                        void window.aiOffice.setUpdateChannel(next)
                      }}
                    >
                      {CHANNEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
