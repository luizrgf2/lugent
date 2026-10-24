export function defaultDbPath(
  env: { APPDATA?: string; XDG_DATA_HOME?: string },
  home: string,
  platform: string,
): string {
  if (platform === "win32") {
    return `${env.APPDATA ?? `${home}\\AppData\\Roaming`}\\lugent\\db.sqlite`
  }
  if (env.XDG_DATA_HOME) return `${env.XDG_DATA_HOME}/lugent/db.sqlite`
  return `${home}/.local/share/lugent/db.sqlite`
}

export function shellCommand(platform: string): string[] {
  return platform === "win32" ? ["cmd", "/c"] : ["bash", "-c"]
}

export function defaultMcpOAuthPath(
  env: { APPDATA?: string; XDG_DATA_HOME?: string },
  home: string,
  platform: string,
): string {
  if (platform === "win32") {
    return `${env.APPDATA ?? `${home}\\AppData\\Roaming`}\\lugent\\mcp-oauth.json`
  }
  if (env.XDG_DATA_HOME) return `${env.XDG_DATA_HOME}/lugent/mcp-oauth.json`
  return `${home}/.local/share/lugent/mcp-oauth.json`
}

/** Best-effort browser open, as argv — no shell, so the URL is never interpreted. */
export function openBrowserCommand(platform: string, url: string): string[] {
  if (platform === "win32") return ["cmd", "/c", "start", "", url]
  if (platform === "darwin") return ["open", url]
  return ["xdg-open", url]
}
