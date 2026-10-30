# Security

agent-office runs a small server on your own machine (`bridge/bridge.py`, on `127.0.0.1` only) so the browser
window can chat with your Claude Code session. A flaw there could let another page or program send prompts to your
session, so reports are welcome.

## Reporting a vulnerability

Please report it privately through GitHub's "Report a vulnerability" button on this repository's Security tab
(private vulnerability reporting), not in a public issue. Include what you found, how to reproduce it, and the
version (`.claude-plugin/plugin.json`). You should hear back within a week.

## Scope

In scope: the bridge (its token, Host, Origin and file checks, the meeting call, the easter-egg codes it drops), the
browser page (anything that could run script or leak the token, model-written meeting text included), and the hooks
module (anything that could leak the token, write outside its own folders, run git other than read-only, or turn
meeting or config input into something unchecked).

Out of scope: a program already running as you on the same machine, which can read your files anyway.
