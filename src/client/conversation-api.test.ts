import { expect, it } from "vitest";
import { readConversationResponse } from "./conversation-api";

it("explains an old bridge's HTML fallback instead of leaking a JSON parser error", async () => {
  await expect(readConversationResponse(new Response("<!doctype html><html></html>", {
    headers: { "content-type": "text/html" },
  }), "thread-1")).rejects.toThrow("Update and restart its Control bridge");
});

it("rejects malformed JSON and incompatible conversation records before rendering", async () => {
  await expect(readConversationResponse(new Response('{"thread":', {
    headers: { "content-type": "application/json" },
  }), "thread-1")).rejects.toThrow("invalid JSON");
  await expect(readConversationResponse(Response.json({ thread: { thread_id: "thread-1" }, messages: [null] }), "thread-1"))
    .rejects.toThrow("incompatible conversation data");
  await expect(readConversationResponse(Response.json({ error: "Thread not found" }, { status: 404 }), "thread-1"))
    .rejects.toThrow("Thread not found");
});
