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
```

Changes to Herdr, terminal, agent, browser, Node.js, or SQLite integration must
also follow the relevant checks in [external seam maintenance](docs/maintenance.md).
The browser suite controls a real isolated Herdr pane and needs the explicit
environment described in the README.

Keep changes focused. Add tests for behavior that could regress, but avoid tests
that only repeat TypeScript or implementation details.
