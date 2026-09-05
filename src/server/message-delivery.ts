import type { ConversationMessage } from "../shared/protocol.js";
import type { ConversationStore } from "./conversations.js";
import { HerdrRequestError } from "./herdr-socket.js";
import { ThreadNotFoundError } from "./threads.js";
import { ThreadNotPromptableError, type ThreadLifecycleService } from "./thread-lifecycle.js";

export class MessageConflictError extends Error {}

/** A request ID is a receipt, never an instruction to repeat an uncertain side effect. */
export class MessageDeliveryService {
  constructor(private readonly store: ConversationStore, private readonly lifecycle: ThreadLifecycleService, private readonly live: () => boolean) {}

  async send(threadId: string, id: string, text: string, retry = false): Promise<ConversationMessage> {
    const previous = this.store.get(id);
    if (previous && (previous.thread_id !== threadId || previous.text !== text || previous.source !== "control")) {
      throw new MessageConflictError("This message ID belongs to another submission");
    }
    if (previous && !(retry && previous.delivery === "failed")) return previous;
    if (!this.live()) throw new ThreadNotPromptableError("The host is reconnecting. Your draft is saved; send it when the host is live.");
    if (previous) this.store.delivery(id, "sending");
    else this.store.begin(threadId, id, text);
    try {
      await this.lifecycle.prompt(threadId, text);
      return this.store.delivery(id, "acknowledged");
    } catch (error) {
      const rejected = error instanceof ThreadNotFoundError || error instanceof ThreadNotPromptableError
        || (error instanceof HerdrRequestError && ["agent_not_found", "agent_blocked", "pane_not_found", "invalid_params", "agent_not_ready"].includes(error.code));
      return this.store.delivery(id, rejected ? "failed" : "uncertain", rejected
        ? (error as Error).message
        : "Delivery could not be confirmed. Check the agent before sending this message again.");
    }
  }
}
