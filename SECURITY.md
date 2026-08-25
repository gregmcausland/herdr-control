# Security

Herdr Control can type into terminals and start coding agents with the
permissions of its operating-system user. Treat access to Control like terminal
access to that account.

## Supported deployment

- Keep the bridge bound to `127.0.0.1`, which is the default.
- Use Tailscale Serve or another private authenticated access layer for remote
  access.
- Do not use Tailscale Funnel or expose the bridge directly to the public
  internet.
- Restrict the access layer to the people and devices that should control the
  machine.
- Use permission bypass only with repositories and agents you trust.

Origin checks protect browsers from unapproved web origins. They are not user
authentication and do not make a publicly reachable bridge safe.

## Reporting a problem

Report vulnerabilities through a private GitHub security advisory for this
repository. Include the affected version, deployment method, reproduction, and
whether terminal input or local files can be accessed.

Do not include credentials, terminal contents, session references, or private
repository data in a public issue.
