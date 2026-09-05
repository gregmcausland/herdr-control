import type { ConversationSnapshot } from "../shared/protocol";

export interface ConversationDraft { text: string; messageId: string }
const key = (host: string, thread: string, part: string) => `herdr-control:${part}:${host}:${thread}`;

export function readDraft(host: string, thread: string): ConversationDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key(host, thread, "draft")) ?? "null");
    if (typeof value?.text === "string" && typeof value.messageId === "string") return value;
  } catch { /* Storage may be unavailable in private browsing. */ }
  return { text: "", messageId: crypto.randomUUID() };
}

export function storeDraft(host: string, thread: string, draft: ConversationDraft) {
  try { localStorage.setItem(key(host, thread, "draft"), JSON.stringify(draft)); return true; } catch { return false; }
}

export function readConversation(host: string, thread: string): ConversationSnapshot | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key(host, thread, "conversation")) ?? "null");
    if (value?.thread?.thread_id === thread && Array.isArray(value.messages)) return value;
  } catch { /* A fresh host read can replace an unavailable browser cache. */ }
  return undefined;
}

export function storeConversation(host: string, thread: string, value: ConversationSnapshot) {
  try {
    localStorage.setItem(key(host, thread, "conversation"), JSON.stringify({ ...value, messages: value.messages.slice(-100), has_older: value.has_older || value.messages.length > 100 }));
  } catch { /* Durable history remains on the host. */ }
}

export function readPosition(host: string, thread: string): number | undefined {
  try {
    const value = localStorage.getItem(key(host, thread, "position"));
    return value === null ? undefined : Number(value);
  } catch { return undefined; }
}

export function storePosition(host: string, thread: string, position: number) {
  try { localStorage.setItem(key(host, thread, "position"), String(position)); } catch { /* Optional preference. */ }
}
