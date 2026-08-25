# Five-minute walkthrough

## 1. Install the Home bridge

You need Node.js 22.5 or newer, Herdr 0.8 or newer, and a running Herdr instance.

```bash
git clone https://github.com/gregmcausland/herdr-control.git
cd herdr-control
npm run control -- install
```

Open `http://127.0.0.1:4173`. The current machine appears as `Custom host` until
you give it a saved name. The installer starts a user service and stores Control
metadata at `~/.local/state/herdr-control/control.db`.

## 2. Name this machine and add others

Open the server button in the header. Add the current bridge URL with a useful
name. To supervise another machine, install Control there too, then add that
bridge's URL to the Home bridge.

For private remote access, keep each bridge on localhost and expose it through a
trusted layer such as Tailscale Serve:

```bash
tailscale serve 4173
```

Add the HTTPS address Tailscale prints. Control stores that URL and display name;
Tailscale authentication credentials remain with Tailscale.

## 3. Create the first Thread

Open a repository-backed workspace in Herdr. Return to Control and wait for its
Project to appear. Choose the plus button beside the Project, select an agent and
location, optionally add a title and initial message, then create the Thread.

The agent continues under Herdr if the browser closes. Reopen its row to control
the terminal, or archive it once Herdr has reported a resumable session.

## Useful service commands

```bash
npm run control -- status
npm run control -- logs
npm run control -- update
npm run control -- restart
npm run control -- remove
```

Removal keeps the configuration and database. See the
[migration note](host-configuration-migration.md) before moving an older JSON
host list, and [compatibility](../COMPATIBILITY.md) before upgrading Herdr.
