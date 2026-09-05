# Herdr Control

Herdr Control provides remote access to Herdr state and running panes while preserving a clear distinction between terminal interaction and higher-level supervision.

## Language

**Terminal surface**:
A faithful interactive representation of a pane terminal, preserving terminal output and input semantics for shells and full-screen TUIs.
_Avoid_: Transcript view, pane reader

**Pane observation**:
A server-owned text or styled-text snapshot of a pane intended for inspection. It is not a semantic transcript or a presentation model.
_Avoid_: Message history, terminal surface

**Orchestration surface**:
A higher-level interface for supervising Herdr work through semantic state and actions rather than reconstructing meaning from terminal presentation.
_Avoid_: Cleaned terminal, parsed TUI

**Runtime projection**:
Control's current interpretation of an authoritative Herdr snapshot, enriched with durable identity, history, and lifecycle intent. It never independently asserts that a Herdr runtime exists.
_Avoid_: Runtime database, cached truth, Herdr mirror

**Control Host**:
A saved name and URL for one Herdr Control bridge. It is durable configuration and does not assert that the bridge or its Herdr runtime is currently available.
_Avoid_: Credential, server, live host

**Home bridge**:
The Control bridge whose URL serves the browser client and which owns the Control Host list. It is a user-chosen installation, not a hosted Control service.
_Avoid_: Central server, cloud service, Control Host

**Project**:
A durable working context for one repository, its Threads, and any related Worktrees. A Project exists whether or not it currently has a Project Runtime or any Worktrees.
_Avoid_: Workspace, repository, pane group

**Project recency**:
The start time of a Project's latest Run. This metadata does not determine home ordering. Home lists non-empty groups by Project name and host, with Threads newest first by their original creation date. Empty Projects remain in the Project picker.
_Avoid_: Browser interaction, Project update, workspace focus

**Project Runtime**:
The replaceable set of Herdr workspaces currently hosting a Project's Worktree Runtimes. A Project may span workspaces, and one workspace may host multiple Worktrees; neither layout is the Project's identity.
_Avoid_: Project, persistent workspace

**Worktree**:
A durable, optional repository checkout belonging to one Project. It may provide the working context for Threads and exists independently of its Worktree Runtime.
_Avoid_: Project, workspace, pane

**Worktree Runtime**:
The optional association between one Worktree and a Herdr workspace hosting its live Runs. Multiple Worktree Runtimes may share a workspace.
_Avoid_: Worktree, Project Runtime, Thread

**Thread**:
A durable unit of agent work belonging to one Project. It may be associated with a Worktree. Its identity and captured conversation survive the end of a Run, even without an agent session reference.
_Avoid_: Pane, tab, agent session

**Run**:
One execution of a Thread using transient Herdr resources. A resumed Thread begins a new Run rather than recreating an earlier pane.
_Avoid_: Thread, agent session, conversation

**Working period**:
A continuous interval within a Run while its agent reports Working. Active working time appears on home and in the conversation's animated working strip. Idle rows do not display the previous period's duration as though it were time spent idle.
_Avoid_: Run duration, pane age, session duration

**Retained Run**:
A Run that Herdr keeps alive when a stop request cannot safely retire its Worktree Runtime. Archiving alone does not request retirement.
_Avoid_: Orphaned pane, archived pane

**Agent session reference**:
An opaque provider-issued identifier or path used to continue an agent conversation in a later Run.
_Avoid_: Run ID, pane ID, Thread ID

**Archived Thread**:
A Thread removed from active orchestration views. Archiving changes visibility only; stopping its agent is a separate action. Captured history does not expire automatically.
_Avoid_: Deleted pane, closed Thread

**Restorable Thread**:
An Archived Thread with no current Run whose agent session reference can begin a new Run. Restore is an optional capability of an Archived Thread.
_Avoid_: Archived pane, reopened Run, Thread without a session reference

**Adopted Thread**:
A Thread recorded after discovering an agent Run that Herdr Control did not launch. Once adopted, it has the same durable identity and controls as any other Thread.
_Avoid_: Unmanaged pane, imported session

**Conversation**:
Durable user messages and completed agent replies associated with a Thread. Capture observes the Herdr-owned agent through provider hooks; it does not infer messages from terminal output. It begins when capture is installed and may contain gaps.
_Avoid_: Full transcript, terminal recording

**Delivery receipt**:
A durable record keyed by the browser's submission ID. Acknowledged means Herdr accepted the prompt. Uncertain means acceptance could not be established and Control must not automatically repeat it.
_Avoid_: Completed task, exactly-once agent execution

**Pane deletion**:
Removing a transient non-agent pane from active orchestration without creating a Thread. Its runtime may remain pending retirement.
_Avoid_: Archive, delete Thread

**Thread deletion**:
Permanently removing a Thread that has no agent session reference and therefore cannot be restored. Its current Run may remain pending safe retirement, but no archived history is retained.
_Avoid_: Archive, Pane deletion
