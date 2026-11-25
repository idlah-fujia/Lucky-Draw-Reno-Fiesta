import { createHmac, timingSafeEqual } from 'node:crypto'

export function signProof(id, secret) {
  return createHmac('sha256', secret).update(`proof:${id}`).digest('base64url')
}

export function proofPath(id, secret) {
  return `/proof/${id}/${signProof(id, secret)}`
}

export function validProofSig(id, sig, secret) {
  if (!id || !sig || !secret) return false
  const expected = Buffer.from(signProof(id, secret))
  const given = Buffer.from(String(sig))
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}
