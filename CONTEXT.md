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
