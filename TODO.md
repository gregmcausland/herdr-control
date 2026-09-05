# Herdr Control todo

## Now

- [x] Replace the mobile terminal paste-and-delayed-Enter workaround with native
  Herdr message sending.
  - Send messages to the active Thread through Herdr's `agent.prompt` command.
  - Do not require terminal control to send a message.
  - Keep the draft until Herdr acknowledges the message.
  - Show sending and failure states, and leave failed messages ready to retry.
  - Add repeatable browser coverage for mobile sending, disconnects, and failures.

- [x] Keep the Project view's recent history bounded.
  - Keep recently completed Threads in the Project view so they remain easy to
    restore.
  - Let recent items fall off the Project view after a few days.
  - Put the complete retained archive on its own screen.
  - Recent history is 7 days. The full archive no longer expires conversations.

- [x] Make conversations the default Thread surface while keeping Herdr as runtime.
  - Capture completed Codex, Claude, and Pi replies through host integrations.
  - Persist messages and send receipts; preserve drafts and cached replies on phones.
  - Load the terminal only when opened, recover stalled attachments, and preserve ownership.
  - Keep empty Projects and non-resumable Threads; separate archiving from stopping.

- [ ] Validate reply hooks against installed agent versions and test on a physical
  iPhone/Safari. Add more agent adapters as structured reply hooks become available.

- [x] Restore Alien MZ from a persistent checkout, preserve its existing state,
  and verify the bridge through its Tailscale address.
