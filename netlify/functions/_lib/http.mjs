export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })
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

export function sessionCookie(name, value, maxAge) {
  const secure = secureCookieSuffix()
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`
}

export function clearCookie(name) {
  const secure = secureCookieSuffix()
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
}

function secureCookieSuffix() {
  return ['production', 'deploy-preview', 'branch-deploy'].includes(process.env.CONTEXT)
    ? '; Secure'
    : ''
}
