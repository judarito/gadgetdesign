import { purgeCache } from '@netlify/functions'

const PUBLIC_CACHE_SECONDS = 60
const ENTITY_SESSION_COOKIE = 'gd_entity_session'
const CACHEABLE_CONTEXT_VARY = `query=action|categoryCode|token,cookie=${ENTITY_SESSION_COOKIE}`

export function publicEntityCacheHeaders(entityId, categoryId) {
  return {
    'cache-control': 'no-store',
    'netlify-cdn-cache-control': `public, durable, s-maxage=${PUBLIC_CACHE_SECONDS}`,
    'netlify-cache-tag': [entityCacheTag(entityId), categoryCacheTag(categoryId)].join(','),
    'netlify-vary': CACHEABLE_CONTEXT_VARY,
  }
}

export function privateEntityCacheHeaders() {
  return {
    'cache-control': 'no-store',
    'netlify-cdn-cache-control': 'no-store',
    'netlify-vary': CACHEABLE_CONTEXT_VARY,
  }
}

export async function purgeEntityCache(entityId) {
  await purgeTags([entityCacheTag(entityId)])
}

export async function purgeCategoryCache(categoryId) {
  await purgeTags([categoryCacheTag(categoryId)])
}

function entityCacheTag(entityId) {
  return `entity-${positiveId(entityId)}`
}

function categoryCacheTag(categoryId) {
  return `category-${positiveId(categoryId)}`
}

function positiveId(value) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new Error('No se puede construir una etiqueta de caché inválida.')
  return id
}

async function purgeTags(tags) {
  if (!isDeployedNetlifyContext()) return

  try {
    await purgeCache({ tags })
  } catch (error) {
    // La escritura ya fue confirmada en Turso. El TTL limita una purga fallida a 60 segundos.
    console.error(`No fue posible invalidar las etiquetas de caché: ${tags.join(', ')}`, error)
  }
}

function isDeployedNetlifyContext() {
  return ['production', 'deploy-preview', 'branch-deploy'].includes(process.env.CONTEXT)
}
