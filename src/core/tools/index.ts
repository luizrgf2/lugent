import type { ToolDef } from "./registry"
import { readTool } from "./read"
import { globTool } from "./glob"
import { grepTool } from "./grep"
import { editTool } from "./edit"
import { writeTool } from "./write"
import { shellTool } from "./shell"
import { makeSkillTool } from "./skill"

export function makeTools(projectRoot: string): ToolDef[] {
  return [readTool, globTool, grepTool, editTool, writeTool, shellTool, makeSkillTool(projectRoot)]
}
