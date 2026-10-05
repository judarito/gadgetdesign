/**
 * Comprobación de que el despliegue está vivo.
 *
 * El commit y el contexto no están en el entorno de Functions: `CONTEXT`,
 * `COMMIT_REF` y `HEAD` solo existen durante el build. Por eso este endpoint
 * respondía siempre `environment: "unknown"` y `commit: null`, justo los dos
 * datos que existen para comprobar qué se desplegó. La información sí está
 * publicada en `/build-info.json`, que genera `scripts/writeBuildInfo.mjs` en el
 * build, así que se lee de ahí. Las variables de entorno se mantienen como
 * respaldo por si el archivo no está disponible.
 */
export default async function handler(request) {
  const buildInfo = await readBuildInfo(request)

  return new Response(JSON.stringify({
    status: 'ok',
    environment: buildInfo?.context || process.env.CONTEXT || process.env.NODE_ENV || 'unknown',
    commit: buildInfo?.commit || process.env.COMMIT_REF || process.env.HEAD || null,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

async function readBuildInfo(request) {
  try {
    const origin = new URL(request.url).origin
    const response = await fetch(`${origin}/build-info.json`, {
      signal: AbortSignal.timeout(3_000),
    })
    if (!response.ok) return null

    const info = await response.json()
    return info && typeof info === 'object' ? info : null
  } catch {
    // Sin build-info el endpoint sigue respondiendo `ok`: el smoke valida el
    // commit por su cuenta contra el mismo archivo.
    return null
  }
}
