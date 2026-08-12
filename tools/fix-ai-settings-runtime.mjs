import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function replaceOnce(file, variants, name) {
  const full = path.join(root, file)
  let text = fs.readFileSync(full, 'utf8')
  for (const variant of variants) {
    if (text.includes(variant.find)) {
      text = text.replace(variant.find, variant.replace)
      fs.writeFileSync(full, text)
      console.log(`patched ${file}: ${name}`)
      return true
    }
  }
  console.log(`skipped ${file}: ${name} (already compatible / upstream layout changed)`)
  return false
}

replaceOnce(
  'apps/docs/src/main/docs-main.ts',
  [
    {
      // Older fork layout.
      find: "    // AI features all go through Genspark (gsk login); legacy settings with another provider are reset\n    settings.provider = 'genspark'\n",
      replace: '',
    },
    {
      // Upstream layout: force is expressed on one line.
      find: "    settings.provider = 'genspark'\n",
      replace: '',
    },
  ],
  'remove forced Genspark provider',
)

replaceOnce(
  'apps/shell/src/renderer/src/SettingsModal.tsx',
  [
    {
      find: `    void window.aiOffice.getAiSettings?.().then((settings) => {\n      if (!alive) return\n      setAiSettings(settings); setAiProvider(settings.provider)\n      const current = settings.providers[settings.provider]\n      setAiKey(current?.apiKey ?? ''); setAiModel(current?.model ?? '')\n      setAiBaseUrl(current?.baseUrl ?? '');\n    }).catch(() => undefined)\n`,
      replace: `    const fallback: AiSettings = {\n      provider: 'openrouter',\n      providers: {\n        openrouter: { apiKey: '', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },\n      },\n    } as AiSettings\n    void Promise.race([\n      window.aiOffice.getAiSettings?.(),\n      new Promise<AiSettings>((resolve) => setTimeout(() => resolve(fallback), 1500)),\n    ]).then((settings) => {\n      if (!alive || !settings) return\n      const provider = settings.provider || 'openrouter'\n      const current = settings.providers?.[provider] ?? { apiKey: '', model: '', baseUrl: undefined }\n      setAiSettings(settings)\n      setAiProvider(provider)\n      setAiKey(current.apiKey ?? '')\n      setAiModel(current.model ?? (provider === 'openrouter' ? 'nvidia/nemotron-3-ultra-550b-a55b:free' : ''))\n      setAiBaseUrl(current.baseUrl ?? '')\n    }).catch(() => {\n      if (!alive) return\n      setAiSettings(fallback)\n      setAiProvider('openrouter')\n      setAiModel('nvidia/nemotron-3-ultra-550b-a55b:free')\n    })\n`,
    },
  ],
  'make AI settings load non-blocking',
)
