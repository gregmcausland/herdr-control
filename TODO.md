# Herdr Control todo

## Now

- [x] Replace the mobile terminal paste-and-delayed-Enter workaround with native
  Herdr message sending.
  - Send messages to the active Thread through Herdr's `agent.prompt` command.
  - Do not require terminal control to send a message.
  - Keep the draft until Herdr acknowledges the message.
  - Show sending and failure states, and leave failed messages ready to retry.
  - Add repeatable browser coverage for mobile sending, disconnects, and failures.

- [x] Keep home focused on open work.
  - Sort Projects by name and host, independent of working status.
  - Sort Threads by original creation date, preserving order through restores.
  - Keep empty Projects in All projects and the New thread picker.
  - Put all history in Archive, sorted by archive date without automatic expiry.

- [x] Make conversations the default Thread surface while keeping Herdr as runtime.
  - Capture completed Codex, Claude, and Pi replies through host integrations.
  - Persist messages and send receipts; preserve drafts and cached replies on phones.
  - Load the terminal only when opened, recover stalled attachments, and preserve ownership.
  - Keep empty Projects and non-resumable Threads; separate archiving from stopping.

- [ ] Validate reply hooks against installed agent versions and test on a physical
  iPhone/Safari. Add more agent adapters as structured reply hooks become available.

- [x] Make New thread usable on phones and handle asynchronous agent detection.
  - Keep options and actions inside the visible keyboard viewport.
  - Validate agent and checkout choices; preserve drafts on launch errors.
  - Wait for explicit Herdr readiness before sending the first prompt.
  - Cover submission through the real backend with an isolated Herdr transport.

- [x] Bring conversation styling and working feedback in line with home.
  - Reuse the working shader above the composer, with elapsed time and reduced motion.
  - Keep session controls in Thread actions and the terminal as a drill-down.
  - Preserve reading position through keyboard resizing; keep Jump to latest accessible.
  - Check working, completed, disconnected, light-theme, and narrow-phone layouts.

- [ ] Preserve meaningful Thread titles independently of terminal title changes.
- [ ] Track read position by message identity before adding unread-reply indicators.

- [x] Restore Alien MZ from a persistent checkout, preserve its existing state,
  and verify the bridge through its Tailscale address.
