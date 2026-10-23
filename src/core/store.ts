import { Database } from "bun:sqlite"
import type { Message } from "./types"

export interface SessionRow { id: string; provider: string; model: string; aborted: boolean; agent?: string | null }
export interface SessionSummary { id: string; provider: string; model: string; createdAt: string; preview: string }

export class Store {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true })
    this.db.run(`CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY, title TEXT, created_at TEXT,
      provider TEXT, model TEXT, directory TEXT, aborted INTEGER DEFAULT 0)`)
    // migrate pre-/resume databases; "duplicate column" error means already migrated
    try { this.db.run(`ALTER TABLE session ADD COLUMN directory TEXT`) } catch {}
    try { this.db.run(`ALTER TABLE session ADD COLUMN agent TEXT`) } catch {}
    this.db.run(`CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY, session_id TEXT REFERENCES session(id),
      role TEXT, content TEXT, tool_calls JSON, tool_call_id TEXT,
      meta JSON, created_at TEXT)`)
    this.db.run(`CREATE TABLE IF NOT EXISTS permission (
      session_id TEXT, tool TEXT, resource TEXT,
      PRIMARY KEY (session_id, tool, resource))`)
  }

  createSession(provider: string, model: string, directory?: string, agent?: string | null): SessionRow {
    const id = `ses_${crypto.randomUUID()}`
    this.db.run(`INSERT INTO session (id, created_at, provider, model, directory, agent) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, new Date().toISOString(), provider, model, directory ?? null, agent ?? null])
    return { id, provider, model, aborted: false, agent: agent ?? null }
  }

  loadSession(id: string): SessionRow | undefined {
    const row = this.db.query(`SELECT id, provider, model, aborted, agent FROM session WHERE id = ?`).get(id) as any
    return row ? { id: row.id, provider: row.provider, model: row.model, aborted: !!row.aborted, agent: row.agent ?? null } : undefined
  }

  setAgent(sessionId: string, agent: string | null): void {
    this.db.run(`UPDATE session SET agent = ? WHERE id = ?`, [agent, sessionId])
  }

  /** Sessions of one directory, newest first, preview = first user message. Empty/legacy (null directory) rows excluded. */
  listSessions(directory: string): SessionSummary[] {
    const rows = this.db.query(`
      SELECT s.id, s.provider, s.model, s.created_at,
             (SELECT content FROM message m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.created_at, m.rowid LIMIT 1) AS preview
      FROM session s
      WHERE s.directory = ?
        AND EXISTS (SELECT 1 FROM message m WHERE m.session_id = s.id)
      ORDER BY s.created_at DESC`).all(directory) as any[]
    return rows.map(r => ({ id: r.id, provider: r.provider, model: r.model, createdAt: r.created_at, preview: r.preview ?? "" }))
  }

  appendMessage(m: Message): void {
    this.db.run(`INSERT INTO message (id, session_id, role, content, tool_calls, tool_call_id, meta, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.sessionId, m.role, m.content,
       m.toolCalls ? JSON.stringify(m.toolCalls) : null,
       m.toolCallId ?? null,
       m.meta ? JSON.stringify(m.meta) : null,
       m.createdAt])
  }

  getMessages(sessionId: string): Message[] {
    const rows = this.db.query(`SELECT * FROM message WHERE session_id = ? ORDER BY created_at, rowid`).all(sessionId) as any[]
    return rows.map(r => ({
      id: r.id, sessionId: r.session_id, role: r.role, content: r.content,
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      toolCallId: r.tool_call_id ?? undefined,
      meta: r.meta ? JSON.parse(r.meta) : undefined,
      createdAt: r.created_at,
    }))
  }

  setAborted(sessionId: string): void {
    this.db.run(`UPDATE session SET aborted = 1 WHERE id = ?`, [sessionId])
  }

  grantPermission(sessionId: string, tool: string, resource: string): void {
    this.db.run(`INSERT OR IGNORE INTO permission (session_id, tool, resource) VALUES (?, ?, ?)`,
      [sessionId, tool, resource])
  }

  hasPermission(sessionId: string, tool: string, resource: string): boolean {
    return !!this.db.query(`SELECT 1 FROM permission WHERE session_id = ? AND tool = ? AND resource = ?`)
      .get(sessionId, tool, resource)
  }

  close(): void { this.db.close() }
}
