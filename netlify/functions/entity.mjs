import { getDb } from './_lib/db.mjs'
import { sendAccessCode } from './_lib/email.mjs'
import {
  HttpError,
  clearCookie,
  handleError,
  json,
  readJson,
  sessionCookie,
} from './_lib/http.mjs'
import {
  ENTITY_COOKIE,
  ENTITY_SESSION_SECONDS,
  OTP_SECONDS,
  decryptValue,
  encryptValue,
  generateOtp,
  getEntitySession,
  hashOtp,
  maskEmail,
  requireEntitySession,
  safeEqualHex,
  signSession,
} from './_lib/security.mjs'
import { createCustomDataItem, parseCustomData, serializeCustomData } from '../../src/services/customData.js'
import {
  sanitizeCustomDataInput,
  validateCategoryCode,
  validateEntityToken,
} from '../../src/services/validation.js'

const CUSTOM_DATA_LIMIT = 10

export default async function handler(request) {
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action') || 'context'

    if (request.method === 'GET' && action === 'context') {
      return json(await getContext(request, routeInput(url.searchParams)))
    }
    if (request.method === 'POST' && action === 'request-code') {
      return await requestCode(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'verify-code') {
      return await verifyCode(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'logout') {
      return json({ ok: true }, 200, { 'set-cookie': clearCookie(ENTITY_COOKIE) })
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
  const { entity, category } = await findEntity(db, route)
  if (!entity || !category) return { category: null, entity: null, suggestions: [], auth: emptyAuth() }

  const session = getEntitySession(request)
  const authorized = forceAuthorized || Boolean(
    session &&
    Number(session.entityId) === Number(entity.id) &&
    Number(session.authVersion) === Number(entity.authVersion),
  )
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
      canRequestCode: Boolean(entity.ownerEmail),
      emailHint: maskEmail(entity.ownerEmail),
    },
  }
}

async function requestCode(request, payload) {
  const db = getDb()
  const { entity } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  if (!entity.ownerEmail) {
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
  await db.execute({
    sql: `INSERT INTO EntityAccessCodes
          (entity_id, code_hash, expires_at, attempts, consumed, request_ip, created_at)
          VALUES (?, ?, ?, 0, 0, ?, ?)`,
    args: [entity.id, hashOtp(entity.id, code), now + OTP_SECONDS, ip, now],
  })
  await sendAccessCode({
    to: entity.ownerEmail,
    code,
    identification: entity.identificacion,
  })

  return json({ ok: true, emailHint: maskEmail(entity.ownerEmail) })
}

async function verifyCode(request, payload) {
  const db = getDb()
  const { entity } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
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

  if (!safeEqualHex(String(accessCode.code_hash), hashOtp(entity.id, code))) {
    await db.execute({
      sql: 'UPDATE EntityAccessCodes SET attempts = attempts + 1 WHERE id = ?',
      args: [accessCode.id],
    })
    throw new HttpError(400, 'El código no es correcto.')
  }

  await db.execute({ sql: 'UPDATE EntityAccessCodes SET consumed = 1 WHERE id = ?', args: [accessCode.id] })
  const token = signSession({
    type: 'entity',
    entityId: Number(entity.id),
    authVersion: Number(entity.authVersion),
  }, ENTITY_SESSION_SECONDS)

  return json(
    await getContext(request, payload, true),
    200,
    { 'set-cookie': sessionCookie(ENTITY_COOKIE, token, ENTITY_SESSION_SECONDS) },
  )
}

async function mutateData(request, payload, operation) {
  const db = getDb()
  const { entity } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  requireEntitySession(request, entity)

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
    customData = customData.filter((item) => item.id !== itemId)
  }

  const serialized = asBadRequest(() => serializeCustomData(customData))
  await db.execute({
    sql: 'UPDATE Entidades SET custom_data = ? WHERE id = ?',
    args: [serialized, entity.id],
  })
  return json(await getContext(request, payload))
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
                 e.short_code, e.categoriaID, e.custom_data, e.owner_name,
                 e.owner_email, e.owner_phone, e.auth_version,
                 c.id AS category_id, c.name AS category_name,
                 c.active AS category_active, c.code AS category_code
          FROM Entidades e
          INNER JOIN Categorias c ON c.id = e.categoriaID
          LEFT JOIN EntityAliases a ON a.entity_id = e.id
          WHERE (e.short_code = ? OR e.token = ? OR a.code = ?)
          ${categoryFilter}
          LIMIT 1`,
    args,
  })
  const row = result.rows[0]
  if (!row) return { entity: null, category: null }

  return {
    entity: {
      id: Number(row.id),
      identificacion: String(row.identificacion),
      token: String(row.token),
      shortCode: String(row.short_code || ''),
      categoriaID: Number(row.categoriaID),
      customData: parseCustomData(row.custom_data),
      ownerName: String(row.owner_name || ''),
      ownerEmail: String(row.owner_email || ''),
      ownerPhone: String(row.owner_phone || ''),
      authVersion: Number(row.auth_version || 1),
    },
    category: {
      id: Number(row.category_id),
      name: String(row.category_name),
      active: Boolean(row.category_active),
      code: String(row.category_code),
    },
  }
}

function emptyAuth() {
  return { authorized: false, canRequestCode: false, emailHint: '' }
}

function getClientIp(request) {
  return String(
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for') ||
    'local',
  ).split(',')[0].trim().slice(0, 64)
}

function asBadRequest(callback) {
  try {
    return callback()
  } catch (error) {
    throw new HttpError(400, error.message)
  }
}
