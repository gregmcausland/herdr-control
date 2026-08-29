# Herdr Control todo

## Now

- [x] Replace the mobile terminal paste-and-delayed-Enter workaround with native
  Herdr message sending.
  - Send messages to the active Thread through Herdr's `agent.prompt` command.
  - Do not require terminal control to send a message.
  - Keep the draft until Herdr acknowledges the message.
  - Show sending and failure states, and leave failed messages ready to retry.
  - Add repeatable browser coverage for mobile sending, disconnects, and failures.

- [x] Turn the archive into bounded recent history.
  - Keep recently completed Threads in the Project view so they remain easy to
    restore.
  - Let recent items fall off the Project view after a few days.
  - Put the complete retained archive on its own screen.
  - Permanently purge archived Threads after a defined retention period so the
    archive cannot grow forever. Recent history is 7 days and retention is 30 days.

- [x] Restore Alien MZ from a persistent checkout, preserve its existing state,
  and verify the bridge through its Tailscale address.
