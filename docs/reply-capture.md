# Reply capture

Control reads completed replies from agents already running inside Herdr. Herdr
still launches and owns those processes. Opening a conversation neither acquires
terminal control nor changes desktop focus. Shells and agents without capture
remain accessible through the terminal.

## Install on each agent host

From the updated Control checkout, run:

```bash
npm run control -- capture-install
```

This adds independent hooks to `~/.codex/hooks.json` and
`~/.claude/settings.json`, and an extension at
`~/.pi/agent/extensions/herdr-control/`. Existing unrelated settings and Herdr
integrations are preserved. Changed JSON files receive timestamped backups.
`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `PI_CODING_AGENT_DIR` override agent homes.

If the bridge uses a custom database, supply the **same absolute path** when
installing. The command does not read the systemd service's environment file:

```bash
HERDR_CONTROL_STATE=/absolute/path/control.db npm run control -- capture-install
```

Start a new Codex or Claude session for newly installed hooks to take effect.
In Codex, open `/hooks` and review/trust the new definitions; current Codex skips
untrusted hooks. Changes to hook definitions require review again.
Pi can load its extension with `/reload`; a reply already in progress may not be
captured until the next response. No running process is restarted by the installer.
Keep Herdr's own integrations installed for status and resume references.

Capture requires versions that expose the events below. If an older agent lacks
them, its terminal and Control message composer still work, but replies may be
absent. Capture starts at installation; there is no historical transcript import.

## Provider contracts

| Agent | User prompt | Completed assistant reply |
| --- | --- | --- |
| Codex | `UserPromptSubmit.prompt` | `Stop.last_assistant_message` |
| Claude | `UserPromptSubmit.prompt` | `Stop.last_assistant_message` |
| Pi | User `message_end` | Last assistant message with `stopReason: stop`, emitted at `agent_settled` while idle |

Contracts: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude hooks](https://code.claude.com/docs/en/hooks), and
[Pi extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md).
These hooks expose completed responses, not proof the user's entire task is done.
Tool calls, reasoning, permission dialogs, and partial output remain in the terminal.
Pi capture accepts TUI mode only, and Claude subagent hooks are ignored.

## Storage and delivery

Hooks write atomic JSON files under `capture/` beside the Control database, even
while the bridge is down. The bridge imports them into SQLite about once a second,
matching the Herdr socket and provider session reference. Capture for an agent
not yet adopted remains queued. Invalid records are renamed `.invalid` for
inspection. Browser conversations refresh about every 2.5 seconds while visible.

The browser saves drafts and the latest 100 messages on that device. Host-side
history is paginated and has no automatic expiry. Browser storage must be available
to preserve local drafts. The application itself must already be loaded to read
cached messages when its serving host is unreachable; there is no offline app shell.

Every Control submission has a stable receipt ID before sending. Repeating the
same request returns its receipt instead of submitting again. **Sent to agent**
means Herdr acknowledged the prompt. **Failed** permits an explicit retry.
**Delivery uncertain** means Herdr may have accepted it: inspect the agent before
editing or sending it again. Control does not automatically replay uncertain
messages, including after a bridge restart. Captured desktop prompts are merged
with matching recent Control messages where possible.

## Check an installation

Send one short prompt in a disposable Herdr agent session, let the response
finish, and open its Thread in Control. Check that both the prompt and reply
appear without opening the terminal. Repeat with the browser closed, and with
the bridge stopped and restarted. Then test one Control submission.

If no messages appear, inspect the host's `capture/` directory and bridge logs.
Check that the agent inherited `HERDR_ENV=1`, `HERDR_PANE_ID`, and
`HERDR_SOCKET_PATH`, and that capture and the bridge use the same state directory.
The agent's reported session reference must match its capture record. A pane
that disappeared before Control ever discovered it cannot be assigned safely.
The “no messages captured” notice is based on observed records, not an installation
health probe.

Rerun the installer after updating capture code. To remove capture, remove only
the hook commands ending in `integrations/capture.mjs` and the Pi
`extensions/herdr-control` folder. Leave unrelated Herdr hooks intact.
