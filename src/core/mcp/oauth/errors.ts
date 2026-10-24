/** An OAuth protocol failure. `code` carries the authorization server's error code when it sent one. */
export class McpOAuthError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message)
    this.name = "McpOAuthError"
  }
}

/** The server needs an interactive authorization: distinct status, not a generic failure. */
export class McpAuthRequiredError extends Error {
  constructor(public server: string, message?: string) {
    super(message ?? `server ${server} requires OAuth authorization — open /mcp and choose authenticate`)
    this.name = "McpAuthRequiredError"
  }
}
