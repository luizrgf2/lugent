#!/usr/bin/env bun
/**
 * Builds the documentation pages, one folder per topic. No bundler: it writes
 * plain HTML that GitHub Pages serves verbatim from /docs (decided 2026-10-23).
 *
 * Run: bun docs/build.ts
 * Add a page: append to PAGES, run again, then commit what it wrote.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const HERE = dirname(new URL(import.meta.url).pathname)

type Group = "start" | "subsystems" | "sessions"

type Page = {
  slug: string
  title: string
  nav: string
  group: Group
  lead: string
  body: string
}

const PAGES: Page[] = []

const page = (p: Page) => { PAGES.push(p); return p }

// ── getting started ───────────────────────────────────────────────────────

page({
  slug: "getting-started",
  title: "Getting started",
  nav: "Overview",
  group: "start",
  lead: "lugent is a coding agent that runs in your terminal. One binary, one SQLite file, any OpenAI-compatible endpoint.",
  body: `
<section class="sec">
  <h2>Install</h2>
  <p>The package ships unbuilt TypeScript under a bun shebang, so installing it does not run a build step. You need Bun 1.4 or newer on your PATH.</p>
  <pre><span class="c">npm i -g lugent</span>
<span class="c">bunx lugent</span>   <span class="m"># without installing</span></pre>
</section>

<section class="sec">
  <h2>Configure a provider</h2>
  <p>lugent talks to any OpenAI-compatible endpoint. Point it at one in <code>~/.config/lugent/config.json</code>, or <code>lugent.json</code> in the project, which wins.</p>
  <pre>{
  <span class="k">"providers"</span>: {
    <span class="k">"ollama"</span>: { <span class="k">"baseUrl"</span>: <span class="c">"http://localhost:11434/v1"</span> }
  },
  <span class="k">"defaultProvider"</span>: <span class="c">"ollama"</span>,
  <span class="k">"defaultModel"</span>: <span class="c">"qwen3.5:14b"</span>
}</pre>
  <p>At startup each provider gets a health check. Unreachable ones report <code>OFF</code>, and lugent still starts.</p>
</section>

<section class="sec">
  <h2>What is in the box</h2>
  <ul>
    <li>Eight tools: read, glob, grep, edit, write, shell, skill, subagent</li>
    <li>Agents, subagents and skills as markdown files in a folder</li>
    <li>MCP servers over stdio or streamable HTTP, with OAuth</li>
    <li>Sessions, messages and permission grants in one SQLite file</li>
  </ul>
</section>`,
})

page({
  slug: "config",
  title: "Configuration",
  nav: "Configuration",
  group: "start",
  lead: "Providers, defaults and keys. The project file wins for providers; mcp, agents and skills merge both.",
  body: `
<section class="sec">
  <h2>Where it reads from</h2>
  <p>For <code>providers</code>, <code>defaultProvider</code>, <code>defaultModel</code> and <code>defaultAgent</code> lugent reads the <strong>first file found</strong>: no merging.</p>
  <dl class="table">
    <div class="row"><dt>lugent.json</dt><dd>Project root. Wins when present.</dd></div>
    <div class="row"><dt>~/.config/lugent/config.json</dt><dd>Global fallback, works on Windows too.</dd></div>
  </dl>
  <p><code>mcp</code>, agents and skills merge both files instead, the project winning per server or id.</p>
</section>

<section class="sec">
  <h2>Keys</h2>
  <p>Never inline a secret. Use <code>{env:VAR}</code> and lugent substitutes it at load time:</p>
  <pre>{ <span class="k">"apiKey"</span>: <span class="c">"{env:OPENROUTER_KEY}"</span> }</pre>
</section>

<section class="sec">
  <h2>Defaults</h2>
  <dl class="table">
    <div class="row"><dt>defaultProvider</dt><dd>Provider a new session starts on.</dd></div>
    <div class="row"><dt>defaultModel</dt><dd>Model for that provider.</dd></div>
    <div class="row"><dt>defaultAgent</dt><dd>Startup agent. <code>build</code> when absent; an unknown id warns and falls back.</dd></div>
    <div class="row"><dt>permissionMode</dt><dd><code>normal</code> or <code>yolo</code>. A project value overrides the global one.</dd></div>
  </dl>
</section>`,
})

page({
  slug: "usage",
  title: "Usage & commands",
  nav: "Usage & commands",
  group: "start",
  lead: "A full-screen TUI on a TTY, a plain ANSI REPL otherwise. --plain forces the REPL.",
  body: `
<section class="sec">
  <h2>Starting</h2>
  <pre>lugent [<span class="k">--plain</span>] [<span class="k">--db</span> <span class="m">path</span>]</pre>
  <p>Piped stdin (non-TTY) falls back to the plain REPL automatically, so lugent is scriptable.</p>
</section>

<section class="sec">
  <h2>Slash commands</h2>
  <dl class="table">
    <div class="row"><dt>/model</dt><dd>Two-level picker: provider, then live model list. Pinned to the session.</dd></div>
    <div class="row"><dt>/agent</dt><dd>Agent picker. Prompt, model and toolset apply from the next turn.</dd></div>
    <div class="row"><dt>/skills</dt><dd>Browse loaded skills, read-only.</dd></div>
    <div class="row"><dt>/mcp</dt><dd>Servers with status. Reconnect, disable, enable, authenticate, logout.</dd></div>
    <div class="row"><dt>/resume</dt><dd>Pick a past session of this directory and continue it.</dd></div>
    <div class="row"><dt>/permissions</dt><dd>Toggle normal or yolo.</dd></div>
    <div class="row"><dt>/clear</dt><dd>Start a fresh session.</dd></div>
    <div class="row"><dt>/exit</dt><dd>Quit.</dd></div>
  </dl>
  <p>Typing <code>/</code> in the composer opens an autocomplete box: it filters as you type, arrows move, Enter or Tab completes.</p>
</section>

<section class="sec">
  <h2>Keys</h2>
  <dl class="table">
    <div class="row"><dt>Ctrl+C ×1</dt><dd>Abort the running turn and deny a pending permission.</dd></div>
    <div class="row"><dt>Ctrl+C ×2</dt><dd>Exit.</dd></div>
    <div class="row"><dt>PageUp / PageDown</dt><dd>Page the live frame, or Shift+↑/↓.</dd></div>
    <div class="row"><dt>Home / End</dt><dd>Jump to the top or tail of the live frame.</dd></div>
    <div class="row"><dt>Esc</dt><dd>Stop a provider retry loop.</dd></div>
  </dl>
  <p>Finished turns land in the terminal's own scrollback, so the mouse wheel, touchpad and click-drag selection work natively.</p>
</section>

<section class="sec">
  <h2>Tools</h2>
  <dl class="table">
    <div class="row"><dt>read</dt><dd>allow. File with numbered lines, or a directory listing.</dd></div>
    <div class="row"><dt>glob</dt><dd>allow. Glob file search, limit 100.</dd></div>
    <div class="row"><dt>grep</dt><dd>allow. Content search, regex or literal.</dd></div>
    <div class="row"><dt>edit</dt><dd>ask. Unique-match string replace, returns a diff.</dd></div>
    <div class="row"><dt>write</dt><dd>ask. Create or replace a file.</dd></div>
    <div class="row"><dt>shell</dt><dd>ask. bash, or cmd on Windows. Two minute default timeout.</dd></div>
    <div class="row"><dt>skill</dt><dd>allow. Load a skill body by id.</dd></div>
    <div class="row"><dt>subagent</dt><dd>ask. Launch a subagent in a child session.</dd></div>
  </dl>
</section>`,
})

// ── subsystems ────────────────────────────────────────────────────────────

page({
  slug: "agents",
  title: "Agents",
  nav: "Agents",
  group: "subsystems",
  lead: "A named profile: system prompt, model, tool allowlist and permission overrides, declared in markdown.",
  body: `
<section class="sec">
  <h2>Where they live</h2>
  <p>The nested path is the id. Both scopes load; on the same id the project wins.</p>
  <pre>.agents/agents/reviewer.md      <span class="m">→ id</span> <span class="c">reviewer</span>
.agents/agents/team/audit.md    <span class="m">→ id</span> <span class="c">team/audit</span>
~/.agents/agents/*.md           <span class="m">→ user scope</span></pre>
</section>

<section class="sec">
  <h2>Frontmatter</h2>
  <pre><span class="m">---</span>
<span class="k">description</span>: Reviews changes read-only
<span class="k">color</span>: cyan
<span class="k">model</span>: 9router/glm-5.2
<span class="k">tools</span>: [read, glob, grep]
<span class="k">permissions</span>: {shell: ask}
<span class="m">---</span>
You are a code reviewer. Report findings with file and line references.</pre>
  <dl class="table">
    <div class="row"><dt>description</dt><dd>Shown by the agent picker. Absent, none.</dd></div>
    <div class="row"><dt>model</dt><dd><code>provider/model</code>, both required. Absent, inherit the session's.</dd></div>
    <div class="row"><dt>tools</dt><dd>Ids the model can see. A <code>tools</code> key that parses to nothing fails closed to none, with a warning.</dd></div>
    <div class="row"><dt>permissions</dt><dd><code>allow</code>, <code>ask</code> or <code>deny</code> per tool. <code>deny</code> also removes the tool.</dd></div>
    <div class="row"><dt>mode</dt><dd><code>primary</code>, <code>subagent</code> or <code>all</code>: who may launch it.</dd></div>
    <div class="row"><dt>color</dt><dd>TUI display color, an ink name or <code>#rrggbb</code>. Display only.</dd></div>
  </dl>
</section>

<section class="sec">
  <h2>Built in</h2>
  <dl class="table">
    <div class="row"><dt>build</dt><dd>The base system prompt. The startup default, always a way back.</dd></div>
    <div class="row"><dt>plan</dt><dd>Explore and design. <code>edit</code> and <code>write</code> denied, shell still permission-gated.</dd></div>
    <div class="row"><dt>general</dt><dd>A subagent with a fresh context. Delegation works with zero files.</dd></div>
  </dl>
</section>

<div class="callout">Built-ins load first, so a file with the same id overrides one without removing it.</div>

<section class="sec">
  <h2>Switching</h2>
  <p><code>/agent</code> lists loaded agents and switches between them. Switching works mid-session: history is kept and the next turn runs with the new prompt, model and toolset. The body of a file agent <strong>replaces</strong> the base prompt, and <code>AGENTS.md</code> plus the skills advertisement are still added on top.</p>
</section>`,
})

page({
  slug: "subagents",
  title: "Subagents",
  nav: "Subagents",
  group: "subsystems",
  lead: "A subagent is not a persona you switch into. It is a worker the model launches.",
  body: `
<section class="sec">
  <h2>How a child runs</h2>
  <p>During a turn the model calls the <code>subagent</code> tool with <code>{ agent, prompt }</code>. lugent starts a <strong>child session</strong>, in the same store and process, with the subagent's own prompt, model and tools. The child's final message comes back as the tool result.</p>
  <pre><span class="m">---</span>
<span class="k">description</span>: Probes one file and summarizes it
<span class="k">mode</span>: subagent
<span class="k">tools</span>: [read]
<span class="m">---</span>
You are a probe. Read exactly one file and summarize it in three lines.</pre>
</section>

<section class="sec">
  <h2>Rules</h2>
  <dl class="table">
    <div class="row"><dt>Discovery</dt><dd>A <code># Subagents</code> section of the prompt lists id and description, and only when at least one is launchable.</dd></div>
    <div class="row"><dt>Fresh context</dt><dd>The child shares no history, so the prompt must be self-contained.</dd></div>
    <div class="row"><dt>Parallel</dt><dd>Several <code>subagent</code> calls in one tool round run at the same time.</dd></div>
    <div class="row"><dt>Depth 1</dt><dd>A child never gets the <code>subagent</code> tool or the catalog, so it cannot launch a grandchild.</dd></div>
    <div class="row"><dt>Hidden</dt><dd>Children are persisted with a <code>parent</code> link but stay out of <code>/resume</code> and the picker.</dd></div>
    <div class="row"><dt>Not in /agent</dt><dd>Subagents are launch targets, not session personas.</dd></div>
  </dl>
  <p>The tool defaults to <code>ask</code>, and an agent's <code>tools</code> or <code>permissions</code> can allow, ask or deny <code>subagent</code> by name like any other tool.</p>
</section>`,
})

page({
  slug: "skills",
  title: "Skills",
  nav: "Skills",
  group: "subsystems",
  lead: "Markdown files in a folder. Advertised by name and description, loaded only when the model needs them.",
  body: `
<section class="sec">
  <h2>Where they live</h2>
  <p>Nested directory or flat file, both work. On the same id the project wins.</p>
  <pre>.agents/skills/git-release/SKILL.md   <span class="m">→ id</span> <span class="c">git-release</span>
.agents/skills/review.md              <span class="m">→ id</span> <span class="c">review</span>
~/.agents/skills/                     <span class="m">→ user scope</span></pre>
</section>

<section class="sec">
  <h2>Frontmatter</h2>
  <pre><span class="m">---</span>
<span class="k">name</span>: Git Release
<span class="k">description</span>: Prepare and publish releases
<span class="m">---</span>
Step 1: ...</pre>
  <p>A skill with a <code>description</code> is advertised in the system prompt, by id, name and description only. The model loads the full body on demand through the <code>skill</code> tool, so skill content never bloats the prompt upfront.</p>
</section>

<section class="sec">
  <h2>Using one</h2>
  <dl class="table">
    <div class="row"><dt>Let the model pick</dt><dd>When your request matches an advertised description, it calls <code>skill git-release</code> itself.</dd></div>
    <div class="row"><dt>Force one</dt><dd>Mention the id in your message.</dd></div>
    <div class="row"><dt>Browse</dt><dd><code>/skills</code> lists what is loaded.</dd></div>
  </dl>
  <p>Toggling skills on or off is not implemented: every loaded skill is active in every session.</p>
</section>`,
})

page({
  slug: "mcp",
  title: "MCP servers",
  nav: "MCP servers",
  group: "subsystems",
  lead: "The Model Context Protocol over stdio or streamable HTTP. Their tools join yours, permission-gated.",
  body: `
<section class="sec">
  <h2>Config</h2>
  <p>Declared in the <code>mcp</code> map of <code>lugent.json</code> or the global config. The type is inferred from <code>command</code> or <code>url</code>.</p>
  <pre>{
  <span class="k">"mcp"</span>: {
    <span class="k">"local-one"</span>:  { <span class="k">"command"</span>: [<span class="c">"npx"</span>, <span class="c">"-y"</span>, <span class="c">"some-mcp@latest"</span>] },
    <span class="k">"remote-one"</span>: { <span class="k">"url"</span>: <span class="c">"https://host/mcp"</span>,
                    <span class="k">"headers"</span>: { <span class="k">"X-Tenant"</span>: <span class="c">"{env:TENANT}"</span> } }
  }
}</pre>
</section>

<section class="sec">
  <h2>Transports</h2>
  <dl class="table">
    <div class="row"><dt>local</dt><dd>Spawns a child process and speaks newline-delimited JSON-RPC over stdio.</dd></div>
    <div class="row"><dt>remote</dt><dd>Streamable HTTP: one POST per message, <code>Mcp-Session-Id</code>, SSE responses. <code>http</code> is an alias.</dd></div>
  </dl>
  <p>At startup every enabled server connects in parallel and its tools are bridged as <code>&lt;server&gt;_&lt;tool&gt;</code>. A server that fails is reported and never stops lugent.</p>
</section>

<section class="sec">
  <h2>Signing in</h2>
  <p>A remote server that refuses the configured headers answers <code>401</code>. lugent reports it as <code>auth_required</code> instead of failing, because the fix is interactive. Choose <code>authenticate</code> in <code>/mcp</code> and lugent:</p>
  <ul>
    <li>discovers the protected-resource and authorization-server metadata (RFC 9728 and 8414), https only</li>
    <li>registers itself as a public client, once per server (RFC 7591)</li>
    <li>starts a loopback listener on <code>127.0.0.1:48762/oauth/callback</code> with PKCE S256, and opens your browser</li>
    <li>waits up to five minutes, always sending <code>resource</code> so the token is bound to that endpoint</li>
    <li>stores the tokens in <code>~/.local/share/lugent/mcp-oauth.json</code>, mode <code>0600</code></li>
  </ul>
  <p>Access tokens refresh 60 seconds before expiry, and once more, forcibly, on a mid-session <code>401</code>. A rejected refresh drops the tokens back to <code>auth_required</code>.</p>
</section>

<section class="sec">
  <h2>Status and actions</h2>
  <dl class="table">
    <div class="row"><dt>connected</dt><dd>With a tool count. Remote servers can log out or be disabled, local ones disabled.</dd></div>
    <div class="row"><dt>connecting</dt><dd>A handshake is still in flight.</dd></div>
    <div class="row"><dt>failed</dt><dd>With the error. Reconnect or disable.</dd></div>
    <div class="row"><dt>auth_required</dt><dd>Needs a sign-in. Authenticate or disable.</dd></div>
    <div class="row"><dt>disabled</dt><dd>Out of the session. Enable reconnects.</dd></div>
  </dl>
  <p>Enabling and disabling is session-scoped: lugent never rewrites <code>lugent.json</code>, because a turn must not silently edit a file that can hold secrets.</p>
</section>

<div class="callout"><strong>Trust note:</strong> a project lugent.json can declare local servers, whose command is spawned at startup with no prompt. That is the same trust channel as a project AGENTS.md, so read a repo's mcp block before running lugent in it.</div>`,
})

page({
  slug: "permissions",
  title: "Permissions",
  nav: "Permissions",
  group: "subsystems",
  lead: "Every tool has a default. Anything outside the project forces a question, and yolo turns all of it off.",
  body: `
<section class="sec">
  <h2>Answering a prompt</h2>
  <dl class="table">
    <div class="row"><dt>y</dt><dd>Allow this once.</dd></div>
    <div class="row"><dt>n</dt><dd>Deny. The model sees the refusal and can change approach.</dd></div>
    <div class="row"><dt>a</dt><dd>Always, for this tool and resource, for the rest of the session.</dd></div>
  </dl>
  <p>Anything else, including Enter, denies. Denying is always safe.</p>
</section>

<section class="sec">
  <h2>Outside-project guard</h2>
  <p>Any resource outside the project root, whether an absolute path, <code>..</code> or <code>~</code>, forces an <code>ask</code> even for tools that default to allow, unless already granted for the session.</p>
</section>

<section class="sec">
  <h2>Yolo</h2>
  <p><code>/permissions</code> then <code>yolo</code> auto-approves every tool call with no dialogs, including outside-project paths. A red <code>YOLO</code> badge shows on the chrome line above the composer. The choice persists to the global config as <code>permissionMode</code>, and a project <code>lugent.json</code> overrides it while present.</p>
  <p>Yolo never modifies the per-session <code>a</code> grants. <code>/permissions</code> then <code>normal</code> turns it off.</p>
</section>

<div class="callout">An agent's permissions override replaces the tool default, but a session always-grant still wins, and the outside-project guard still forces an ask.</div>`,
})

// ── sessions ──────────────────────────────────────────────────────────────

page({
  slug: "sessions",
  title: "Managing sessions",
  nav: "Managing sessions",
  group: "sessions",
  lead: "Every conversation is a row in one SQLite file. Start one, resume one, clear one.",
  body: `
<section class="sec">
  <h2>Commands</h2>
  <dl class="table">
    <div class="row"><dt>/clear</dt><dd>Start a fresh session. The old one stays on disk.</dd></div>
    <div class="row"><dt>/resume</dt><dd>Pick a past session of this directory and continue it.</dd></div>
    <div class="row"><dt>Ctrl+C ×2</dt><dd>Exit. Once aborts the running turn instead.</dd></div>
    <div class="row"><dt>--db &lt;path&gt;</dt><dd>Point the whole session store somewhere else.</dd></div>
  </dl>
</section>

<section class="sec">
  <h2>What a session carries</h2>
  <p>A session is not just messages. It keeps the provider and model pinned by <code>/model</code>, the agent chosen by <code>/agent</code>, and the permission grants answered with <code>a</code>. <code>/resume</code> restores all of it, so a resumed turn runs exactly like the one before it. It continues the session; it does not fork it.</p>
</section>

<section class="sec">
  <h2>Subagents are sessions too</h2>
  <p>A child launched by the <code>subagent</code> tool is a second session in the same store, linked to its parent. Children are hidden from <code>/resume</code> and the picker: only the child's final message returns to the parent.</p>
</section>`,
})

page({
  slug: "history",
  title: "Resume & history",
  nav: "Resume & history",
  group: "sessions",
  lead: "The transcript is append-only. Nothing is rewritten, and nothing is lost when you clear.",
  body: `
<section class="sec">
  <h2>Resuming</h2>
  <p><code>/resume</code> lists the sessions of the current directory, newest first. Pick one and the transcript replays with its last provider and model; the next turn continues it.</p>
  <pre><span class="m">$</span> lugent
<span class="m">&gt;</span> /resume
  <span class="c">ses_676f…</span>   today 14:02   <span class="m">3 turns</span>   build · 9router/glm-5.2
  <span class="c">ses_5f21…</span>   yesterday     <span class="m">8 turns</span>   plan · 9router/glm-5.2</pre>
</section>

<section class="sec">
  <h2>History in the composer</h2>
  <p>Up and down walk the messages you typed in this session. A collapsed multi-line paste is recalled as its token, and expands back to the full text when you submit.</p>
</section>

<section class="sec">
  <h2>Why append-only</h2>
  <p>Messages are never updated in place. A turn appends the user message, the assistant reply and each tool result. That is what makes resuming exact, and what lets a crashed turn leave a readable session behind.</p>
</section>`,
})

page({
  slug: "data",
  title: "Data & storage",
  nav: "Data & storage",
  group: "sessions",
  lead: "One SQLite file holds sessions, messages and permission grants. Nothing leaves your machine.",
  body: `
<section class="sec">
  <h2>Where the data lives</h2>
  <pre><span class="m">linux</span>
<span class="c">~/.local/share/lugent/db.sqlite</span>
<span class="m">windows</span>
<span class="c">%APPDATA%\\lugent\\db.sqlite</span></pre>
  <p><code>$XDG_DATA_HOME</code> is honoured on Linux when set. <code>--db &lt;path&gt;</code> overrides the location for a single run.</p>
</section>

<section class="sec">
  <h2>Other files</h2>
  <dl class="table">
    <div class="row"><dt>config.json</dt><dd>Global config: providers, defaults, permissionMode.</dd></div>
    <div class="row"><dt>mcp-oauth.json</dt><dd>MCP OAuth tokens, mode 0600, keyed by the URL that issued them.</dd></div>
    <div class="row"><dt>lugent.json</dt><dd>Project config, in the repo. Never put a secret in it.</dd></div>
  </dl>
</section>

<section class="sec">
  <h2>Backup and cleanup</h2>
  <p>The database is a plain SQLite file. Copy it to back up every session, delete it to start clean. Deleting it also clears the permission grants.</p>
</section>`,
})

// ── render ────────────────────────────────────────────────────────────────

const GROUPS: { key: Group; label: string }[] = [
  { key: "start", label: "GETTING STARTED" },
  { key: "subsystems", label: "SUBSYSTEMS" },
  { key: "sessions", label: "SESSIONS" },
]

/** All pages live one level below /docs, so every link is a sibling. */
const link = (p: Page) => `../${p.slug}/`
const homeLink = "../"

function sidebar(current: Page) {
  const body = GROUPS.map(g => {
    const links = PAGES.filter(p => p.group === g.key).map(p => {
      const active = p.slug === current.slug ? ' aria-current="page"' : ""
      return `          <a href="${link(p)}"${active}>${p.nav}</a>`
    }).join("\n")
    return `        <div class="side-group">
          <p class="side-label">${g.label}</p>
${links}
        </div>`
  }).join("\n")

  return `    <aside class="side" data-open="false">
      <button class="side-toggle" type="button" aria-expanded="false">Documentation contents</button>
      <div class="side-body">
        <div class="side-group">
          <p class="side-label">INSTALL</p>
          <p class="side-install">npm i -g lugent</p>
        </div>
${body}
      </div>
    </aside>`
}

function render(current: Page) {
  const idx = PAGES.findIndex(p => p.slug === current.slug)
  const prev = idx > 0 ? PAGES[idx - 1] : null
  const next = idx < PAGES.length - 1 ? PAGES[idx + 1] : null

  const pager = (prev || next) ? `
      <nav class="pager" aria-label="Pagination">
${prev ? `        <a class="prev" href="${link(prev)}"><span>PREVIOUS</span><strong>← ${prev.nav}</strong></a>` : "        <span></span>"}
${next ? `        <a class="next" href="${link(next)}"><span>NEXT</span><strong>${next.nav} →</strong></a>` : ""}
      </nav>` : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="${current.lead.replace(/"/g, "&quot;")}">
<meta name="theme-color" content="#101010">
<title>${current.title} — lugent</title>
<link rel="stylesheet" href="../site.css">
</head>
<body>

<header class="hdr">
  <div class="brand">
    <span class="mark" aria-hidden="true">
      <svg viewBox="0 0 120 120" role="img">
        <path d="M30 26 L66 60 L30 94" fill="none" stroke="#00f5a0" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M30 106 L92 106" fill="none" stroke="#00f5a0" stroke-width="13" stroke-linecap="round"/>
      </svg>
    </span>
    <a class="wordmark" href="${homeLink}">lugent</a>
    <span class="chip">v0.1.3</span>
  </div>

  <button class="menu-btn" type="button" aria-expanded="false" aria-controls="nav" aria-label="Menu">≡</button>

  <nav class="nav" id="nav" aria-label="Main">
    <a href="${link(PAGES[0])}" aria-current="page">Documentation</a>
    <a href="https://github.com/luizrgf2/lugent">GitHub</a>
    <a href="https://www.npmjs.com/package/lugent">npm</a>
  </nav>
</header>

<div class="docs">
${sidebar(current)}

    <main class="main">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="${link(PAGES[0])}">docs</a><span aria-hidden="true">/</span><span aria-current="page">${current.slug}</span>
      </nav>

      <div class="doc-head">
        <h1 class="doc">${current.title}</h1>
        <p>${current.lead}</p>
      </div>
${current.body}
${pager}
    </main>
</div>

<footer class="ftr">
  <span>lugent 0.1.3 · MIT</span>
  <span class="ftr-links">
    <a href="https://github.com/luizrgf2/lugent">GitHub</a>
    <a href="https://www.npmjs.com/package/lugent">npm</a>
    <a href="https://github.com/luizrgf2/lugent/blob/main/docs/decisions.md">Decisions</a>
  </span>
</footer>

<script>
var menu = document.querySelector(".menu-btn");
var nav = document.getElementById("nav");
if (menu && nav) menu.addEventListener("click", function () {
  var open = nav.dataset.open === "true";
  nav.dataset.open = String(!open);
  menu.setAttribute("aria-expanded", String(!open));
});

var side = document.querySelector(".side");
var toggle = document.querySelector(".side-toggle");
if (side && toggle) {
  side.dataset.open = matchMedia("(min-width: 901px)").matches ? "true" : "false";
  toggle.setAttribute("aria-expanded", side.dataset.open);
  toggle.addEventListener("click", function () {
    var open = side.dataset.open === "true";
    side.dataset.open = String(!open);
    toggle.setAttribute("aria-expanded", String(!open));
  });
}
</script>

</body>
</html>
`
}

let n = 0
for (const p of PAGES) {
  const dir = join(HERE, p.slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "index.html"), render(p))
  n++
}
console.log(`wrote ${n} page(s)`)
