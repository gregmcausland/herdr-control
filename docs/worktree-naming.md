# Worktree naming through a local agent CLI

Herdr Control can name a newly created worktree from its first accepted composer
message. The coding agent can be Codex, Pi, or any other supported agent. Control
runs a separate headless naming command and gives Herdr an ordinary
`workspace.rename` command. The checkout folder and Git branch keep their names.

The checkout picker shows the saved purpose above the branch. Existing worktrees
are not renamed retroactively. An explicit label at creation skips generation.
Naming currently observes messages sent through Control's conversation composer;
terminal input and initial prompts supplied by other API clients do not trigger it.

## Advanced host configuration

Create `~/.config/herdr-control/naming.json` on the host running the bridge:

```json
{
  "enabled": true,
  "executable": "codex",
  "model": "gpt-5.6-luna",
  "timeoutMs": 60000
}
```

`XDG_CONFIG_HOME` is respected. `HERDR_CONTROL_NAMING_CONFIG` can select another
file. These are host settings, shared by browsers using that bridge. The file is
read for each naming job, so changing the model, timeout, command, or enabled flag
does not require a restart. An absent file disables naming. Keep machine-specific
configuration outside the checkout.

The default runner requires Codex authenticated with ChatGPT under the bridge's
service account. Check with `codex login status`. It forces ChatGPT authentication,
removes API-key variables from the subprocess environment, and never falls back
to the voice API configuration. It consumes the account's Codex allowance; it is
not on-device inference. Model access and account limits still apply.

The runner uses `codex exec --ephemeral --ignore-user-config`, a temporary working
directory, read-only permissions, disabled shell/apps/subagents, a short naming
instruction, and a JSON output schema. It does not load the project's files or
conversation history. The first 2,000 characters of the message are enough for
this task. Codex still has some fixed context overhead.

The installed CLI was verified with `gpt-5.6-luna` on 2026-09-06. CLI authentication
and non-interactive output are documented in [OpenAI's non-interactive guide](https://developers.openai.com/codex/noninteractive).

## Using another locally authenticated command

Set `executable` and `args` to use another CLI or a small wrapper:

```json
{
  "enabled": true,
  "executable": "/home/user/bin/name-worktree",
  "args": ["--model", "{model}"],
  "model": "your-model"
}
```

The command receives a naming instruction and task data on stdin. It must return
only `{"label":"A short purpose"}` on stdout and exit successfully. Put diagnostics
on stderr. `{model}` is substituted within each argument; no shell is involved.
Custom commands own their authentication and tool configuration. Use the CLI's
subscription login if that is how the task should be charged. Control supplies
no voice/API credentials to custom commands either.

## Limits and failures

Only a new worktree created by Control without an explicit label is eligible.
Its first accepted composer message claims the naming attempt durably. Duplicate
messages, later threads, and bridge restarts do not generate another label. A
disabled, failed, interrupted, or timed-out attempt is not automatically retried.

Jobs run one at a time, with at most 32 waiting or running jobs. Output is limited
to 16 KiB and labels to 80 characters. A failure keeps the existing name and logs
a short diagnostic without the message or subprocess output. Conversation
delivery does not wait for naming. A workspace renamed during inference is left
alone. The saved purpose remains available when the checkout is closed.

Run `npm run typecheck`, `npm test`, and `npm run test:browser:mock`. The naming
tests use substitute commands and Herdr transport, so they do not consume an
account's inference allowance or control real agents.
