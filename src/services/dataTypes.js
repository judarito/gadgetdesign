export const CUSTOM_DATA_TYPES = [
  { value: 'text', label: 'Texto', inputType: 'text', placeholder: 'Escribe el valor' },
  { value: 'date', label: 'Fecha', inputType: 'date', placeholder: '' },
  { value: 'number', label: 'Número', inputType: 'number', placeholder: 'Ej. 25' },
  { value: 'email', label: 'Correo electrónico', inputType: 'email', placeholder: 'nombre@correo.com' },
  { value: 'tel', label: 'Teléfono', inputType: 'tel', placeholder: 'Ej. 300 123 4567' },
  { value: 'url', label: 'Enlace web', inputType: 'url', placeholder: 'https://ejemplo.com' },
]

const TYPE_BY_VALUE = new Map(CUSTOM_DATA_TYPES.map((type) => [type.value, type]))

export function normalizeDataType(value) {
  return TYPE_BY_VALUE.has(value) ? value : 'text'
}

export function getDataType(value) {
  return TYPE_BY_VALUE.get(normalizeDataType(value))
}

export function formatCustomDataValue(value, dataType) {
  if (normalizeDataType(dataType) !== 'date' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(date)
}
