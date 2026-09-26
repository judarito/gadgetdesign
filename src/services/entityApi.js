import { createCustomDataItem, parseCustomData, serializeCustomData } from './customData'
import { getTursoClient } from './tursoClient'
import {
  sanitizeCustomDataInput,
  validateCategoryCode,
  validateEntityToken,
} from './validation'

export const CUSTOM_DATA_LIMIT = 10

export function getRouteContext(pathname = window.location.pathname) {
  const [categoryCode, token] = pathname.split('/').filter(Boolean)

  return {
    categoryCode,
    token,
    isValid: Boolean(categoryCode && token),
  }
}

export async function fetchEntity(categoryCode, token) {
  return getEntityContext(categoryCode, token)
}

export async function createCustomData(categoryCode, token, payload) {
  const db = getTursoClient()
  const safeCategoryCode = validateCategoryCode(categoryCode)
  const safeToken = validateEntityToken(token)
  const category = await getCategoryByCode(db, safeCategoryCode)
  if (!category) throw new Error('No se encontró la categoría.')

  const item = createCustomDataItem(payload)
  const currentEntity = await getEntityByToken(db, category.id, safeToken)

  if (!currentEntity) {
    await db.execute({
      sql: `INSERT INTO Entidades (Identificacion, token, categoriaID, custom_data)
            VALUES (?, ?, ?, ?)`,
      args: [item.value, safeToken, category.id, serializeCustomData([item])],
    })

    return getEntityContext(safeCategoryCode, safeToken)
  }

  if (currentEntity.customData.length >= CUSTOM_DATA_LIMIT) {
    throw new Error(`Solo puedes guardar hasta ${CUSTOM_DATA_LIMIT} datos personalizados.`)
  }

  const customData = [...currentEntity.customData, item]
  const shouldSetIdentification = currentEntity.customData.length === 0

  await db.execute({
    sql: `UPDATE Entidades
          SET custom_data = ?, Identificacion = CASE WHEN ? THEN ? ELSE Identificacion END
          WHERE id = ?`,
    args: [
      serializeCustomData(customData),
      shouldSetIdentification ? 1 : 0,
      item.value,
      currentEntity.id,
    ],
  })

  return getEntityContext(safeCategoryCode, safeToken)
}

export async function updateCustomData(categoryCode, token, itemId, payload) {
  const db = getTursoClient()
  const safeCategoryCode = validateCategoryCode(categoryCode)
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
        }
      : item,
  )
  const nextIdentification = itemIndex === 0 ? safePayload.value : context.entity.identificacion

  await db.execute({
    sql: 'UPDATE Entidades SET custom_data = ?, Identificacion = ? WHERE id = ?',
    args: [serializeCustomData(nextData), nextIdentification, context.entity.id],
  })

  return getEntityContext(safeCategoryCode, safeToken)
}

export async function deleteCustomData(categoryCode, token, itemId) {
  const db = getTursoClient()
  const safeCategoryCode = validateCategoryCode(categoryCode)
  const safeToken = validateEntityToken(token)
  const context = await getEntityContext(safeCategoryCode, safeToken)

  if (!context.entity) throw new Error('No se encontró la entidad.')

  const nextData = context.entity.customData.filter((item) => item.id !== itemId)
  const nextIdentification = nextData[0]?.value || context.entity.identificacion

  await db.execute({
    sql: 'UPDATE Entidades SET custom_data = ?, Identificacion = ? WHERE id = ?',
    args: [serializeCustomData(nextData), nextIdentification, context.entity.id],
  })

  return getEntityContext(safeCategoryCode, safeToken)
}

async function getEntityContext(categoryCode, token) {
  const db = getTursoClient()
  const safeCategoryCode = validateCategoryCode(categoryCode)
  const safeToken = validateEntityToken(token)
  const category = await getCategoryByCode(db, safeCategoryCode)

  if (!category) {
    throw new Error('No se encontró la categoría.')
  }

  const entity = await getEntityByToken(db, category.id, safeToken)

  return {
    category,
    entity,
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

async function getEntityByToken(db, categoryId, token) {
  const safeToken = validateEntityToken(token)
  const result = await db.execute({
    sql: `SELECT id, Identificacion AS identificacion, token, categoriaID, custom_data
          FROM Entidades
          WHERE categoriaID = ? AND token = ?
          LIMIT 1`,
    args: [categoryId, safeToken],
  })

  const entity = result.rows[0]
  if (!entity) return null

  return {
    id: entity.id,
    identificacion: entity.identificacion,
    token: entity.token,
    categoriaID: entity.categoriaID,
    customData: parseCustomData(entity.custom_data),
  }
}
