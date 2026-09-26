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

export function createCustomDataItem({ key, value }) {
  const sanitizedPayload = sanitizeCustomDataInput({ key, value })

  return normalizeItem({
    id: crypto.randomUUID(),
    key: sanitizedPayload.key,
    value: sanitizedPayload.value,
  })
}

function normalizeItem(item, index = 0) {
  const fallbackKey = `Dato ${index + 1}`
  const sanitized = sanitizeCustomDataInput({
    key: item.key || item.label || fallbackKey,
    value: item.value,
  })

  return {
    id: sanitizeText(item.id || crypto.randomUUID()),
    key: sanitized.key,
    value: sanitized.value,
  }
}
