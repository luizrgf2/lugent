export type Role = "user" | "assistant" | "tool"

export interface ToolCall { id: string; name: string; args: unknown }

export interface Message {
  id: string
  sessionId: string
  role: Role
  content: string | null
  toolCalls?: ToolCall[]   // assistant
  toolCallId?: string      // tool
  meta?: Record<string, unknown>
  createdAt: string
}

export interface ToolResult { output: string; error?: boolean }

export interface ToolContext { cwd: string; signal?: AbortSignal }

export interface SkillMeta {
  id: string
  name: string
  description?: string
  file: string   // absolute path to the markdown file
}

// ---- wire types (OpenAI-compatible) ----
export interface ApiToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface ChatMsg {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: ApiToolCall[]   // assistant
  tool_call_id?: string        // tool
}

// OpenAI vision content parts (user role only)
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
export type UserContent = string | ContentPart[]

export interface ChatResponse {
  content: string
  toolCalls: ToolCall[]
  usage?: { input: number; output: number }
}
