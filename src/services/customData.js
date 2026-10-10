import { normalizeDataType } from './dataTypes'
import {
  assertCustomDataJsonSize,
  sanitizeCustomDataInput,
  sanitizeText,
} from './validation'

/** Número máximo de datos personalizados por ficha. */
export const CUSTOM_DATA_LIMIT = 10

export function parseCustomData(rawValue) {
  if (!rawValue) return []

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue

    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item === 'object')
        .flatMap((item, index) => safelyNormalizeItem(item, index))
    }

    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).flatMap(([key, value], index) =>
        safelyNormalizeItem({ id: key, key, value }, index),
      )
    }
  } catch {
    return []
  }

  return []
}

function safelyNormalizeItem(item, index) {
  try {
    return [normalizeItem(item, index)]
  } catch {
    // Un dato corrupto no debe ocultar los demás datos válidos de la ficha.
    return []
  }
}

export function serializeCustomData(items) {
  const serialized = JSON.stringify(items.map((item, index) => normalizeItem(item, index)))
  assertCustomDataJsonSize(serialized)

  return serialized
}

export function createCustomDataItem({ key, value, dataType, suggestionId }) {
  const sanitizedPayload = sanitizeCustomDataInput({ key, value, dataType })

  return normalizeItem({
    id: crypto.randomUUID(),
    key: sanitizedPayload.key,
    value: sanitizedPayload.value,
    dataType: sanitizedPayload.dataType,
    suggestionId: normalizeSuggestionId(suggestionId),
  })
}

function normalizeItem(item, index = 0) {
  const fallbackKey = `Dato ${index + 1}`
  const isProtected = Boolean(item.protected)
  const encryptedValue = isProtected ? sanitizeText(item.encryptedValue) : ''

  const base = {
    id: sanitizeText(item.id || crypto.randomUUID()),
    key: sanitizeText(item.key || item.label || fallbackKey) || fallbackKey,
    dataType: normalizeDataType(item.dataType),
    suggestionId: normalizeSuggestionId(item.suggestionId),
    protected: isProtected,
  }

  // Un dato protegido ya guardado no tiene valor en claro: solo queda el texto
  // cifrado. Antes se usaba el marcador `'protected'` como sustituto y se pasaba
  // por la validación de tipo, que lo rechazaba en cuanto el tipo no era texto:
  // una fecha protegida fallaba con "Selecciona una fecha válida". Cuando hay
  // cifrado no hay valor que validar.
  if (encryptedValue) return { ...base, encryptedValue }

  const sanitized = sanitizeCustomDataInput({
    key: base.key,
    value: item.value || '',
    dataType: item.dataType,
  })

  return { ...base, key: sanitized.key, dataType: sanitized.dataType, value: sanitized.value }
}

function normalizeSuggestionId(value) {
  if (value === null || value === undefined || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
