export async function apiRequest(endpoint, { action, method = 'GET', query = {}, body } = {}) {
  const url = new URL(`/.netlify/functions/${endpoint}`, window.location.origin)
  if (action) url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload.error || 'No fue posible completar la solicitud.')
    error.status = response.status
    throw error
  }

  return payload
}
