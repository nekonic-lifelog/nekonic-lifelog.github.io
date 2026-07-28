import jsQR from 'jsqr'

export interface QrMatrix {
  size: number
  get(x: number, y: number): boolean
}

export interface QrImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export const QR_QUIET = 4

const TARGET_PX = 320
const MIN_SCALE = 2
const CHANNELS = 4

export async function toQrMatrix(text: string): Promise<QrMatrix> {
  const { create } = await import('qrcode')
  const { modules } = create(text, { errorCorrectionLevel: 'M' })
  const size = modules.size
  return {
    size,
    get(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return false
      return modules.get(y, x) === 1
    },
  }
}

export function matrixToImageData(matrix: QrMatrix, scale: number, quiet: number): QrImage {
  const side = (matrix.size + quiet * 2) * scale
  const data = new Uint8ClampedArray(side * side * CHANNELS)
  data.fill(255)
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.get(x, y)) continue
      const px = (x + quiet) * scale
      const py = (y + quiet) * scale
      for (let dy = 0; dy < scale; dy++) {
        let at = ((py + dy) * side + px) * CHANNELS
        for (let dx = 0; dx < scale; dx++) {
          data[at] = 0
          data[at + 1] = 0
          data[at + 2] = 0
          at += CHANNELS
        }
      }
    }
  }
  return { data, width: side, height: side }
}

export function decodeQrFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  if (width <= 0 || height <= 0) return null
  const found = jsQR(data, width, height, { inversionAttempts: 'dontInvert' })
  return found ? found.data : null
}

export async function renderQrToCanvas(canvas: HTMLCanvasElement, text: string): Promise<void> {
  const matrix = await toQrMatrix(text)
  const scale = Math.max(MIN_SCALE, Math.floor(TARGET_PX / (matrix.size + QR_QUIET * 2)))
  const image = matrixToImageData(matrix, scale, QR_QUIET)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이 기기에서는 QR을 그릴 수 없습니다.')
  canvas.width = image.width
  canvas.height = image.height
  const bitmap = ctx.createImageData(image.width, image.height)
  bitmap.data.set(image.data)
  ctx.putImageData(bitmap, 0, 0)
}
