import { getDb } from './_lib/db.mjs'
import { sendAccessCode } from './_lib/email.mjs'
import {
  privateEntityCacheHeaders,
  publicEntityCacheHeaders,
  purgeEntityCache,
} from './_lib/cache.mjs'
import {
  HttpError,
  clearCookie,
  getClientIp,
  getCookie,
  handleError,
  json,
  readJson,
  sessionCookie,
} from './_lib/http.mjs'
import {
  CLIENT_COOKIE,
  ENTITY_COOKIE,
  ENTITY_SESSION_SECONDS,
  OTP_SECONDS,
  decryptValue,
  encryptValue,
  entityAccessScope,
  generateOtp,
  hashOtp,
  maskEmail,
  requireEntityAccess,
  requireEntitySession,
  safeEqualHex,
  signSession,
} from './_lib/security.mjs'
import {
  CUSTOM_DATA_LIMIT,
  createCustomDataItem,
  parseCustomData,
  serializeCustomData,
} from '../../src/services/customData.js'
import {
  sanitizeCustomDataInput,
  validateCategoryCode,
  validateEntityToken,
} from '../../src/services/validation.js'

export default async function handler(request) {
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'context'

    if (request.method === 'GET' && action === 'context') {
      const context = await getContext(request, routeInput(url.searchParams))
      const isAnonymous = !getCookie(request, ENTITY_COOKIE) && !getCookie(request, CLIENT_COOKIE)
      const cacheHeaders = isAnonymous && context.entity
        ? publicEntityCacheHeaders(context.entity.id, context.category.id)
        : privateEntityCacheHeaders()
      return json(context, 200, cacheHeaders)
    }
    if (request.method === 'POST' && action === 'request-code') {
      return await requestCode(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'verify-code') {
      return await verifyCode(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'logout') {
      return json({ ok: true }, 200, {
        'set-cookie': [clearCookie(ENTITY_COOKIE), clearCookie(CLIENT_COOKIE)],
      })
    }
    if (request.method === 'POST' && action === 'create-data') {
      return await mutateData(request, await readJson(request), 'create')
    }
    if (request.method === 'PATCH' && action === 'update-data') {
      return await mutateData(request, await readJson(request), 'update')
    }
    if (request.method === 'DELETE' && action === 'delete-data') {
      return await mutateData(request, await readJson(request), 'delete')
    }
    if (request.method === 'DELETE' && action === 'delete-entity') {
      return await deleteCurrentEntity(request, await readJson(request))
    }

    throw new HttpError(404, 'Operación no encontrada.')
  } catch (error) {
    return handleError(error)
  }
}

function routeInput(source) {
  return {
    categoryCode: source.get('categoryCode') || null,
    token: source.get('token'),
  }
}

async function getContext(request, route, forceAuthorized = false) {
  const db = getDb()
  const { entity, category, cliente } = await findEntity(db, route)
  if (!entity || !category) return { category: null, entity: null, suggestions: [], auth: emptyAuth() }

  // El alcance viaja al cliente: la pagina de la ficha borra la ficha entera
  // solo si la sesion es la de esa ficha, no la del portal.
  const scope = forceAuthorized ? 'entity' : entityAccessScope(request, entity, cliente)
  const authorized = Boolean(scope)
  const suggestionsResult = await db.execute({
    sql: `SELECT id, name, data_type
          FROM CategoriaSugerencias
          WHERE categoriaID = ? AND active = 1
          ORDER BY sort_order, id
          LIMIT ?`,
    args: [category.id, CUSTOM_DATA_LIMIT],
  })

  return {
    category,
    entity: {
      id: entity.id,
      identificacion: entity.identificacion,
      shortCode: entity.shortCode,
      customData: exposeCustomData(entity.customData, authorized),
    },
    suggestions: suggestionsResult.rows.map((row) => ({
      id: Number(row.id),
      key: String(row.name),
      dataType: String(row.data_type || 'text'),
    })),
    auth: {
      authorized,
      scope,
      canRequestCode: Boolean(cliente?.email && cliente.active),
      // El correo enmascarado del dueño no se publica si el cliente está
      // desactivado: la ficha queda en solo lectura y la pista no aporta nada.
      emailHint: cliente?.active ? maskEmail(cliente.email) : '',
    },
  }
}

async function requestCode(request, payload) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  if (!cliente?.email || !cliente.active) {
    throw new HttpError(409, 'Esta entidad todavía no tiene un correo de acceso configurado.')
  }

  const now = Math.floor(Date.now() / 1000)
  const ip = getClientIp(request)
  await db.execute({ sql: 'DELETE FROM EntityAccessCodes WHERE created_at < ?', args: [now - 86400] })

  const limits = await db.execute({
    sql: `SELECT
            SUM(CASE WHEN entity_id = ? THEN 1 ELSE 0 END) AS entity_requests,
            SUM(CASE WHEN request_ip = ? THEN 1 ELSE 0 END) AS ip_requests
          FROM EntityAccessCodes
          WHERE created_at >= ?`,
    args: [entity.id, ip, now - 900],
  })
  const limit = limits.rows[0]
  if (Number(limit?.entity_requests || 0) >= 5 || Number(limit?.ip_requests || 0) >= 10) {
    throw new HttpError(429, 'Se solicitaron demasiados códigos. Espera 15 minutos.')
  }

  const code = generateOtp()
  const insertedCode = await db.execute({
    sql: `INSERT INTO EntityAccessCodes
          (entity_id, code_hash, expires_at, attempts, consumed, request_ip, created_at)
          VALUES (?, ?, ?, 0, 0, ?, ?)`,
    args: [entity.id, hashOtp('entity', entity.id, code), now + OTP_SECONDS, ip, now],
  })
  try {
    await sendAccessCode({
      to: cliente.email,
      code,
      identification: entity.identificacion,
    })
  } catch (error) {
    if (insertedCode.lastInsertRowid !== undefined) {
      await db.execute({
        sql: 'DELETE FROM EntityAccessCodes WHERE id = ?',
        args: [insertedCode.lastInsertRowid],
      }).catch(() => {})
    }
    throw error
  }

  return json({ ok: true, emailHint: maskEmail(cliente.email) })
}

async function verifyCode(request, payload) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  if (!cliente?.email || !cliente.active) {
    throw new HttpError(409, 'Esta entidad todavía no tiene un correo de acceso configurado.')
  }
  const code = String(payload.code || '').trim()
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Escribe el código de seis dígitos.')

  const now = Math.floor(Date.now() / 1000)
  const result = await db.execute({
    sql: `SELECT id, code_hash, attempts
          FROM EntityAccessCodes
          WHERE entity_id = ? AND consumed = 0 AND expires_at >= ?
          ORDER BY id DESC LIMIT 1`,
    args: [entity.id, now],
  })
  const accessCode = result.rows[0]
  if (!accessCode) throw new HttpError(400, 'El código venció. Solicita uno nuevo.')
  if (Number(accessCode.attempts) >= 5) {
    throw new HttpError(429, 'El código fue bloqueado por demasiados intentos.')
  }

  if (!safeEqualHex(String(accessCode.code_hash), hashOtp('entity', entity.id, code))) {
    await db.execute({
      sql: 'UPDATE EntityAccessCodes SET attempts = attempts + 1 WHERE id = ?',
      args: [accessCode.id],
    })
    throw new HttpError(400, 'El código no es correcto.')
  }

  // Consumo atómico: evita que dos peticiones simultáneas con el mismo código
  // emitan dos sesiones.
  const claimed = await db.execute({
    sql: 'UPDATE EntityAccessCodes SET consumed = 1 WHERE id = ? AND consumed = 0',
    args: [accessCode.id],
  })
  if (!Number(claimed.rowsAffected)) throw new HttpError(400, 'El código venció. Solicita uno nuevo.')

  const token = signSession({
    type: 'entity',
    entityId: Number(entity.id),
    clienteId: Number(cliente.id),
    ver: Number(cliente.authVersion),
  }, ENTITY_SESSION_SECONDS)

  return json(
    await getContext(request, payload, true),
    200,
    { 'set-cookie': sessionCookie(ENTITY_COOKIE, token, ENTITY_SESSION_SECONDS) },
  )
}

async function mutateData(request, payload, operation) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  requireEntityAccess(request, entity, cliente)

  let customData = entity.customData
  if (operation === 'create') {
    if (customData.length >= CUSTOM_DATA_LIMIT) {
      throw new HttpError(409, `Solo puedes guardar hasta ${CUSTOM_DATA_LIMIT} datos personalizados.`)
    }
    customData = [...customData, asBadRequest(() => secureItem(createCustomDataItem(payload.data), payload.data))]
  } else if (operation === 'update') {
    const itemId = String(payload.itemId || '')
    if (!customData.some((item) => item.id === itemId)) {
      throw new HttpError(404, 'No se encontró el dato personalizado.')
    }
    const safe = asBadRequest(() => sanitizeCustomDataInput(payload.data))
    customData = customData.map((item) => item.id === itemId
      ? secureItem({ ...item, ...safe }, payload.data)
      : item)
  } else {
    const itemId = String(payload.itemId || '')
    if (!customData.some((item) => item.id === itemId)) {
      throw new HttpError(404, 'No se encontró el dato personalizado.')
    }
    customData = customData.filter((item) => item.id !== itemId)
  }

  const serialized = asBadRequest(() => serializeCustomData(customData))
  await db.execute({
    sql: 'UPDATE Entidades SET custom_data = ? WHERE id = ?',
    args: [serialized, entity.id],
  })
  await purgeEntityCache(entity.id)
  return json(await getContext(request, payload))
}

async function deleteCurrentEntity(request, payload) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  requireEntitySession(request, entity, cliente)

  const confirmation = String(payload.confirmation || '').trim()
  if (confirmation !== entity.identificacion.trim()) {
    throw new HttpError(400, 'Escribe el identificador exactamente como aparece en la ficha.')
  }

  await db.batch([
    { sql: 'DELETE FROM EntityAccessCodes WHERE entity_id = ?', args: [entity.id] },
    { sql: 'DELETE FROM EntityAliases WHERE entity_id = ?', args: [entity.id] },
    { sql: 'DELETE FROM Entidades WHERE id = ?', args: [entity.id] },
  ], 'write')
  await purgeEntityCache(entity.id)

  return json(
    { ok: true },
    200,
    { 'set-cookie': [clearCookie(ENTITY_COOKIE), clearCookie(CLIENT_COOKIE)] },
  )
}

function secureItem(item, payload) {
  const isProtected = Boolean(payload?.protected)
  const next = {
    ...item,
    protected: isProtected,
  }
  delete next.masked
  delete next.encryptedValue

  if (isProtected) {
    next.encryptedValue = encryptValue(item.value)
    delete next.value
  }
  return next
}

function exposeCustomData(items, authorized) {
  return items.map((item) => {
    const exposed = { ...item, protected: Boolean(item.protected) }
    if (!exposed.protected) return exposed

    delete exposed.encryptedValue
    if (authorized) {
      exposed.value = item.encryptedValue ? decryptValue(item.encryptedValue) : String(item.value || '')
      exposed.masked = false
    } else {
      exposed.value = ''
      exposed.masked = true
    }
    return exposed
  })
}

async function findEntity(db, route) {
  const safeToken = asBadRequest(() => validateEntityToken(route.token))
  const safeCategory = route.categoryCode ? asBadRequest(() => validateCategoryCode(route.categoryCode)) : null
  const categoryFilter = safeCategory ? 'AND c.code = ?' : ''
  const args = safeCategory
    ? [safeToken, safeToken, safeToken, safeCategory]
    : [safeToken, safeToken, safeToken]
  const result = await db.execute({
    sql: `SELECT DISTINCT e.id, e.Identificacion AS identificacion, e.token,
                 e.short_code, e.categoriaID, e.custom_data,
                 e.auth_version, e.clienteID,
                 c.id AS category_id, c.name AS category_name,
                 c.active AS category_active, c.code AS category_code,
                 cl.id AS client_id, cl.name AS client_name,
                 cl.email AS client_email, cl.phone AS client_phone,
                 cl.active AS client_active, cl.auth_version AS client_auth_version
          FROM Entidades e
          INNER JOIN Categorias c ON c.id = e.categoriaID
          LEFT JOIN Clientes cl ON cl.id = e.clienteID
          LEFT JOIN EntityAliases a ON a.entity_id = e.id
          WHERE (e.short_code = ? OR e.token = ? OR a.code = ?)
          ${categoryFilter}
          LIMIT 1`,
    args,
  })
  const row = result.rows[0]
  if (!row) return { entity: null, category: null, cliente: null }

  return {
    entity: {
      id: Number(row.id),
      identificacion: String(row.identificacion),
      token: String(row.token),
      shortCode: String(row.short_code || ''),
      categoriaID: Number(row.categoriaID),
      customData: parseCustomData(row.custom_data),
      authVersion: Number(row.auth_version || 1),
    },
    category: {
      id: Number(row.category_id),
      name: String(row.category_name),
      active: Boolean(row.category_active),
      code: String(row.category_code),
    },
    cliente: row.client_id === null || row.client_id === undefined
      ? null
      : {
        id: Number(row.client_id),
        name: String(row.client_name || ''),
        email: String(row.client_email || ''),
        phone: String(row.client_phone || ''),
        active: Boolean(row.client_active),
        authVersion: Number(row.client_auth_version || 1),
      },
  }
}

function emptyAuth() {
  return { authorized: false, canRequestCode: false, emailHint: '' }
}


function asBadRequest(callback) {
  try {
    return callback()
  } catch (error) {
    throw new HttpError(400, error.message)
  }
}
