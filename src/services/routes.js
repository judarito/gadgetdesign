/**
 * Rutas de la aplicación que no son códigos de ficha.
 *
 * Vive aquí, y no en `main.js`, para que las Functions puedan usarla: un código
 * corto nunca debe ocupar una ruta reservada. Este módulo no puede importar
 * componentes `.vue`, porque `shortCode.js` lo usa desde las Functions.
 */
export const RESERVED_PATHS = ['admin', 'portal']

export function isReservedPath(segment) {
  return RESERVED_PATHS.includes(String(segment ?? '').toLowerCase())
}
