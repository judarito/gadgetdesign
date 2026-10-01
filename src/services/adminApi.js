import { apiRequest } from './apiClient'

export async function hasAdminSession() {
  const result = await apiRequest('admin', { action: 'session' })
  return result.authenticated
}

export async function verifyAdminPassword(password) {
  const result = await apiRequest('admin', {
    action: 'login', method: 'POST', body: { password },
  })
  return result.authenticated
}

export function createAdminSession() {}

export function clearAdminSession() {
  return apiRequest('admin', { action: 'logout', method: 'POST', body: {} })
}

export function changeAdminPassword(currentPassword, newPassword) {
  return apiRequest('admin', {
    action: 'change-password', method: 'POST', body: { currentPassword, newPassword },
  })
}

export function listCategoryOptions() {
  return apiRequest('admin', { action: 'category-options' })
}

export function listCategories({ page = 1, pageSize = 10 } = {}) {
  return apiRequest('admin', { action: 'categories', query: { page, pageSize } })
}

export function saveCategory(category) {
  return apiRequest('admin', { action: 'save-category', method: 'POST', body: category })
}

export function deleteCategory(id) {
  return apiRequest('admin', { action: 'delete-category', method: 'DELETE', body: { id } })
}

export function listSuggestions(categoryId, { page = 1, pageSize = 10 } = {}) {
  return apiRequest('admin', { action: 'suggestions', query: { categoryId, page, pageSize } })
}

export function saveSuggestion(suggestion) {
  return apiRequest('admin', { action: 'save-suggestion', method: 'POST', body: suggestion })
}

export function deleteSuggestion(id, categoryId) {
  return apiRequest('admin', { action: 'delete-suggestion', method: 'DELETE', body: { id, categoryId } })
}

export function listEntities({ categoryId = null, search = '', page = 1, pageSize = 10 } = {}) {
  return apiRequest('admin', { action: 'entities', query: { categoryId, search, page, pageSize } })
}

export function createEntity(entity) {
  return apiRequest('admin', { action: 'create-entity', method: 'POST', body: entity })
}

export function updateEntity(entity) {
  return apiRequest('admin', { action: 'update-entity', method: 'PATCH', body: entity })
}

export function regenerateEntityToken(id) {
  return apiRequest('admin', { action: 'regenerate-entity', method: 'POST', body: { id } })
}

export function deleteEntity(id) {
  return apiRequest('admin', { action: 'delete-entity', method: 'DELETE', body: { id } })
}
