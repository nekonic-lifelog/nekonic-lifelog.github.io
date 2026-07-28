type Listener = () => void

const listeners = new Set<Listener>()

export function onDirty(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyDirty(): void {
  for (const listener of [...listeners]) listener()
}
