# Conversations observe Herdr agents

Control's default Thread page presents locally retained user messages and completed
agent replies. Herdr continues to own every agent process. Capture hooks observe
the existing Codex, Claude, and Pi sessions; they never start a second agent or
parse terminal redraws as conversation history.

Capture runs on the host and writes an atomic local spool record before returning.
The bridge imports records by provider session identity, so replies survive browser
disconnects and bridge downtime. Missing capture is visible, not invented history.
User messages written in Control have durable request IDs. An uncertain upstream
delivery is never automatically retried.

Terminal attachment is an explicit drill-down. Reading and composing do not take
terminal ownership or change Herdr focus. A disconnected bridge leaves retained
history readable but cannot assert that a stored Run is still alive.

Archive changes visibility, not process lifetime. Stopping execution is a separate
action. Threads without resume references remain readable, and conversation records
do not expire automatically. Resume is a capability of a stopped Thread.

The first milestone captures completed replies, not token streaming or a complete
tool transcript. Agent-specific hooks capture desktop prompts where available.
