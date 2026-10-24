import { createHash, randomBytes } from "node:crypto"

/** 32 random bytes → 43 url-safe chars, inside RFC 7636's 43..128 window. */
export function createVerifier(): string {
  return randomBytes(32).toString("base64url")
}

/** S256: BASE64URL(SHA256(ASCII(verifier))). */
export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

/** Opaque single-use CSRF state, 32 bytes hex. */
export function createState(): string {
  return randomBytes(32).toString("hex")
}
