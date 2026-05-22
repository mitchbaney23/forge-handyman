import { createHmac, timingSafeEqual } from 'node:crypto'

export function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

export function verifySharedSecret(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false
  return constantTimeEqual(provided, expected)
}

export function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyHmacSha256(payload: string, signatureHex: string, secret: string): boolean {
  const expected = hmacSha256Hex(payload, secret)
  return constantTimeEqual(expected, signatureHex)
}
