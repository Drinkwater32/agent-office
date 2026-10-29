# Security

agent-office runs a small server on your own machine (`bridge/bridge.py`, on `127.0.0.1` only) so the browser
window can chat with your Claude Code session. A flaw there could let another page or program send prompts to your
session, so reports are welcome.

## Reporting a vulnerability

Please report it privately through GitHub's "Report a vulnerability" button on this repository's Security tab
(private vulnerability reporting), not in a public issue. Include what you found, how to reproduce it, and the
version (`.claude-plugin/plugin.json`). You should hear back within a week.

## Scope

In scope: the bridge (its token, Host, Origin and file checks), the browser page (anything that could run script or
leak the token), and the hooks module (anything that could leak the token, or write outside its own folders).

Out of scope: a program already running as you on the same machine, which can read your files anyway.
