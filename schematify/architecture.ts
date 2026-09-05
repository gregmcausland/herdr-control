async function main() {
  const doc = graph("8793c4da-4e19-41dc-8a55-e164bf42f08a")
    .label("Herdr Control architecture")
    .description(
      "A browser client connects directly to one Control bridge on each configured machine. Each bridge projects authoritative Herdr runtime snapshots into durable project and thread state, exposes orchestration over HTTP and SSE, and proxies interactive terminals over WebSocket.",
    )
    .children([
      node("operator")
        .label("Operator")
        .type("actors/user")
        .attributes({
          description: "Supervises coding agents and controls their Herdr terminals from a desktop or phone browser.",
        })
        .links(["browser/app"]),

      node("browser")
        .label("Browser client")
        .type("microservices/subsystem")
        .attributes({
          description: "React and xterm.js single-page application served by the selected Home bridge.",
          source: "src/client",
        })
        .children([
          node("app")
            .label("Orchestration UI")
            .type("microservices/service")
            .attributes({
              description: "Groups live panes by Project, starts Threads, and manages archive, restore, deletion, Hosts, and settings.",
              source: "src/client/App.tsx, src/client/orchestration-state.ts",
            })
            .links(["bridges/http-api", "browser/session-feeds", "browser/terminal-surface"]),
          node("session-feeds")
            .label("Multi-host session feeds")
            .type("microservices/service")
            .attributes({
              description: "Keeps an independent SSE connection and last valid snapshot for every configured Control Host.",
              source: "src/client/live-session.ts, src/client/host-session-feeds.ts",
            })
            .links(["bridges/sse-feed"]),
          node("terminal-surface")
            .label("xterm.js terminal surface")
            .type("microservices/service")
            .attributes({
              description: "Renders terminal frames and sends input, keys, resize, scroll, observation, control, and takeover commands.",
              source: "src/client/TerminalView.tsx, src/client/terminal-input.ts",
            })
            .links(["bridges/terminal-gateway"]),
          node("browser-settings")
            .label("Browser settings")
            .type("base/configuration")
            .attributes({
              description: "Stores theme, font, cursor, and new-Thread defaults in browser-local storage.",
              source: "src/client/settings.ts",
            }),
          node("theme-count")
            .label("Theme catalog")
            .type("base/configuration")
            .attributes({
              theme_count: 8,
              description: "The client ships with eight light and dark application and terminal themes.",
              source: "src/client/theme.ts",
            })
            .render({
              style: "property",
              params: {
                header: from.value("Built-in themes"),
                "display-value": from.attribute("theme_count"),
              },
              scale: { x: 2.5, y: 1.35 },
            }),
        ]),

      node("bridges")
        .label("Control bridges")
        .type("microservices/subsystem")
        .attributes({
          description: "A Node.js bridge runs beside each Herdr instance. The bridge that serves the browser is the Home bridge and owns the saved Control Host list.",
          deployment: "One bridge per configured Herdr machine",
          source: "src/server/index.ts, src/server/server.ts",
        })
        .children([
          node("http-api")
            .label("HTTP API and static server")
            .type("microservices/endpoint")
            .attributes({
              description: "Serves the built client and handles health, Host configuration, snapshots, Thread lifecycle actions, pane deletion, and clipboard image staging.",
              source: "src/server/server.ts",
            })
            .links([
              "bridges/thread-lifecycle",
              "bridges/control-host-store",
              "bridges/runtime-projection",
            ]),
          node("sse-feed")
            .label("SSE session feed")
            .type("microservices/endpoint")
            .attributes({
              description: "Publishes live, stale, and reconnecting projection states while retaining the last valid snapshot during Herdr outages.",
              source: "src/server/server.ts, src/server/live-session.ts",
            })
            .links(["bridges/live-session"]),
          node("terminal-gateway")
            .label("WebSocket terminal gateway")
            .type("microservices/endpoint")
            .attributes({
              description: "Validates browser terminal sessions and relays frames and control messages without storing terminal output.",
              source: "src/server/server.ts, src/server/herdr.ts",
            })
            .links(["bridges/herdr-integration/terminal-adapter"]),
          node("browser-transport-count")
            .label("Browser transport count")
            .type("microservices/endpoint")
            .attributes({
              transport_count: 3,
              description: "The browser uses HTTP for actions, SSE for live snapshots, and WebSocket for terminal sessions.",
              protocols: "HTTP, SSE, WebSocket",
              source: "src/server/server.ts",
            })
            .render({
              style: "property",
              params: {
                header: from.value("Browser transports"),
                "display-value": from.attribute("transport_count"),
              },
              scale: { x: 2.5, y: 1.35 },
            }),
          node("live-session")
            .label("Live session coordinator")
            .type("microservices/service")
            .attributes({
              description: "Turns Herdr events into snapshot invalidations, reconnects dropped subscriptions, and publishes only complete projections.",
              source: "src/server/live-session.ts",
            })
            .links([
              "bridges/herdr-integration/session-source",
              "bridges/runtime-projection",
            ]),
          node("thread-lifecycle")
            .label("Thread lifecycle service")
            .type("microservices/service")
            .attributes({
              description: "Coordinates Thread creation, archive, restore, and destructive actions against fresh Herdr truth and durable state.",
              source: "src/server/thread-lifecycle.ts",
            })
            .links([
              "bridges/runtime-projection",
              "bridges/herdr-integration/command-adapter",
            ]),
          node("runtime-projection")
            .label("Runtime projection and Thread manager")
            .type("microservices/service")
            .attributes({
              description: "Reconciles authoritative Herdr snapshots with durable Projects, Worktrees, Threads, Runs, working periods, and retirement intent.",
              source: "src/server/threads.ts, docs/adr/0001-herdr-is-runtime-authority.md",
            })
            .links(["bridges/state-db"]),
          node("control-host-store")
            .label("Home bridge Host registry")
            .type("microservices/service")
            .attributes({
              description: "Stores the names and URLs that tell the browser which bridges to contact directly. Only the selected Home bridge owns this configuration.",
              source: "src/server/control-hosts.ts, docs/adr/0002-home-bridge-owns-host-configuration.md",
            })
            .links(["bridges/state-db"]),
          node("state-db")
            .label("Control state SQLite database")
            .type("databases/default")
            .attributes({
              description: "Persists Control Hosts, Projects, Worktrees, runtime associations, Threads, Runs, lifecycle events, and pane retirement requests. It does not store terminal output.",
              technology: "Node.js built-in SQLite, WAL mode",
              source: "src/server/threads.ts, src/server/control-hosts.ts",
            }),
          node("herdr-integration")
            .label("Herdr integration")
            .type("microservices/subsystem")
            .attributes({
              description: "Translates Control's shared protocol into Herdr's documented socket and CLI interfaces.",
              source: "src/server/herdr.ts, src/server/herdr-socket.ts, src/server/herdr-protocol.ts",
            })
            .children([
              node("session-source")
                .label("Snapshot and event socket client")
                .type("microservices/service")
                .attributes({
                  description: "Subscribes to lifecycle and pane status events, then reads complete session snapshots and repository inventories over the local Unix socket.",
                })
                .links(["runtime/herdr"]),
              node("command-adapter")
                .label("Lifecycle command adapter")
                .type("microservices/service")
                .attributes({
                  description: "Creates workspaces, tabs, Worktrees, and agents, focuses or retires panes, and restores supported provider sessions.",
                })
                .links(["runtime/herdr"]),
              node("terminal-adapter")
                .label("Terminal session adapter")
                .type("microservices/service")
                .attributes({
                  description: "Runs Herdr terminal session control or observation and sends logical key actions through the local socket.",
                })
                .links(["runtime/herdr"]),
            ]),
        ]),

      node("runtime")
        .label("Local runtime on each machine")
        .type("compute/server")
        .attributes({
          description: "The machine-local runtime remains active even if its Control bridge or browser connection drops.",
        })
        .children([
          node("herdr")
            .label("Herdr runtime")
            .type("microservices/service")
            .attributes({
              description: "Owns processes, terminal sessions, workspace layout, repository inventory, live agent detection, and terminal control arbitration.",
              authority: "Source of truth for live runtime existence and location",
            })
            .links(["runtime/terminals"]),
          node("terminals")
            .label("Herdr-owned terminals")
            .type("compute/container")
            .attributes({
              description: "Shell and full-screen TUI processes continue under Herdr independently of Control.",
            })
            .links(["runtime/agent-harnesses"]),
          node("agent-harnesses")
            .label("Coding agent harnesses")
            .type("actors/service-account")
            .attributes({
              description: "Codex, Claude, Pi, Gemini, OpenCode, and other configured agents run inside Herdr terminals. Supported provider session references allow later restoration.",
            }),
          node("restorable-provider-count")
            .label("Restorable provider support")
            .type("actors/service-account")
            .attributes({
              provider_count: 3,
              description: "Control can resume Codex, Claude, and Pi sessions when Herdr reports a supported provider reference.",
              providers: "Codex, Claude, Pi",
              source: "src/server/herdr.ts",
            })
            .render({
              style: "property",
              params: {
                header: from.value("Restorable providers"),
                "display-value": from.attribute("provider_count"),
              },
              scale: { x: 2.5, y: 1.35 },
            }),
        ]),
    ]);

  await doc.publish();
}

main();
