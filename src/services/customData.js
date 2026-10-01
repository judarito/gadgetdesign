import {
  assertCustomDataJsonSize,
  sanitizeCustomDataInput,
  sanitizeText,
} from './validation'

export function parseCustomData(rawValue) {
  if (!rawValue) return []

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue

    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => normalizeItem(item, index))
    }

    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([key, value], index) =>
        normalizeItem({ id: key, key, value }, index),
      )
    }
  } catch {
    return []
  }

  return []
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
  const sanitized = sanitizeCustomDataInput({
    key: item.key || item.label || fallbackKey,
    value: item.value || (isProtected && item.encryptedValue ? 'protected' : ''),
    dataType: item.dataType,
  })

  const normalized = {
    id: sanitizeText(item.id || crypto.randomUUID()),
    key: sanitized.key,
    dataType: sanitized.dataType,
    suggestionId: normalizeSuggestionId(item.suggestionId),
    protected: isProtected,
  }

  if (isProtected && item.encryptedValue) {
    normalized.encryptedValue = sanitizeText(item.encryptedValue)
  } else {
    normalized.value = sanitized.value
  }

  return normalized
}

function normalizeSuggestionId(value) {
  if (value === null || value === undefined || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
