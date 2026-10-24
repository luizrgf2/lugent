import { test, expect } from "bun:test"
import { challengeFor, createState, createVerifier } from "./pkce"

test("challengeFor matches the RFC 7636 S256 example", () => {
  // RFC 7636 Appendix B
  expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
})

test("createVerifier: 43 chars, url-safe, never repeats", () => {
  const a = createVerifier()
  const b = createVerifier()
  expect(a).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
  expect(a).not.toBe(b)
})

test("createState: 64 hex chars, never repeats", () => {
  expect(createState()).toMatch(/^[0-9a-f]{64}$/)
  expect(createState()).not.toBe(createState())
})
