# Herdr is the runtime authority

Herdr Control treats each complete Herdr snapshot as authoritative for live runtime existence and location. Control persists durable identity, history, and lifecycle intent, then deterministically projects those concepts over the snapshot; it may deliberately hide retained runtimes, but it never uses persisted state to invent live Herdr resources.

This keeps Control recoverable through full reconciliation after missed events or restarts while allowing Projects, Worktrees, Threads, and Runs to outlive Herdr's transient layout.

## Reconciliation invariants

- Events only invalidate the projection. A complete snapshot, not event order, determines current runtime state; a snapshot invalidated while it is being read is discarded before it can mutate durable state.
- A live Run is matched by Herdr terminal identity. Pane, tab, and workspace IDs are mutable locators.
- A missing terminal ends its Run in the same database transaction. A Thread with an agent session reference is archived; one without a reference is deleted because it cannot be restored.
- A changed agent session in an existing terminal ends the old Run before adopting the replacement.
- Project and Worktree identity comes from Herdr's repository inventory. An invalid or partial inventory is ignored rather than interpreted as deletion.
- One workspace may host multiple Worktrees. Pane CWD selects the most specific checkout; workspace association is only a fallback when unambiguous.
- Projects, Worktrees, restorable Threads, Runs, and runtime history are retained when their Herdr resources disappear. Threads that never gain an agent session reference are not retained after deletion or runtime loss.
- Contradictory snapshots and damaged database references fail closed, leaving the last published projection stale rather than committing a partial reconciliation.
