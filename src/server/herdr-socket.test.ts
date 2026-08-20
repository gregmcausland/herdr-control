import { describe, expect, it } from "vitest";
import { worktreeInventoryFromResponse } from "./herdr-socket";

describe("Herdr worktree inventory", () => {
  it("parses Herdr's repository source and worktree records", () => {
    expect(worktreeInventoryFromResponse({
      result: {
        source: {
          repo_key: "/projects/control/.git",
          repo_name: "control",
          repo_root: "/projects/control",
          source_checkout_path: "/projects/control",
          source_workspace_id: "w1",
        },
        worktrees: [{
          path: "/projects/control",
          label: "control",
          branch: "main",
          is_bare: false,
          is_detached: false,
          is_linked_worktree: false,
          is_prunable: false,
          open_workspace_id: "w1",
        }],
      },
    })).toEqual({
      repo_key: "/projects/control/.git",
      repo_name: "control",
      repo_root: "/projects/control",
      source_checkout_path: "/projects/control",
      source_workspace_id: "w1",
      worktrees: [{
        path: "/projects/control",
        label: "control",
        branch: "main",
        is_bare: false,
        is_detached: false,
        is_linked_worktree: false,
        is_prunable: false,
        open_workspace_id: "w1",
      }],
    });
  });

  it("rejects a response without stable repository identity", () => {
    expect(worktreeInventoryFromResponse({ result: { source: {}, worktrees: [] } })).toBeUndefined();
  });

  it("rejects an entire partial inventory rather than implying a Worktree was removed", () => {
    expect(worktreeInventoryFromResponse({
      result: {
        source: {
          repo_key: "/projects/control/.git",
          repo_name: "control",
          repo_root: "/projects/control",
          source_checkout_path: "/projects/control",
        },
        worktrees: [{ path: "/projects/control", label: "control" }],
      },
    })).toBeUndefined();
  });
});
