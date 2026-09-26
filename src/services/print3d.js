import {
  BoxGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Path,
  Shape,
} from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'
import {
  createPrintQr,
  getQrPrintMetrics,
  QR_QUIET_ZONE_MODULES,
  toPositiveNumber,
} from './qrPrintMetrics.js'

export function createPrintableQrStl(value, settings) {
  const qr = createPrintQr(value)
  const metrics = getQrPrintMetrics(value, settings)
  if (!metrics.isPrintable) {
    throw new Error('Aumenta el tamaño del QR o selecciona una boquilla más pequeña.')
  }

  const qrSizeMm = toPositiveNumber(settings.qrSizeMm, 'tamaño del QR')
  const baseHeightMm = toPositiveNumber(settings.baseHeightMm, 'grosor de la base')
  const reliefHeightMm = toPositiveNumber(settings.reliefHeightMm, 'altura del relieve')
  const moduleSizeMm = metrics.moduleSizeMm
  const group = new Group()
  const material = new MeshBasicMaterial()

  group.add(createBaseMesh(settings.format, qrSizeMm, baseHeightMm, material))
  addQrModules(group, qr.modules, {
    qrSizeMm,
    moduleSizeMm,
    baseHeightMm,
    reliefHeightMm,
    material,
  })

  group.updateMatrixWorld(true)
  const exporter = new STLExporter()
  const data = exporter.parse(group, { binary: true })

  disposeGroup(group)
  return data.buffer
}

function createBaseMesh(format, qrSizeMm, baseHeightMm, material) {
  if (format !== 'keychain') {
    const geometry = new BoxGeometry(qrSizeMm, qrSizeMm, baseHeightMm)
    const mesh = new Mesh(geometry, material)
    mesh.position.z = baseHeightMm / 2
    return mesh
  }

  const left = -qrSizeMm / 2 - 12
  const right = qrSizeMm / 2
  const bottom = -qrSizeMm / 2
  const top = qrSizeMm / 2
  const shape = new Shape()
  shape.moveTo(left, bottom)
  shape.lineTo(right, bottom)
  shape.lineTo(right, top)
  shape.lineTo(left, top)
  shape.closePath()

  const hole = new Path()
  hole.absarc(left + 6, 0, 2.6, 0, Math.PI * 2, true)
  shape.holes.push(hole)

  const geometry = new ExtrudeGeometry(shape, {
    depth: baseHeightMm,
    bevelEnabled: false,
    curveSegments: 32,
  })
  return new Mesh(geometry, material)
}

function addQrModules(group, matrix, options) {
  const {
    qrSizeMm,
    moduleSizeMm,
    baseHeightMm,
    reliefHeightMm,
    material,
  } = options
  const contentOffsetMm = QR_QUIET_ZONE_MODULES * moduleSizeMm
  const contentLeft = -qrSizeMm / 2 + contentOffsetMm
  const contentTop = qrSizeMm / 2 - contentOffsetMm

  for (let row = 0; row < matrix.size; row += 1) {
    let column = 0

    while (column < matrix.size) {
      if (!matrix.get(row, column)) {
        column += 1
        continue
      }

      const start = column
      while (column < matrix.size && matrix.get(row, column)) column += 1

      const runLength = column - start
      const geometry = new BoxGeometry(
        runLength * moduleSizeMm,
        moduleSizeMm,
        reliefHeightMm,
      )
      const mesh = new Mesh(geometry, material)
      mesh.position.set(
        contentLeft + (start + runLength / 2) * moduleSizeMm,
        contentTop - (row + 0.5) * moduleSizeMm,
        baseHeightMm + reliefHeightMm / 2,
      )
      group.add(mesh)
    }
  }
}

function disposeGroup(group) {
  group.traverse((object) => {
    object.geometry?.dispose()
    object.material?.dispose()
  })
}
