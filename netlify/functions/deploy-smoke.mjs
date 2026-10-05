const DEV_SITE_NAME = 'gadgetdesign-dev'
const DEV_ENTITY_CODE = 'Local001'
const MAX_ATTEMPTS = 3

export default {
  async deploySucceeded(event) {
    await runDeploySmoke(event)
  },
}

export async function runDeploySmoke(event, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const logger = options.logger || console
  const wait = options.wait || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const origin = deployOrigin(event)
  const expectedCommit = deployCommit(event)
  const siteName = String(event?.site?.name || process.env.SITE_NAME || '')

  if (!origin) throw new Error('Smoke post-deploy: Netlify no informó la URL del deploy.')

  let lastError
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const results = await checkDeployment({ origin, expectedCommit, siteName, fetchImpl })
      logger.info(JSON.stringify({
        type: 'deploy-smoke',
        status: 'ok',
        site: siteName || 'unknown',
        origin,
        commit: results.commit,
        checks: results.checks,
      }))
      return results
    } catch (error) {
      lastError = error
      logger.warn(`Smoke post-deploy ${attempt}/${MAX_ATTEMPTS}: ${error.message}`)
      if (attempt < MAX_ATTEMPTS) await wait(attempt * 1_000)
    }
  }

  logger.error(JSON.stringify({
    type: 'deploy-smoke',
    status: 'failed',
    site: siteName || 'unknown',
    origin,
    error: lastError?.message || 'Error desconocido',
  }))
  throw lastError
}

async function checkDeployment({ origin, expectedCommit, siteName, fetchImpl }) {
  const buildInfo = await getJson(fetchImpl, `${origin}/build-info.json?smoke=${Date.now()}`)
  if (!buildInfo.commit) throw new Error('build-info.json no contiene el commit desplegado.')
  if (expectedCommit && buildInfo.commit !== expectedCommit) {
    throw new Error(`Commit incorrecto: esperado ${expectedCommit}, publicado ${buildInfo.commit}.`)
  }

  const health = await getJson(fetchImpl, `${origin}/.netlify/functions/health`)
  if (health.status !== 'ok') throw new Error('La Function health no respondió correctamente.')

  const checks = ['build-info', 'health']
  if (siteName === DEV_SITE_NAME) {
    const entity = await getJson(
      fetchImpl,
      `${origin}/.netlify/functions/entity?action=context&token=${DEV_ENTITY_CODE}`,
    )
    if (!entity.entity || entity.entity.shortCode !== DEV_ENTITY_CODE) {
      throw new Error(`No fue posible cargar la entidad de prueba ${DEV_ENTITY_CODE}.`)
    }
    checks.push('dev-entity')
  }

  return { commit: buildInfo.commit, checks }
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`${new URL(url).pathname} respondió HTTP ${response.status}.`)
  return response.json()
}

function deployOrigin(event) {
  const value = event?.deploy?.sslUrl
    || event?.deploy?.ssl_url
    || event?.deploy?.url
    || process.env.DEPLOY_PRIME_URL
    || process.env.URL
  return value ? String(value).replace(/\/$/, '') : ''
}

function deployCommit(event) {
  return String(
    event?.deploy?.commitRef
    || event?.deploy?.commit_ref
    || process.env.COMMIT_REF
    || '',
  )
}
