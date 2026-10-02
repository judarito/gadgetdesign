const REQUEST_TIMEOUT_MS = 12_000
const GET_RETRY_DELAYS_MS = [350, 900]

export async function apiRequest(endpoint, { action, method = 'GET', query = {}, body } = {}) {
  const url = new URL(`/.netlify/functions/${endpoint}`, window.location.origin)
  if (action) url.searchParams.set('action', action)
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const response = await resilientFetch(url, { method, body })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(payload.error || 'No fue posible completar la solicitud.')
    error.status = response.status
    throw error
  }

  return payload
}

async function resilientFetch(url, { method, body }) {
  const retryDelays = method === 'GET' ? GET_RETRY_DELAYS_MS : []

  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      if (!shouldRetry(response.status) || attempt === retryDelays.length) return response
      await response.body?.cancel()
    } catch (error) {
      if (attempt === retryDelays.length) throw friendlyNetworkError(error)
    } finally {
      window.clearTimeout(timeout)
    }

    await wait(retryDelays[attempt])
  }

  throw new Error('No fue posible completar la solicitud.')
}

function shouldRetry(status) {
  return status === 408 || status === 429 || status >= 500
}

function friendlyNetworkError(error) {
  if (error?.name === 'AbortError') {
    return new Error('La solicitud tardó demasiado. Revisa tu conexión e inténtalo nuevamente.')
  }
  if (!navigator.onLine) {
    return new Error('No tienes conexión. Cuando vuelvas a estar en línea podrás intentarlo nuevamente.')
  }
  return new Error('No fue posible conectar con el servicio. Inténtalo nuevamente.')
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
