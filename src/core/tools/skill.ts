import type { ToolDef } from "./registry"
import { loadSkills, readSkillBody } from "../skills"

export function makeSkillTool(projectRoot: string): ToolDef {
  return {
    name: "skill",
    description: "Load a skill's instructions by id. Use only ids from the skill list.",
    schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    permission: "allow",
    async execute(args) {
      const meta = loadSkills(projectRoot).find(s => s.id === args.id)
      if (!meta) return { output: `unknown skill: ${args.id}`, error: true }
      return { output: readSkillBody(meta) }
    },
  }
}
