import { apiRequest } from './apiClient'

export function getPortalContext({ search = '', page = 1, pageSize = 50 } = {}) {
  return apiRequest('client', { action: 'context', query: { search, page, pageSize } })
}

export function requestClientAccessCode(email) {
  return apiRequest('client', { action: 'request-code', method: 'POST', body: { email } })
}

export function verifyClientAccessCode(email, code) {
  return apiRequest('client', { action: 'verify-code', method: 'POST', body: { email, code } })
}

export function deactivateClientEntity(token) {
  return apiRequest('client', { action: 'deactivate-entity', method: 'POST', body: { token } })
}

export function createClientEntity(displayName, categoryId) {
  return apiRequest('client', {
    action: 'create-entity',
    method: 'POST',
    body: { displayName, categoryId },
  })
}

export function logoutClientAccess() {
  return apiRequest('client', { action: 'logout', method: 'POST', body: {} })
}
