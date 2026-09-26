export const CATEGORY_CODE_MAX_LENGTH = 20
export const ENTITY_TOKEN_MAX_LENGTH = 40
export const IDENTIFICATION_MAX_LENGTH = 200
export const CUSTOM_DATA_KEY_MAX_LENGTH = 50
export const CUSTOM_DATA_JSON_MAX_LENGTH = 5000

const ROUTE_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g

export function sanitizeText(value) {
  return String(value ?? '').replace(CONTROL_CHARS_PATTERN, '').trim()
}

export function sanitizeCustomDataInput(payload) {
  const key = sanitizeText(payload?.key)
  const value = sanitizeText(payload?.value)

  if (!key || !value) {
    throw new Error('Dato y Valor son obligatorios.')
  }

  assertMaxLength(key, CUSTOM_DATA_KEY_MAX_LENGTH, 'Dato')
  assertMaxLength(value, IDENTIFICATION_MAX_LENGTH, 'Valor')

  return { key, value }
}

export function validateCategoryCode(code) {
  const value = sanitizeText(code)

  if (!value) throw new Error('El código de categoría es obligatorio.')
  assertMaxLength(value, CATEGORY_CODE_MAX_LENGTH, 'Código de categoría')
  assertRouteValue(value, 'Código de categoría')

  return value
}

export function validateEntityToken(token) {
  const value = sanitizeText(token)

  if (!value) throw new Error('El token es obligatorio.')
  assertMaxLength(value, ENTITY_TOKEN_MAX_LENGTH, 'Token')
  assertRouteValue(value, 'Token')

  return value
}

export function assertCustomDataJsonSize(json) {
  assertMaxLength(json, CUSTOM_DATA_JSON_MAX_LENGTH, 'Datos personalizados')
}

function assertMaxLength(value, maxLength, label) {
  if (value.length > maxLength) {
    throw new Error(`${label} no puede superar ${maxLength} caracteres.`)
  }
}

function assertRouteValue(value, label) {
  if (!ROUTE_VALUE_PATTERN.test(value)) {
    throw new Error(`${label} solo puede contener letras, números, guion y guion bajo.`)
  }
}
