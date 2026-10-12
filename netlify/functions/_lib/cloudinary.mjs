import { createHash } from 'node:crypto'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function cloudinaryConfig() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim()
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim()
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim()
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Cloudinary no está configurado.')
  return { cloudName, apiKey, apiSecret }
}

export function createUploadSignature({ folder, publicId, timestamp }) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig()
  const serialized = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${apiSecret}`
  return {
    cloudName,
    apiKey,
    folder,
    publicId,
    timestamp,
    signature: createHash('sha1').update(serialized).digest('hex'),
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
  }
}

export async function destroyImage(publicId) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig()
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex')
  const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: apiKey, signature })
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { method: 'POST', body })
  if (!response.ok) throw new Error(`Cloudinary no pudo eliminar la imagen (${response.status}).`)
  const result = await response.json()
  if (result.result !== 'ok' && result.result !== 'not found') throw new Error('Cloudinary no confirmó la eliminación de la imagen.')
}

export function validateImageMetadata(metadata) {
  const publicId = String(metadata?.publicId || '').trim()
  const secureUrl = String(metadata?.secureUrl || '').trim()
  const format = String(metadata?.format || '').trim().toLowerCase()
  const bytes = Number(metadata?.bytes)
  const width = Number(metadata?.width)
  const height = Number(metadata?.height)
  if (!publicId || !secureUrl || !/^https:\/\/res\.cloudinary\.com\//.test(secureUrl)) throw new Error('Cloudinary no devolvió una imagen válida.')
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(format)) throw new Error('El formato de imagen no está permitido.')
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_IMAGE_BYTES) throw new Error('La imagen no puede superar 5 MB.')
  if (![width, height].every((size) => Number.isInteger(size) && size > 0 && size <= 5000)) throw new Error('Las dimensiones de la imagen no son válidas.')
  return { publicId, secureUrl, format, bytes, width, height }
}

