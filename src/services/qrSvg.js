import QRCode from 'qrcode'

const DEFAULT_MARGIN_MODULES = 4
const DEFAULT_MODULE_SIZE_MM = 1

export function createSlicerQrSvg(value, options = {}) {
  const margin = options.margin ?? DEFAULT_MARGIN_MODULES
  const moduleSizeMm = options.moduleSizeMm ?? DEFAULT_MODULE_SIZE_MM
  const errorCorrectionLevel = options.errorCorrectionLevel ?? 'H'
  const qr = QRCode.create(value, { errorCorrectionLevel })
  const matrix = qr.modules
  const totalModules = matrix.size + margin * 2
  const physicalSizeMm = totalModules * moduleSizeMm
  const path = buildClosedModulePath(matrix, margin)

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${physicalSizeMm}mm" height="${physicalSizeMm}mm" viewBox="0 0 ${totalModules} ${totalModules}">`,
    `<path d="${path}" fill="#000000" fill-rule="nonzero"/>`,
    '</svg>',
  ].join('\n')
}

function buildClosedModulePath(matrix, margin) {
  const segments = []

  for (let row = 0; row < matrix.size; row += 1) {
    let column = 0

    while (column < matrix.size) {
      if (!matrix.get(row, column)) {
        column += 1
        continue
      }

      const start = column
      while (column < matrix.size && matrix.get(row, column)) column += 1

      const x = start + margin
      const y = row + margin
      const width = column - start
      segments.push(`M${x} ${y}h${width}v1h-${width}z`)
    }
  }

  return segments.join('')
}
