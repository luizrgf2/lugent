import { test, expect } from "bun:test"
import { expandImages } from "./images"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"

const dir = "/tmp/lugent-img-test"
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/a.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
writeFileSync(`${dir}/b.jpg`, Buffer.from("jpegdata"))
writeFileSync(`${dir}/t.txt`, "not an image")

test("plain text without markers stays a string", () => {
  expect(expandImages("olá mundo", dir)).toBe("olá mundo")
})

test("@path expands to OpenAI vision parts", () => {
  const c = expandImages("olha isso @a.png", dir) as any[]
  expect(Array.isArray(c)).toBe(true)
  expect(c[0]).toEqual({ type: "text", text: "olha isso" })
  expect(c[1].type).toBe("image_url")
  expect(c[1].image_url.url).toStartWith("data:image/png;base64,")
})

test("relative and absolute markers both work", () => {
  const c = expandImages(`@${dir}/a.png and @b.jpg`, dir) as any[]
  expect(c.filter((p: any) => p.type === "image_url").length).toBe(2)
})

test("jpeg mime is detected", () => {
  const c = expandImages("@b.jpg", dir) as any[]
  expect(c[0].image_url.url).toStartWith("data:image/jpeg;base64,")
})

test("unresolvable marker stays literal", () => {
  expect(expandImages("email me @home please", dir)).toBe("email me @home please")
  expect(expandImages("see @missing.png", dir)).toBe("see @missing.png")
})

test("non-image file stays literal", () => {
  expect(expandImages("see @t.txt", dir)).toBe("see @t.txt")
})

test("multiple images in one message", () => {
  const c = expandImages("@a.png @b.jpg", dir) as any[]
  expect(c.filter((p: any) => p.type === "image_url").length).toBe(2)
})

test("large file is rejected, marker stays literal", () => {
  writeFileSync(`${dir}/big.png`, Buffer.alloc(21 * 1024 * 1024))
  expect(expandImages("see @big.png", dir)).toBe("see @big.png")
})

test("clean up", () => {
  rmSync(dir, { recursive: true, force: true })
  expect(true).toBe(true)
})
