import { apiRequest } from './apiClient'
import { isReservedPath } from './routes'

export { CUSTOM_DATA_LIMIT } from './customData'

const INVALID_ROUTE = { categoryCode: null, token: null, isShortRoute: false, isValid: false }

export function getRouteContext(pathname = window.location.pathname) {
  const segments = pathname.split('/').filter(Boolean)

  // Más de dos segmentos no es una ruta de ficha, y los nombres reservados
  // (/admin, /portal y lo que venga) nunca se resuelven como fichas.
  if (segments.length > 2) return INVALID_ROUTE
  if (segments.some((segment) => isReservedPath(segment))) return INVALID_ROUTE

  const isShortRoute = segments.length === 1
  const [categoryCode, token] = isShortRoute
    ? [null, segments[0]]
    : [segments[0], segments[1]]

  return {
    categoryCode,
    token,
    isShortRoute,
    isValid: Boolean(token && (isShortRoute || categoryCode)),
  }
}

export function fetchEntity(categoryCode, token) {
  return apiRequest('entity', { action: 'context', query: { categoryCode, token } })
}

export function requestEntityAccessCode(categoryCode, token) {
  return apiRequest('entity', {
    action: 'request-code', method: 'POST', body: { categoryCode, token },
  })
}

export function verifyEntityAccessCode(categoryCode, token, code) {
  return apiRequest('entity', {
    action: 'verify-code', method: 'POST', body: { categoryCode, token, code },
  })
}

export function logoutEntityAccess() {
  return apiRequest('entity', { action: 'logout', method: 'POST', body: {} })
}

export function createCustomData(categoryCode, token, data) {
  return apiRequest('entity', {
    action: 'create-data', method: 'POST', body: { categoryCode, token, data },
  })
}

export function updateCustomData(categoryCode, token, itemId, data) {
  return apiRequest('entity', {
    action: 'update-data', method: 'PATCH', body: { categoryCode, token, itemId, data },
  })
}

export function deleteCustomData(categoryCode, token, itemId) {
  return apiRequest('entity', {
    action: 'delete-data', method: 'DELETE', body: { categoryCode, token, itemId },
  })
}

export function fetchEntityEvents(categoryCode, token) {
  return apiRequest('entity', { action: 'events', query: { categoryCode, token } })
}

export function createEntityEvent(categoryCode, token, event) {
  return apiRequest('entity', {
    action: 'create-event', method: 'POST', body: { categoryCode, token, ...event },
  })
}

export function updateEntityEvent(categoryCode, token, eventId, event) {
  return apiRequest('entity', {
    action: 'update-event', method: 'PATCH', body: { categoryCode, token, eventId, ...event },
  })
}

export function archiveEntityEvent(categoryCode, token, eventId) {
  return apiRequest('entity', {
    action: 'archive-event', method: 'PATCH', body: { categoryCode, token, eventId },
  })
}

export function requestEventImageSignature(categoryCode, token, eventId) {
  return apiRequest('entity', {
    action: 'event-image-signature', method: 'POST', body: { categoryCode, token, eventId },
  })
}

export function attachEventImage(categoryCode, token, eventId, image, protectedValue = false) {
  return apiRequest('entity', {
    action: 'attach-event-image',
    method: 'POST',
    body: { categoryCode, token, eventId, image, protected: protectedValue },
  })
}

export function deleteEventImage(categoryCode, token, eventId) {
  return apiRequest('entity', {
    action: 'delete-event-image', method: 'DELETE', body: { categoryCode, token, eventId },
  })
}

export function deleteEntityProfile(categoryCode, token, confirmation) {
  return apiRequest('entity', {
    action: 'delete-entity', method: 'DELETE', body: { categoryCode, token, confirmation },
  })
}
