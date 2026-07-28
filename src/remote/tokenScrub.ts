export const REDACTED = '[토큰 가림]'

const MIN_SECRET = 8

function encodedForms(token: string): string[] {
  const forms = new Set<string>([token, token.trim()])
  try {
    forms.add(encodeURIComponent(token))
  } catch {
    void 0
  }
  if (typeof btoa === 'function') {
    try {
      forms.add(btoa(token))
      forms.add(btoa(`Bearer ${token}`))
    } catch {
      void 0
    }
  }
  return [...forms]
    .filter((form) => form.length >= MIN_SECRET)
    .sort((a, b) => b.length - a.length)
}

export function scrubToken(text: string, token: string): string {
  if (typeof token !== 'string' || token.length < MIN_SECRET) return text
  let out = text
  for (const form of encodedForms(token)) out = out.split(form).join(REDACTED)
  return out
}

export function scrubbedMessage(err: unknown, token: string): string {
  const raw = err instanceof Error ? err.message : String(err)
  return scrubToken(raw, token)
}
