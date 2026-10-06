import { normalizeDataType } from './dataTypes'

export const CATEGORY_CODE_MAX_LENGTH = 20
export const ENTITY_TOKEN_MAX_LENGTH = 40
export const DISPLAY_NAME_MAX_LENGTH = 200
export const CUSTOM_DATA_VALUE_MAX_LENGTH = 200
export const CUSTOM_DATA_KEY_MAX_LENGTH = 50
export const CUSTOM_DATA_JSON_MAX_LENGTH = 5000

const ROUTE_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g
const INVISIBLE_CHARS_PATTERN = /[\u200b-\u200d\u2060\ufeff]/g

export function sanitizeText(value) {
  return String(value ?? '')
    .replace(CONTROL_CHARS_PATTERN, '')
    .replace(INVISIBLE_CHARS_PATTERN, '')
    .trim()
}

export function sanitizeCustomDataInput(payload) {
  const key = sanitizeText(payload?.key)
  const value = sanitizeText(payload?.value)
  const dataType = normalizeDataType(payload?.dataType)

  if (!key || !value) {
    throw new Error('Dato y Valor son obligatorios.')
  }

  assertMaxLength(key, CUSTOM_DATA_KEY_MAX_LENGTH, 'Dato')
  assertMaxLength(value, CUSTOM_DATA_VALUE_MAX_LENGTH, 'Valor')
  validateCustomDataValue(value, dataType)

  return { key, value, dataType }
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

function validateCustomDataValue(value, dataType) {
  if (dataType === 'date' && !isValidIsoDate(value)) {
    throw new Error('Selecciona una fecha válida.')
  }
  if (dataType === 'number' && !Number.isFinite(Number(value))) {
    throw new Error('Escribe un número válido.')
  }
  if (dataType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('Escribe un correo electrónico válido.')
  }
  if (dataType === 'tel' && !/^[0-9+() .-]{7,30}$/.test(value)) {
    throw new Error('Escribe un número de teléfono válido.')
  }
  if (dataType === 'url') {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    } catch {
      throw new Error('Escribe un enlace que comience por http:// o https://.')
    }
  }
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}
