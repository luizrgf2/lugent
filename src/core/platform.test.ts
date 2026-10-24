import { test, expect } from "bun:test"
import { defaultDbPath, defaultMcpOAuthPath, openBrowserCommand, shellCommand } from "./platform"

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

test("defaultMcpOAuthPath: same location logic as the db, different filename", () => {
  expect(defaultMcpOAuthPath({}, "/home/u", "linux")).toBe("/home/u/.local/share/lugent/mcp-oauth.json")
  expect(defaultMcpOAuthPath({ XDG_DATA_HOME: "/xdg" }, "/home/u", "linux")).toBe("/xdg/lugent/mcp-oauth.json")
  expect(defaultMcpOAuthPath({ APPDATA: "C:\\AppData" }, "C:\\Users\\u", "win32")).toBe("C:\\AppData\\lugent\\mcp-oauth.json")
  expect(defaultMcpOAuthPath({}, "C:\\Users\\u", "win32")).toBe("C:\\Users\\u\\AppData\\Roaming\\lugent\\mcp-oauth.json")
})

test("openBrowserCommand: one argv per platform, never a shell string", () => {
  expect(openBrowserCommand("linux", "https://x/y")).toEqual(["xdg-open", "https://x/y"])
  expect(openBrowserCommand("darwin", "https://x/y")).toEqual(["open", "https://x/y"])
  // cmd /c start needs an explicit empty title argument, or it eats the URL as the title
  expect(openBrowserCommand("win32", "https://x/y")).toEqual(["cmd", "/c", "start", "", "https://x/y"])
})
