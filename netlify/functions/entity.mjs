import { getDb } from './_lib/db.mjs'
import { sendAccessCode } from './_lib/email.mjs'
import { createUploadSignature, destroyImage, validateImageMetadata } from './_lib/cloudinary.mjs'
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
  sanitizeText,
  validateCategoryCode,
  validateEntityToken,
} from '../../src/services/validation.js'
import { normalizeDataType } from '../../src/services/dataTypes.js'

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
    if (request.method === 'GET' && action === 'events') {
      return await listEvents(request, routeInput(url.searchParams))
    }
    if (request.method === 'POST' && action === 'request-code') {
      return await requestCode(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'verify-code') {
      return await verifyCode(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'logout') {
      return json({ ok: true }, 200, {
        'set-cookie': [clearCookie(ENTITY_COOKIE, request), clearCookie(CLIENT_COOKIE, request)],
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
    if (request.method === 'POST' && action === 'create-event') {
      return await mutateEvent(request, await readJson(request), 'create')
    }
    if (request.method === 'PATCH' && action === 'update-event') {
      return await mutateEvent(request, await readJson(request), 'update')
    }
    if (request.method === 'PATCH' && action === 'archive-event') {
      return await mutateEvent(request, await readJson(request), 'archive')
    }
    if (request.method === 'POST' && action === 'event-image-signature') {
      return await eventImageSignature(request, await readJson(request))
    }
    if (request.method === 'POST' && action === 'attach-event-image') {
      return await attachEventImage(request, await readJson(request))
    }
    if (request.method === 'DELETE' && action === 'delete-event-image') {
      return await deleteEventImage(request, await readJson(request))
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

  // Una ficha que no está activa no sirve datos a quien no la administra: ni los
  // públicos, ni siquiera enmascarados. Se responde con un estado propio para que
  // la página pueda decir «no disponible» en vez de fingir que la ruta no existe:
  // el QR va pegado a un objeto físico, y quien lo escanee merece saber qué pasa.
  // El dueño desde el portal sí la ve, y esa rama la resuelve `scope`.
  const publiclyAvailable = entity.status === 'activa'
    && category.active
    && (cliente === null || cliente.active)
  if (!publiclyAvailable && !scope) {
    return { category: null, entity: null, unavailable: true, suggestions: [], auth: emptyAuth() }
  }

  const authorized = Boolean(scope)
  const suggestionsResult = await db.execute({
    sql: `SELECT id, name, data_type
          FROM CategoriaSugerencias
          WHERE categoriaID = ? AND active = 1
          ORDER BY sort_order, id
          LIMIT ?`,
    args: [category.id, CUSTOM_DATA_LIMIT],
  })
  const eventTypesResult = await db.execute({
    sql: `SELECT id, name, fields_json
          FROM EntityEventTypes
          WHERE categoriaID = ? AND active = 1
          ORDER BY sort_order, id`,
    args: [category.id],
  })

  return {
    category,
    entity: {
      id: entity.id,
      displayName: entity.displayName,
      shortCode: entity.shortCode,
      status: entity.status,
      customData: exposeCustomData(entity.customData, authorized),
    },
    suggestions: suggestionsResult.rows.map((row) => ({
      id: Number(row.id),
      key: String(row.name),
      dataType: String(row.data_type || 'text'),
    })),
    eventTypes: eventTypesResult.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      fields: parseEventFields(row.fields_json),
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

function parseEventFields(value) {
  try {
    const fields = JSON.parse(String(value || '[]'))
    return Array.isArray(fields) ? fields : []
  } catch {
    return []
  }
}

async function requestCode(request, payload) {
  const db = getDb()
  const { entity, category, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  // Desactivada no hay nada que revelar, así que no se entrega código: quien
  // tenga el QR impreso espera a que el administrador la reactive.
  if (entity.status !== 'activa' || !category?.active) {
    throw new HttpError(409, 'Esta ficha no está disponible.')
  }
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
      identification: entity.displayName,
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
  const { entity, category, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  // Desactivada no hay nada que revelar, así que no se entrega código: quien
  // tenga el QR impreso espera a que el administrador la reactive.
  if (entity.status !== 'activa' || !category?.active) throw new HttpError(409, 'Esta ficha no está disponible.')
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
    { 'set-cookie': sessionCookie(ENTITY_COOKIE, token, ENTITY_SESSION_SECONDS, request) },
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

async function listEvents(request, route) {
  const db = getDb()
  const { entity, category, cliente } = await findEntity(db, route)
  if (!entity || !category) return json({ events: [], auth: emptyAuth() })

  const scope = entityAccessScope(request, entity, cliente)
  const result = await db.execute({
    sql: `SELECT e.id, e.title, e.occurred_at, e.description, e.created_at,
                 t.id AS event_type_id, t.name AS event_type_name,
                 v.field_name, v.data_type, v.value, v.protected,
                 i.secure_url AS image_url, i.format AS image_format, i.protected AS image_protected
          FROM EntityEvents e
          LEFT JOIN EntityEventTypes t ON t.id = e.event_type_id
          LEFT JOIN EntityEventValues v ON v.event_id = e.id
          LEFT JOIN EntityEventImages i ON i.event_id = e.id
          WHERE e.entity_id = ? AND e.archived_at IS NULL
          ORDER BY COALESCE(e.occurred_at, e.created_at) DESC, e.id DESC`,
    args: [entity.id],
  })

  const events = groupEvents(result.rows, Boolean(scope))
  return json({ events, auth: { ...emptyAuth(), authorized: Boolean(scope), scope } },
    200,
    scope ? privateEntityCacheHeaders() : publicEntityCacheHeaders(entity.id, category.id))
}

async function mutateEvent(request, payload, operation) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  requireEntityAccess(request, entity, cliente)

  if (operation === 'archive') {
    const eventId = positiveId(payload.eventId, 'evento')
    const archived = await db.execute({
      sql: 'UPDATE EntityEvents SET archived_at = ?, updated_at = ? WHERE id = ? AND entity_id = ? AND archived_at IS NULL',
      args: [new Date().toISOString(), new Date().toISOString(), eventId, entity.id],
    })
    if (!Number(archived.rowsAffected)) throw new HttpError(404, 'No se encontró el evento.')
    await purgeEntityCache(entity.id)
    return json({ ok: true })
  }

  const event = validateEventPayload(payload)
  const eventType = await db.execute({
    sql: `SELECT id, fields_json FROM EntityEventTypes
          WHERE id = ? AND categoriaID = ? AND active = 1`,
    args: [event.eventTypeId, entity.categoriaID],
  })
  if (!eventType.rows.length) throw new HttpError(400, 'El tipo de evento no pertenece a esta categoría.')
  const configuredFields = parseEventFields(eventType.rows[0].fields_json)
  if (configuredFields.length) {
    const allowedFields = new Map(configuredFields.map((field) => [String(field.name).trim().toLocaleLowerCase('es'), field]))
    for (const value of event.values) {
      const configured = allowedFields.get(value.fieldName.toLocaleLowerCase('es'))
      if (!configured) throw new HttpError(400, `El campo ${value.fieldName} no está configurado para este evento.`)
      value.dataType = String(configured.dataType || value.dataType)
      const shouldProtect = Boolean(configured.protected)
      if (shouldProtect && !value.protected) value.value = encryptValue(value.value)
      if (!shouldProtect && value.protected) value.value = decryptValue(value.value)
      value.protected = shouldProtect
    }
  }
  const now = new Date().toISOString()
  let eventId
  if (operation === 'create') {
    const inserted = await db.execute({
      sql: `INSERT INTO EntityEvents
            (entity_id, event_type_id, title, occurred_at, description, created_by_type, created_by_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'entity', ?, ?, ?)`,
      args: [entity.id, event.eventTypeId, event.title, event.occurredAt, event.description, cliente?.id || null, now, now],
    })
    eventId = Number(inserted.lastInsertRowid)
  } else {
    eventId = positiveId(payload.eventId, 'evento')
    const updated = await db.execute({
      sql: `UPDATE EntityEvents
            SET event_type_id = ?, title = ?, occurred_at = ?, description = ?, updated_at = ?
            WHERE id = ? AND entity_id = ? AND archived_at IS NULL`,
      args: [event.eventTypeId, event.title, event.occurredAt, event.description, now, eventId, entity.id],
    })
    if (!Number(updated.rowsAffected)) throw new HttpError(404, 'No se encontró el evento.')
    await db.execute({ sql: 'DELETE FROM EntityEventValues WHERE event_id = ?', args: [eventId] })
  }

  if (event.values.length) {
    await db.batch(event.values.map((value) => ({
      sql: `INSERT INTO EntityEventValues
            (event_id, field_name, data_type, value, protected, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [eventId, value.fieldName, value.dataType, value.value, value.protected ? 1 : 0, now, now],
    })), 'write')
  }
  await purgeEntityCache(entity.id)
  return json({ ok: true, eventId })
}

async function eventImageSignature(request, payload) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  requireEntityAccess(request, entity, cliente)
  const eventId = positiveId(payload.eventId, 'evento')
  const event = await db.execute({
    sql: 'SELECT id FROM EntityEvents WHERE id = ? AND entity_id = ? AND archived_at IS NULL',
    args: [eventId, entity.id],
  })
  if (!event.rows.length) throw new HttpError(404, 'No se encontró el evento.')
  const timestamp = Math.floor(Date.now() / 1000)
  return json(createUploadSignature({
    folder: `gadgetdesign/events/${entity.id}/${eventId}`,
    publicId: 'imagen',
    timestamp,
  }))
}

async function attachEventImage(request, payload) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  requireEntityAccess(request, entity, cliente)
  const eventId = positiveId(payload.eventId, 'evento')
  const image = asBadRequest(() => validateImageMetadata(payload.image))
  const exists = await db.execute({
    sql: 'SELECT id FROM EntityEvents WHERE id = ? AND entity_id = ? AND archived_at IS NULL',
    args: [eventId, entity.id],
  })
  if (!exists.rows.length) throw new HttpError(404, 'No se encontró el evento.')
  const previous = await db.execute({
    sql: 'SELECT public_id FROM EntityEventImages WHERE event_id = ?',
    args: [eventId],
  })
  await db.execute({
    sql: `INSERT INTO EntityEventImages
          (event_id, public_id, secure_url, format, bytes, width, height, protected)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET
            public_id = excluded.public_id, secure_url = excluded.secure_url,
            format = excluded.format, bytes = excluded.bytes,
            width = excluded.width, height = excluded.height,
            protected = excluded.protected`,
    args: [eventId, image.publicId, image.secureUrl, image.format, image.bytes, image.width, image.height, payload.protected ? 1 : 0],
  })
  const previousPublicId = previous.rows[0]?.public_id
  if (previousPublicId && String(previousPublicId) !== image.publicId) {
    try {
      await destroyImage(String(previousPublicId))
    } catch (error) {
      // La nueva imagen y el registro siguen siendo válidos; el recurso viejo
      // puede limpiarse con una tarea posterior sin romper la operación del usuario.
      console.error('Cloudinary cleanup failed', { name: error?.name || 'Error' })
    }
  }
  await purgeEntityCache(entity.id)
  return json({ ok: true, image })
}

async function deleteEventImage(request, payload) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  requireEntityAccess(request, entity, cliente)
  const eventId = positiveId(payload.eventId, 'evento')
  const image = await db.execute({
    sql: `SELECT i.public_id FROM EntityEventImages i
          INNER JOIN EntityEvents e ON e.id = i.event_id
          WHERE i.event_id = ? AND e.entity_id = ?`,
    args: [eventId, entity.id],
  })
  if (!image.rows.length) throw new HttpError(404, 'El evento no tiene imagen.')
  await destroyImage(String(image.rows[0].public_id))
  await db.execute({ sql: 'DELETE FROM EntityEventImages WHERE event_id = ?', args: [eventId] })
  await purgeEntityCache(entity.id)
  return json({ ok: true })
}

function validateEventPayload(payload) {
  const title = sanitizeText(payload.title)
  if (!title || title.length > 120) throw new HttpError(400, 'El título del evento es obligatorio y no puede superar 120 caracteres.')
  const description = sanitizeText(payload.description)
  if (description.length > 1000) throw new HttpError(400, 'La descripción no puede superar 1000 caracteres.')
  const occurredAt = payload.occurredAt ? String(payload.occurredAt).trim() : null
  if (occurredAt && !/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) throw new HttpError(400, 'La fecha del evento no es válida.')
  const eventTypeId = positiveId(payload.eventTypeId, 'tipo de evento')
  const values = Array.isArray(payload.values) ? payload.values.map(validateEventValue) : []
  if (values.length > 20) throw new HttpError(400, 'Un evento no puede tener más de 20 valores.')
  return { title, description, occurredAt, eventTypeId, values }
}

function validateEventValue(value) {
  const fieldName = String(value?.fieldName || '').trim()
  const fieldValue = String(value?.value || '').trim()
  const dataType = normalizeDataType(value?.dataType)
  if (!fieldName || fieldName.length > 80 || !fieldValue || fieldValue.length > 500) {
    throw new HttpError(400, 'Cada valor del evento necesita nombre y contenido válidos.')
  }
  if (dataType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(fieldValue)) throw new HttpError(400, `El campo ${fieldName} necesita una fecha válida.`)
  if (dataType === 'number' && !Number.isFinite(Number(fieldValue))) throw new HttpError(400, `El campo ${fieldName} necesita un número válido.`)
  return { fieldName, value: value.protected ? encryptValue(fieldValue) : fieldValue, dataType, protected: Boolean(value.protected) }
}

function groupEvents(rows, authorized) {
  const events = new Map()
  for (const row of rows) {
    const id = Number(row.id)
    if (!events.has(id)) events.set(id, {
      id,
      title: String(row.title),
      occurredAt: row.occurred_at ? String(row.occurred_at) : null,
      description: String(row.description || ''),
      eventType: row.event_type_id ? { id: Number(row.event_type_id), name: String(row.event_type_name || '') } : null,
      values: [],
      image: row.image_url && (!row.image_protected || authorized)
        ? { url: String(row.image_url), format: String(row.image_format || ''), protected: Boolean(row.image_protected) }
        : null,
    })
    if (row.field_name) {
      const protectedValue = Boolean(row.protected)
      events.get(id).values.push({
        fieldName: String(row.field_name),
        dataType: String(row.data_type || 'text'),
        value: protectedValue && !authorized ? '' : protectedValue ? decryptValue(row.value) : String(row.value || ''),
        protected: protectedValue,
        masked: protectedValue && !authorized,
      })
    }
  }
  return [...events.values()]
}

function positiveId(value, label) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `El ${label} no es válido.`)
  return id
}

async function deleteCurrentEntity(request, payload) {
  const db = getDb()
  const { entity, cliente } = await findEntity(db, payload)
  if (!entity) throw new HttpError(404, 'No se encontró la entidad.')
  requireEntitySession(request, entity, cliente)

  const confirmation = String(payload.confirmation || '').trim()
  if (confirmation !== entity.displayName.trim()) {
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
    { 'set-cookie': [clearCookie(ENTITY_COOKIE, request), clearCookie(CLIENT_COOKIE, request)] },
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
    sql: `SELECT DISTINCT e.id, e.Identificacion AS display_name, e.token,
                 e.short_code, e.categoriaID, e.custom_data,
                 e.auth_version, e.clienteID, e.status,
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
      displayName: String(row.display_name),
      token: String(row.token),
      shortCode: String(row.short_code || ''),
      categoriaID: Number(row.categoriaID),
      customData: parseCustomData(row.custom_data),
      authVersion: Number(row.auth_version || 1),
      status: String(row.status || 'activa'),
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
