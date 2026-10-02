import { apiRequest } from './apiClient'

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

export function deleteEntityProfile(categoryCode, token, confirmation) {
  return apiRequest('entity', {
    action: 'delete-entity', method: 'DELETE', body: { categoryCode, token, confirmation },
  })
}
