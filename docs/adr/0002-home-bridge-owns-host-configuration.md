---
status: accepted
---

# The Home bridge owns Control Host configuration

The Control bridge serving the browser will store the Control Host list in its
existing local SQLite database. The browser will load that list from the Home
bridge, then continue connecting directly to each listed bridge. This gives a
user's browsers one durable list without introducing hosted synchronization.

## Consequences

- A user chooses one stable Home bridge URL for opening Control. Opening a
  different installation may load a different Control Host list.
- The database stores display names and bridge URLs. Tailscale continues to own
  authentication credentials, and Control does not copy them.
- Existing `hosts.json` entries must migrate successfully before the client
  stops reading the file.
