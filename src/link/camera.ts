import { decodeQrFromImageData } from './qr'

export type CameraReason = 'insecure' | 'unsupported' | 'denied' | 'missing' | 'busy' | 'other'

export class CameraError extends Error {
  readonly reason: CameraReason

  constructor(reason: CameraReason, message: string) {
    super(message)
    this.name = 'CameraError'
    this.reason = reason
  }
}

export interface ScanHandle {
  stop(): void
}

export interface ScanOptions {
  intervalMs?: number
  maxSide?: number
}

const DEFAULT_INTERVAL_MS = 140
const DEFAULT_MAX_SIDE = 720

function secure(): boolean {
  return typeof window === 'undefined' || window.isSecureContext !== false
}

export function cameraAvailable(): boolean {
  if (typeof navigator === 'undefined') return false
  if (!secure()) return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}

function toCameraError(err: unknown): CameraError {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new CameraError(
      'denied',
      '카메라 권한이 거부되었습니다. 브라우저 설정에서 이 사이트의 카메라를 허용하거나, 아래 수동 입력으로 연결하세요.',
    )
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return new CameraError(
      'missing',
      '쓸 수 있는 카메라를 찾지 못했습니다. 아래 수동 입력으로 연결하세요.',
    )
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new CameraError(
      'busy',
      '다른 앱이 카메라를 쓰고 있어 열지 못했습니다. 그 앱을 닫고 다시 시도하거나, 아래 수동 입력으로 연결하세요.',
    )
  }
  return new CameraError(
    'other',
    '카메라를 열지 못했습니다. 아래 수동 입력으로 연결하세요.',
  )
}

function frameSize(video: HTMLVideoElement, maxSide: number): { w: number; h: number } {
  const w = video.videoWidth
  const h = video.videoHeight
  if (w <= 0 || h <= 0) return { w: 0, h: 0 }
  const ratio = Math.min(1, maxSide / Math.max(w, h))
  return { w: Math.round(w * ratio), h: Math.round(h * ratio) }
}

export async function startScan(
  video: HTMLVideoElement,
  onText: (t: string) => void,
  opts?: ScanOptions,
): Promise<ScanHandle> {
  if (!secure()) {
    throw new CameraError(
      'insecure',
      '보안 연결(HTTPS)이 아니어서 카메라를 열 수 없습니다. 아래 수동 입력으로 연결하세요.',
    )
  }
  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new CameraError(
      'unsupported',
      '이 기기에서는 앱 안에서 카메라를 열 수 없습니다. 브라우저로 열어 다시 시도하거나, 아래 수동 입력으로 연결하세요.',
    )
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
  } catch (err) {
    throw toCameraError(err)
  }

  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS
  const maxSide = opts?.maxSide ?? DEFAULT_MAX_SIDE
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  let stopped = false
  let frame = 0
  let timer = 0
  let last = ''

  const release = () => {
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    if (frame) cancelAnimationFrame(frame)
    if (timer) clearTimeout(timer)
    frame = 0
    timer = 0
    release()
  }

  const step = () => {
    if (stopped) return
    if (ctx) {
      const { w, h } = frameSize(video, maxSide)
      if (w > 0 && h > 0) {
        canvas.width = w
        canvas.height = h
        ctx.drawImage(video, 0, 0, w, h)
        const image = ctx.getImageData(0, 0, w, h)
        const text = decodeQrFromImageData(image.data, image.width, image.height)
        if (text && text !== last) {
          last = text
          onText(text)
          if (stopped) return
        }
      }
    }
    timer = window.setTimeout(() => {
      if (stopped) return
      frame = requestAnimationFrame(step)
    }, intervalMs)
  }

  video.setAttribute('playsinline', 'true')
  video.muted = true
  video.srcObject = stream
  try {
    await video.play()
  } catch (err) {
    stop()
    throw toCameraError(err)
  }

  frame = requestAnimationFrame(step)
  return { stop }
}
