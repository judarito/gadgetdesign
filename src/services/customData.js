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
  const sanitized = sanitizeCustomDataInput({
    key: item.key || item.label || fallbackKey,
    value: item.value,
    dataType: item.dataType,
  })

  return {
    id: sanitizeText(item.id || crypto.randomUUID()),
    key: sanitized.key,
    value: sanitized.value,
    dataType: sanitized.dataType,
    suggestionId: normalizeSuggestionId(item.suggestionId),
  }
}

function normalizeSuggestionId(value) {
  if (value === null || value === undefined || value === '') return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
