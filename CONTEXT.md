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

**Project**:
A durable working context for one repository, its Threads, and any related Worktrees. A Project exists whether or not it currently has a Project Runtime or any Worktrees.
_Avoid_: Workspace, repository, pane group

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
A unit of agent work belonging to one Project. It may be associated with a Worktree and becomes eligible for durable retention once it has an agent session reference.
_Avoid_: Pane, tab, agent session

**Run**:
One execution of a Thread using transient Herdr resources. A resumed Thread begins a new Run rather than recreating an earlier pane.
_Avoid_: Thread, agent session, conversation

**Working period**:
A continuous interval within a Run while its agent reports Working. It is the user-facing measure of how long the latest piece of active work took.
_Avoid_: Run duration, pane age, session duration

**Retained Run**:
A Run kept alive to preserve its Worktree Runtime after its Thread has been archived. It is absent from active orchestration views and remains eligible for deferred retirement.
_Avoid_: Orphaned pane, archived pane

**Agent session reference**:
An opaque provider-issued identifier or path used to continue an agent conversation in a later Run.
_Avoid_: Run ID, pane ID, Thread ID

**Archived Thread**:
A retained Thread with an agent session reference that has been removed from active orchestration views. Archiving is a Control lifecycle state and does not require its current Run or Project Runtime to be retired.
_Avoid_: Deleted pane, closed Thread

**Restorable Thread**:
An Archived Thread with no current Run whose agent session reference can begin a new Run. Restore is an optional capability of an Archived Thread.
_Avoid_: Archived pane, reopened Run, Thread without a session reference

**Adopted Thread**:
A Thread recorded after discovering an agent Run that Herdr Control did not launch. Once adopted, it has the same durable identity and controls as any other Thread.
_Avoid_: Unmanaged pane, imported session

**Pane deletion**:
Removing a transient non-agent pane from active orchestration without creating a Thread. Its runtime may remain pending retirement.
_Avoid_: Archive, delete Thread

**Thread deletion**:
Permanently removing a Thread that has no agent session reference and therefore cannot be restored. Its current Run may remain pending safe retirement, but no archived history is retained.
_Avoid_: Archive, Pane deletion
