import type { ToolDef } from "./registry"

export function makeSubagentTool(): ToolDef {
  return {
    name: "subagent",
    description: "Launch a subagent in a child session. Choose an id from the subagent list; the child starts with fresh context, so the prompt must be self-contained. Returns the child's final message.",
    schema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "subagent id" },
        prompt: { type: "string", description: "self-contained task for the child" },
      },
      required: ["agent", "prompt"],
    },
    permission: "ask",
    async execute(args: any, ctx) {
      if (!ctx.spawn) return { output: "subagents are not available in this session", error: true }
      return ctx.spawn(args.agent, args.prompt)
    },
  }
}
