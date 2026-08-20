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

**Project**:
A durable working context for one repository and its related Worktrees. A Project owns its Worktrees and exists whether or not it currently has a Project Runtime.
_Avoid_: Workspace, repository, pane group

**Project Runtime**:
The optional, replaceable Herdr workspace currently hosting a Project's Worktree Runtimes. It is an execution resource, never the Project's identity.
_Avoid_: Project, persistent workspace

**Worktree**:
A durable repository checkout belonging to one Project. It owns the Threads performed in that checkout and exists independently of its Worktree Runtime.
_Avoid_: Project, workspace, pane

**Worktree Runtime**:
The optional Herdr worktree context hosting live Runs for one Worktree inside a Project Runtime.
_Avoid_: Worktree, Project Runtime, Thread

**Thread**:
A durable unit of agent work belonging to one Worktree that retains its identity and history across periods of execution and inactivity.
_Avoid_: Pane, tab, agent session

**Run**:
One execution of a Thread using transient Herdr resources. A resumed Thread begins a new Run rather than recreating an earlier pane.
_Avoid_: Thread, agent session, conversation

**Retained Run**:
A Run kept alive to preserve its Worktree Runtime after its Thread has been archived. It is absent from active orchestration views and remains eligible for deferred retirement.
_Avoid_: Orphaned pane, archived pane

**Agent session reference**:
An opaque provider-issued identifier or path used to continue an agent conversation in a later Run.
_Avoid_: Run ID, pane ID, Thread ID

**Archived Thread**:
A retained Thread removed from active orchestration views. Archiving is a Control lifecycle state and does not require its current Run or Project Runtime to be retired.
_Avoid_: Deleted pane, closed Thread

**Restorable Thread**:
An Archived Thread with no current Run and a trusted agent session reference that can begin a new Run. Archive is always available for agent Threads; restore is an optional capability.
_Avoid_: Archived pane, reopened Run

**Adopted Thread**:
A Thread recorded after discovering an agent Run that Herdr Control did not launch. Once adopted, it has the same durable identity and controls as any other Thread.
_Avoid_: Unmanaged pane, imported session

**Pane deletion**:
Removing a transient non-agent pane from active orchestration without creating a Thread. Its runtime may remain pending retirement.
_Avoid_: Archive, delete Thread
