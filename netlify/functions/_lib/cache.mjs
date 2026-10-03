import { purgeCache } from '@netlify/functions'

const PUBLIC_CACHE_SECONDS = 60
const ENTITY_SESSION_COOKIE = 'gd_entity_session'
const CLIENT_SESSION_COOKIE = 'gd_client_session'
// Las dos sesiones cambian la respuesta: sin la del cliente en la variación,
// quien entra desde el portal recibiría la lectura anónima cacheada y vería sus
// datos protegidos enmascarados.
const CACHEABLE_CONTEXT_VARY =
  `query=action|categoryCode|token,cookie=${ENTITY_SESSION_COOKIE}|${CLIENT_SESSION_COOKIE}`

/**
 * La caché de CDN solo es segura si podemos invalidarla.
 *
 * `purgeCache()` exige `NETLIFY_PURGE_API_TOKEN` en el entorno y lanza si no
 * está. Sin él, la purga falla en silencio (se registra y se sigue), así que
 * cada escritura dejaba la lectura pública con datos viejos hasta que expiraba
 * el TTL: hasta 60 segundos viendo una ficha ya borrada o un dato ya editado.
 *
 * Mientras el token no esté configurado se responde `no-store`: se pierde algo
 * de caché y se gana que lo que se lee sea lo que hay.
 */
function canPurgeCache() {
  return Boolean(process.env.NETLIFY_PURGE_API_TOKEN)
}

export function publicEntityCacheHeaders(entityId, categoryId) {
  if (!canPurgeCache()) return privateEntityCacheHeaders()

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

/** Purga varias fichas de una vez: al cambiar un cliente cambian todas las suyas. */
export async function purgeEntityCaches(entityIds) {
  const ids = [...new Set(entityIds.map((id) => positiveId(id)))]
  if (ids.length) await purgeTags(ids.map(entityCacheTag))
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
  if (!hasCdnCache()) return

  try {
    await purgeCache({ tags })
  } catch (error) {
    // La escritura ya fue confirmada en Turso. Mientras la purga falle, el TTL
    // es lo único que impide servir la versión vieja.
    console.error(`No fue posible invalidar las etiquetas de caché: ${tags.join(', ')}`, error)
  }
}

/**
 * ¿Hay un CDN que invalidar?
 *
 * Antes esto miraba `process.env.CONTEXT`, que en este runtime de Functions no
 * existe: la comprobación era siempre falsa, así que la purga no se ejecutaba
 * nunca —ni en producción— y cada escritura dejaba la lectura pública con datos
 * viejos hasta que expiraba el TTL de 60 segundos.
 *
 * `NETLIFY_LOCAL` sí lo pone el CLI en local, y el token está en el runtime
 * desplegado.
 */
function hasCdnCache() {
  return !process.env.NETLIFY_LOCAL && canPurgeCache()
}
