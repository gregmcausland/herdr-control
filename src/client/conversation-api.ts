import type { ConversationSnapshot } from "../shared/protocol";

/** Old bridges can return app HTML for an API route they do not recognize. */
export async function readApiResponse(response: Response): Promise<any> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("This host returned a web page instead of API data. Update and restart its Control bridge, then reload.");
  }
  let body;
  try { body = await response.json(); }
  catch { throw new Error("The host returned invalid JSON. Update and restart its Control bridge, then reload."); }
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `The host rejected this request (${response.status}).`);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("The host returned an invalid API response.");
  return body;
}

export async function readConversationResponse(response: Response, threadId: string): Promise<ConversationSnapshot> {
  const body = await readApiResponse(response);
  if (body.thread?.thread_id !== threadId || typeof body.thread.title !== "string"
    || !Array.isArray(body.messages) || typeof body.has_older !== "boolean" || typeof body.capture_available !== "boolean"
    || !body.messages.every((message: any) => message && typeof message.message_id === "string"
      && message.thread_id === threadId && Number.isSafeInteger(message.sequence)
      && ["user", "assistant"].includes(message.role) && typeof message.text === "string"
      && typeof message.created_at === "string" && Number.isFinite(Date.parse(message.created_at)))) {
    throw new Error("The host returned incompatible conversation data. Update and restart its Control bridge, then reload.");
  }
  return body;
}
