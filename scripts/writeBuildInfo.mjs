import { mkdir, writeFile } from 'node:fs/promises'

const commit = process.env.COMMIT_REF
  || process.env.GITHUB_SHA
  || process.env.HEAD
  || 'local'

const payload = {
  commit,
  context: process.env.CONTEXT || process.env.NODE_ENV || 'local',
  generatedAt: new Date().toISOString(),
}

await mkdir('public', { recursive: true })
await writeFile('public/build-info.json', JSON.stringify(payload, null, 2) + '\n', 'utf8')
console.log(`Build info generated for ${commit}`)
