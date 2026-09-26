const SHORT_CODE_LENGTH = 12

export function generateShortCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  const binary = String.fromCharCode(...bytes)

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, SHORT_CODE_LENGTH)
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value),
  )
}
