import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ConversationMessage, MessageDelivery, ThreadInfo } from "../shared/protocol.js";

export interface CapturedMessage {
  event_id: string;
  agent: string;
  session_id?: string;
  session_path?: string;
  pane_id: string;
  socket_path: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
}

type Row = Omit<ConversationMessage, "delivery" | "error"> & { delivery: MessageDelivery | null; error: string | null };

/** Retains conversation history and send receipts independently of browser connections. */
export class ConversationStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS conversation_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivery TEXT,
        error TEXT,
        event_id TEXT UNIQUE
      );
      CREATE INDEX IF NOT EXISTS conversation_thread ON conversation_messages(thread_id, sequence);
      UPDATE conversation_messages SET delivery = 'uncertain',
        error = 'The bridge restarted before delivery was confirmed. Check the agent before sending again.'
        WHERE delivery = 'sending';
    `);
  }

  get(id: string): ConversationMessage | undefined {
    const row = this.database.prepare("SELECT * FROM conversation_messages WHERE message_id = ?").get(id) as unknown as Row | undefined;
    return row ? message(row) : undefined;
  }

  list(threadId: string, before = Number.MAX_SAFE_INTEGER, limit = 100) {
    const rows = this.database.prepare(`SELECT * FROM conversation_messages
      WHERE thread_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?`)
      .all(threadId, before, limit + 1) as unknown as Row[];
    return { messages: rows.slice(0, limit).reverse().map(message), has_older: rows.length > limit };
  }

  begin(threadId: string, id: string, text: string): ConversationMessage {
    this.database.prepare(`INSERT INTO conversation_messages
      (message_id, thread_id, role, text, source, created_at, delivery)
      VALUES (?, ?, 'user', ?, 'control', ?, 'sending')`).run(id, threadId, text, new Date().toISOString());
    return this.get(id)!;
  }

  delivery(id: string, delivery: MessageDelivery, error?: string): ConversationMessage {
    this.database.prepare("UPDATE conversation_messages SET delivery = ?, error = ? WHERE message_id = ?")
      .run(delivery, error ?? null, id);
    return this.get(id)!;
  }

  captured(threadId: string, event: CapturedMessage): void {
    if (this.database.prepare("SELECT 1 FROM conversation_messages WHERE event_id = ?").get(event.event_id)) return;
    // Match the provider's echo to exactly one recent Control submission. Repeated
    // identical desktop prompts remain separate after that receipt is claimed.
    if (event.role === "user") {
      const candidates = this.database.prepare(`SELECT message_id, text FROM conversation_messages
        WHERE thread_id = ? AND source = 'control' AND event_id IS NULL
        AND delivery IN ('sending', 'acknowledged', 'uncertain')
        AND ABS(julianday(created_at) - julianday(?)) * 86400 < 60
        ORDER BY sequence`).all(threadId, event.created_at) as Array<{ message_id: string; text: string }>;
      const sent = candidates.find((candidate) => promptIdentity(candidate.text) === promptIdentity(event.text));
      if (sent) {
        this.database.prepare("UPDATE conversation_messages SET event_id = ? WHERE message_id = ?")
          .run(event.event_id, sent.message_id);
        return;
      }
    }
    this.database.prepare(`INSERT INTO conversation_messages
      (message_id, thread_id, role, text, source, created_at, event_id)
      VALUES (?, ?, ?, ?, 'agent', ?, ?)`)
      .run(randomUUID(), threadId, event.role, event.text, event.created_at, event.event_id);
  }

  hasCapture(threadId: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM conversation_messages WHERE thread_id = ? AND event_id IS NOT NULL LIMIT 1").get(threadId));
  }

  close() { this.database.close(); }
}

// Providers may trim a submitted prompt or normalise its line endings. Preserve
// stored text and meaningful internal whitespace; only echo comparison changes.
function promptIdentity(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function message(row: Row): ConversationMessage {
  return { ...row, delivery: row.delivery ?? undefined, error: row.error ?? undefined };
}

/** Provider session identity wins over mutable pane locators, including delayed captures. */
export function capturedThread(event: CapturedMessage, threads: ThreadInfo[]): ThreadInfo | undefined {
  const matching = threads.filter((thread) => thread.agent === event.agent && thread.agent_session
    && [event.session_id, event.session_path].includes(thread.agent_session.value));
  if (matching.length === 1) return matching[0];
  if (matching.length > 1) return undefined;
  return threads.find((thread) => thread.agent === event.agent && !thread.agent_session
    && thread.current_run?.pane_id === event.pane_id
    && thread.current_run.started_at <= event.created_at);
}
