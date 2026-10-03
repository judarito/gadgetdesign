export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function json(data, status = 200, headers = {}) {
  const merged = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })

  for (const [key, value] of Object.entries(headers)) {
    // Un array permite emitir varias cabeceras con el mismo nombre, que es lo
    // que hace falta para borrar las dos cookies a la vez.
    if (Array.isArray(value)) {
      for (const item of value) merged.append(key, item)
    } else if (value !== undefined && value !== null) {
      merged.set(key, value)
    }
  }

  return new Response(JSON.stringify(data), { status, headers: merged })
}

export function handleError(error) {
  const status = Number(error?.status) || 500
  const message = status >= 500
    ? 'Ocurrió un error interno. Inténtalo nuevamente.'
    : error.message

  if (status >= 500) console.error(error)
  return json({ error: message }, status)
}

export async function readJson(request) {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, 'La solicitud no tiene un formato válido.')
  }
}

export function getCookie(request, name) {
  const source = request.headers.get('cookie') || ''
  for (const part of source.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return null
}

/** IP del cliente, para los límites de uso. */
export function getClientIp(request) {
  return String(
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for') ||
    'local',
  ).split(',')[0].trim().slice(0, 64)
}

export function sessionCookie(name, value, maxAge, request) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookieSuffix(request)}`
}

export function clearCookie(name, request) {
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookieSuffix(request)}`
}

/**
 * `Secure` se decide por el protocolo real de la petición.
 *
 * Antes se miraba `process.env.CONTEXT`, que en este runtime de Functions no
 * existe: la comprobación era siempre falsa y las cookies de producción nunca
 * llevaban `Secure`. El protocolo de la petición, en cambio, siempre está.
 */
function secureCookieSuffix(request) {
  try {
    return new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  } catch {
    return ''
  }
}
