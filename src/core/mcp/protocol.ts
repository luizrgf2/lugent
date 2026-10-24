export type JsonRpcId = string | number

export interface JsonRpcRequest { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown }
export interface JsonRpcNotification { jsonrpc: "2.0"; method: string; params?: unknown }
export interface JsonRpcResult { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
export interface JsonRpcError { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string; data?: unknown } }
export type JsonRpcResponse = JsonRpcResult | JsonRpcError
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse

export const CLIENT_NAME = "lugent"
export const CLIENT_VERSION = "0.1.0"

/**
 * v1 speaks the revision that still has `initialize` + `Mcp-Session-Id`: every
 * real server we target predates the stateless 2026-07-28 revision.
 */
export const CLIENT_PROTOCOL_VERSION = "2025-06-18"
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
export const MCP_TIMEOUT = 30_000

export function isResponse(m: JsonRpcMessage): m is JsonRpcResponse {
  return "id" in m && !("method" in m)
}
export function isRequest(m: JsonRpcMessage): m is JsonRpcRequest {
  return "method" in m && "id" in m
}
export function isNotification(m: JsonRpcMessage): m is JsonRpcNotification {
  return "method" in m && !("id" in m)
}
export function isError(m: JsonRpcResponse): m is JsonRpcError {
  return "error" in m
}
