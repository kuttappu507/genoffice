import { readFileSync, writeFileSync } from 'node:fs'

function removeForcedGenspark(path) {
  const src = readFileSync(path, 'utf8')
  const patterns = [
    /\n\s*\/\/ AI features all go through Genspark[^\n]*\n\s*settings\.provider = 'genspark'\n/,
    /\n\s*settings\.provider = 'genspark'\n/,
  ]
  let next = src
  for (const pattern of patterns) next = next.replace(pattern, '\n')
  if (next !== src) writeFileSync(path, next)
}

removeForcedGenspark('apps/docs/src/main/docs-main.ts')
removeForcedGenspark('apps/sheets/src/main/sheets-main.ts')
console.log('Direct AI provider runtime patch applied: configured provider is preserved.')
