import { strict as assert } from 'node:assert'
import { runDeploySmoke } from '../netlify/functions/deploy-smoke.mjs'

const commit = 'abc123'
const calls = []
const responses = new Map([
  ['/build-info.json', { commit }],
  ['/.netlify/functions/health', { status: 'ok' }],
  ['/.netlify/functions/entity', { entity: { shortCode: 'Local001' } }],
])

const fetchImpl = async (input) => {
  const url = new URL(input)
  calls.push(url.pathname)
  const payload = responses.get(url.pathname)
  return new Response(JSON.stringify(payload || { error: 'No encontrado' }), {
    status: payload ? 200 : 404,
    headers: { 'content-type': 'application/json' },
  })
}

const logger = { info() {}, warn() {}, error() {} }
const event = {
  deploy: { sslUrl: 'https://dev.example.test', commitRef: commit },
  site: { name: 'gadgetdesign-dev' },
}

const result = await runDeploySmoke(event, { fetchImpl, logger, wait: async () => {} })
assert.deepEqual(result.checks, ['build-info', 'health', 'dev-entity'])
assert.deepEqual(calls, [
  '/build-info.json',
  '/.netlify/functions/health',
  '/.netlify/functions/entity',
])

const productionCalls = []
await runDeploySmoke({
  deploy: { url: 'https://prod.example.test', commit_ref: commit },
  site: { name: 'gadgetdesign' },
}, {
  fetchImpl: async (input) => {
    const url = new URL(input)
    productionCalls.push(url.pathname)
    return fetchImpl(input)
  },
  logger,
  wait: async () => {},
})
assert.deepEqual(productionCalls, ['/build-info.json', '/.netlify/functions/health'])

await assert.rejects(
  () => runDeploySmoke({
    deploy: { url: 'https://dev.example.test', commitRef: 'otro-commit' },
    site: { name: 'gadgetdesign-dev' },
  }, { fetchImpl, logger, wait: async () => {} }),
  /Commit incorrecto/,
)

console.log('✓ Smoke post-deploy valida commit, health y entidad ficticia de dev')
console.log('✓ Producción no depende de datos ficticios del entorno dev')
console.log('✓ Un commit publicado incorrectamente hace fallar la comprobación')
