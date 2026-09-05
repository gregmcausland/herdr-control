# Contributing

Herdr Control is still small. Please open an issue before starting a large
change so the product and protocol assumptions can be checked first.

## Local checks

Use Node.js 22.5 or newer, then run:

```bash
npm ci
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser:mock
```

Changes to Herdr, terminal, agent, browser, Node.js, or SQLite integration must
also follow the relevant checks in [external seam maintenance](docs/maintenance.md).
The mock browser suite validates conversations, creation, multi-host state,
keyboard layouts, and working animations without contacting live agents. It
includes a launch test with the real backend and a substituted Herdr transport.

Use `npm run test:browser:readonly` with `HERDR_CONTROL_READONLY_URL` to inspect
a deployment without sending messages or attaching terminals. The separate live
interaction suite controls an isolated Herdr pane and needs the explicit
environment described in the README. Never aim those mutation tests at ongoing work.

For UI changes, inspect the rendered page in Playwright as well as running
assertions. Check phone and desktop sizes, working and disconnected states, and
the keyboard viewport when changing inputs. Keep development and managed service
checkouts separate, and update every configured bridge before live validation.

Keep changes focused. Add tests for behavior that could regress, but avoid tests
that only repeat TypeScript or implementation details.
