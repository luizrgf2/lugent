import { test, expect } from "bun:test"
import { defaultDbPath, shellCommand } from "./platform"

test("defaultDbPath: linux uses XDG convention", () => {
  expect(defaultDbPath({}, "/home/u", "linux")).toBe("/home/u/.local/share/lugent/db.sqlite")
})

test("defaultDbPath: XDG_DATA_HOME wins when set", () => {
  expect(defaultDbPath({ XDG_DATA_HOME: "/data" }, "/home/u", "linux")).toBe("/data/lugent/db.sqlite")
})

test("defaultDbPath: win32 uses APPDATA", () => {
  expect(defaultDbPath({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "C:\\Users\\u", "win32"))
    .toBe("C:\\Users\\u\\AppData\\Roaming\\lugent\\db.sqlite")
})

test("defaultDbPath: win32 without APPDATA derives from home", () => {
  expect(defaultDbPath({}, "C:\\Users\\u", "win32"))
    .toBe("C:\\Users\\u\\AppData\\Roaming\\lugent\\db.sqlite")
})

test("shellCommand: win32 uses cmd, else bash", () => {
  expect(shellCommand("win32")).toEqual(["cmd", "/c"])
  expect(shellCommand("linux")).toEqual(["bash", "-c"])
  expect(shellCommand("darwin")).toEqual(["bash", "-c"])
})
