import { createCustomDataItem, parseCustomData, serializeCustomData } from './customData'
import { getTursoClient } from './tursoClient'
import { generateUniqueShortCode, isUuid } from './shortCode'
import {
  sanitizeCustomDataInput,
  validateCategoryCode,
  validateEntityToken,
} from './validation'

export const CUSTOM_DATA_LIMIT = 10

export function getRouteContext(pathname = window.location.pathname) {
  const segments = pathname.split('/').filter(Boolean)
  const isShortRoute = segments.length === 1
  const [categoryCode, token] = isShortRoute
    ? [null, segments[0]]
    : [segments[0], segments[1]]

  return {
    categoryCode,
    token,
    isShortRoute,
    isValid: Boolean(token && (isShortRoute || categoryCode) && segments.length <= 2),
  }
}

export async function fetchEntity(categoryCode, token) {
  return getEntityContext(categoryCode, token)
}

export async function createCustomData(categoryCode, token, payload) {
  const db = getTursoClient()
  const safeToken = validateEntityToken(token)
  const safeCategoryCode = categoryCode ? validateCategoryCode(categoryCode) : null
  let category
  let currentEntity

  if (safeCategoryCode) {
    category = await getCategoryByCode(db, safeCategoryCode)
    currentEntity = category
      ? await getEntityByToken(db, category.id, safeToken)
      : null
  } else {
    currentEntity = await getEntityByShortCode(db, safeToken)
    category = currentEntity
      ? await getCategoryById(db, currentEntity.categoriaID)
      : null
  }

  if (!category) throw new Error('No se encontró la categoría.')

  const item = createCustomDataItem(payload)

  if (!currentEntity) {
    if (!safeCategoryCode) throw new Error('No se encontró la entidad.')

    const internalToken = isUuid(safeToken) ? safeToken : crypto.randomUUID()
    const shortCode = isUuid(safeToken)
      ? await generateUniqueShortCode(db)
      : safeToken
    await db.execute({
      sql: `INSERT INTO Entidades (Identificacion, token, short_code, categoriaID, custom_data)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        item.value,
        internalToken,
        shortCode,
        category.id,
        serializeCustomData([item]),
      ],
    })

    return getEntityContext(safeCategoryCode, safeToken)
  }

  if (currentEntity.customData.length >= CUSTOM_DATA_LIMIT) {
    throw new Error(`Solo puedes guardar hasta ${CUSTOM_DATA_LIMIT} datos personalizados.`)
  }

  const customData = [...currentEntity.customData, item]

  await db.execute({
    sql: 'UPDATE Entidades SET custom_data = ? WHERE id = ?',
    args: [serializeCustomData(customData), currentEntity.id],
  })

  return getEntityContext(safeCategoryCode, safeToken)
}

export async function updateCustomData(categoryCode, token, itemId, payload) {
  const db = getTursoClient()
  const safeCategoryCode = categoryCode ? validateCategoryCode(categoryCode) : null
  const safeToken = validateEntityToken(token)
  const safePayload = sanitizeCustomDataInput(payload)
  const context = await getEntityContext(safeCategoryCode, safeToken)

  if (!context.entity) throw new Error('No se encontró la entidad.')

  const itemIndex = context.entity.customData.findIndex((item) => item.id === itemId)
  if (itemIndex === -1) throw new Error('No se encontró el dato personalizado.')

  const nextData = context.entity.customData.map((item, index) =>
    index === itemIndex
      ? {
          ...item,
          key: safePayload.key,
          value: safePayload.value,
          dataType: safePayload.dataType,
        }
      : item,
  )
  await db.execute({
    sql: 'UPDATE Entidades SET custom_data = ? WHERE id = ?',
    args: [serializeCustomData(nextData), context.entity.id],
  })

  return getEntityContext(safeCategoryCode, safeToken)
}

export async function deleteCustomData(categoryCode, token, itemId) {
  const db = getTursoClient()
  const safeCategoryCode = categoryCode ? validateCategoryCode(categoryCode) : null
  const safeToken = validateEntityToken(token)
  const context = await getEntityContext(safeCategoryCode, safeToken)

  if (!context.entity) throw new Error('No se encontró la entidad.')

  const nextData = context.entity.customData.filter((item) => item.id !== itemId)

  await db.execute({
    sql: 'UPDATE Entidades SET custom_data = ? WHERE id = ?',
    args: [serializeCustomData(nextData), context.entity.id],
  })

  return getEntityContext(safeCategoryCode, safeToken)
}

async function getEntityContext(categoryCode, token) {
  const db = getTursoClient()
  const safeToken = validateEntityToken(token)
  const safeCategoryCode = categoryCode ? validateCategoryCode(categoryCode) : null
  let category
  let entity

  if (safeCategoryCode) {
    category = await getCategoryByCode(db, safeCategoryCode)
    entity = category
      ? await getEntityByToken(db, category.id, safeToken)
      : null
  } else {
    entity = await getEntityByShortCode(db, safeToken)
    category = entity
      ? await getCategoryById(db, entity.categoriaID)
      : null
  }

  if (!category) {
    return { category: null, entity: null, suggestions: [] }
  }

  const suggestions = await getSuggestionsByCategory(db, category.id)

  return {
    category,
    entity,
    suggestions,
  }
}

async function getCategoryByCode(db, code) {
  const safeCode = validateCategoryCode(code)
  const result = await db.execute({
    sql: 'SELECT id, name, active, code FROM Categorias WHERE code = ? LIMIT 1',
    args: [safeCode],
  })

  return result.rows[0] ?? null
}

async function getCategoryById(db, categoryId) {
  const result = await db.execute({
    sql: 'SELECT id, name, active, code FROM Categorias WHERE id = ? LIMIT 1',
    args: [categoryId],
  })

  return result.rows[0] ?? null
}

async function getEntityByToken(db, categoryId, token) {
  const safeToken = validateEntityToken(token)
  const result = await db.execute({
    sql: `SELECT DISTINCT e.id, e.Identificacion AS identificacion, e.token,
                 e.short_code, e.categoriaID, e.custom_data
          FROM Entidades e
          LEFT JOIN EntityAliases a ON a.entity_id = e.id
          WHERE e.categoriaID = ? AND (e.short_code = ? OR e.token = ? OR a.code = ?)
          LIMIT 1`,
    args: [categoryId, safeToken, safeToken, safeToken],
  })

  return mapEntity(result.rows[0])
}

async function getEntityByShortCode(db, shortCode) {
  const safeShortCode = validateEntityToken(shortCode)
  const result = await db.execute({
    sql: `SELECT DISTINCT e.id, e.Identificacion AS identificacion, e.token,
                 e.short_code, e.categoriaID, e.custom_data
          FROM Entidades e
          LEFT JOIN EntityAliases a ON a.entity_id = e.id
          WHERE e.short_code = ? OR a.code = ?
          LIMIT 1`,
    args: [safeShortCode, safeShortCode],
  })

  return mapEntity(result.rows[0])
}

function mapEntity(entity) {
  if (!entity) return null

  return {
    id: entity.id,
    identificacion: entity.identificacion,
    token: entity.token,
    shortCode: entity.short_code,
    categoriaID: entity.categoriaID,
    customData: parseCustomData(entity.custom_data),
  }
}

async function getSuggestionsByCategory(db, categoryId) {
  const result = await db.execute({
    sql: `SELECT id, name, data_type
          FROM CategoriaSugerencias
          WHERE categoriaID = ? AND active = 1
          ORDER BY sort_order, id
          LIMIT ?`,
    args: [categoryId, CUSTOM_DATA_LIMIT],
  })

  return result.rows.map((row) => ({
    id: row.id,
    key: row.name,
    dataType: row.data_type,
  }))
}
