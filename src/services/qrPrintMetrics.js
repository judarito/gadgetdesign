import QRCode from 'qrcode'

export const QR_QUIET_ZONE_MODULES = 4

export function createPrintQr(value) {
  return QRCode.create(value, { errorCorrectionLevel: 'H' })
}

export function getQrPrintMetrics(value, settings) {
  const qr = createPrintQr(value)
  const totalModules = qr.modules.size + QR_QUIET_ZONE_MODULES * 2
  const qrSizeMm = toPositiveNumber(settings.qrSizeMm, 'tamaño del QR')
  const nozzleMm = toPositiveNumber(settings.nozzleMm, 'boquilla')
  const moduleSizeMm = qrSizeMm / totalModules
  const recommendedModuleMm = nozzleMm * 2

  return {
    matrixModules: qr.modules.size,
    totalModules,
    moduleSizeMm,
    recommendedModuleMm,
    isPrintable: moduleSizeMm >= recommendedModuleMm,
    modelWidthMm: settings.format === 'keychain' ? qrSizeMm + 12 : qrSizeMm,
    modelHeightMm: qrSizeMm,
  }
}

export function toPositiveNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`El valor de ${label} no es válido.`)
  }
  return number
}
