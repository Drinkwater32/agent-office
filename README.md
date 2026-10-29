# agent-office

A pixel-art office for Claude Code. Every subagent Claude starts walks in, takes a desk in its department and gets to
work: what it last said floats over its head, its latest tool is on a tag at its desk, and when it finishes it walks
its report to the front desk, where Claude sits. You have an office of your own, a small staff keeps the place busy,
and a couple of pets wander between the rooms.

The office sits in a pane beside the chat, and opens in a browser window too, with a chat to Claude at the front
desk: what you type there goes to your session as if you had typed it in the terminal.

![The office in a browser window, with the front desk's chat](docs/screenshot.png)

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-office --marketplace <owner>/agent-office
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```sh
claude plugin install agent-office --marketplace <owner>/agent-office
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `<owner>/agent-office`, then
Add plugin.

## Use

| Command | What it does |
| --- | --- |
| `/office` | Opens the office in a pane beside the chat. |
| `/office-popout` | Opens the office in your browser, with the front desk's chat. Asking Claude to "open the office" does the same. |
| `/office-config` | Writes a starter config if you have none, reads it again, and lists what it holds and anything it skipped. |

The browser window shows the office, the agents on the floor and the ones that handed back. Click an agent in the
list to find it in the office. The chat on the right is your session: type there and press Enter. Close the chat with
the X (or Esc); the bell brings it back, with a count of Claude's replies you haven't seen.

## Configure

The office reads `office.config.json` from an `agent-office` folder in your Claude config folder
(`~/.claude/agent-office/office.config.json`, or under `CLAUDE_CONFIG_DIR` when you set it). Run `/office-config` to
create it, edit it, and run `/office-config` again to apply it. Every field is optional; anything missing or invalid
falls back to its default, and `/office-config` tells you what it skipped and why.
[`office.config.example.json`](office.config.example.json) has every field.

```json
{
  "owner": { "name": "You", "look": { "skin": "light", "hair": "#3b2a20", "style": "crop", "top": "#5b6b8c" } },
  "departments": [
    { "name": "Engineering", "color": "#7c3aed", "agentTypes": ["general-purpose"], "keywords": ["implement", "fix"] },
    { "name": "Review", "keywords": ["review", "test"] },
    { "name": "Research", "agentTypes": ["Explore", "Plan"] }
  ],
  "routing": "match",
  "staff": ["Ada", "Grace", { "name": "", "look": { "style": "curls" } }],
  "pets": [{ "name": "Cat", "coat": "short", "color": "orange" }, { "name": "Kitten", "coat": "long", "color": "cream" }]
}
```

- **owner**: your character, in your own office. `name` (up to 16 letters, digits, spaces and `. ' & -`) labels your
  messages in the chat. Default: "You".
- **departments**: 1 to 8 rooms, laid out around your office and the lobby. Each has a `name` (up to 16 characters)
  and an optional `color` (`#rrggbb`). Defaults: Engineering, Review, Design, Research.
- **routing**: how an agent picks its department.
  - `"match"` (default): the first department whose `agentTypes` lists the agent's type (`Explore`, `Plan`,
    `general-purpose`, or your own agent types); else the one whose `keywords` its description and prompt mention
    most; else the next department in turn.
  - `"round-robin"`: each new agent goes to the next department in turn.
- **staff**: up to 12 teammates who work at desks in the departments, take breaks, and chat. A name (or `""` for an
  unnamed teammate) or an object with `name` and `look`. `[]` for an empty office. Default: six unnamed.
- **pets**: up to 4. `name`, `coat` (`"short"` or `"long"`) and `color` (`orange`, `cream`, `gray`, `black`,
  `brown`, `white`). `[]` for none. Default: Cat and Kitten.
- **look** (owner and staff): `skin` (`fair`, `light`, `tan`, `brown`, `deep`), `style` (`crop`, `curls`, `bun`,
  `beanie`, `cap`, `long`, `lob`, `buzz`, `swoop`, `puffs`, `twists`), colors `hair`, `top`, `pants`, `shoes`, `hat`,
  `headphones`, and `glasses` (`true`, `false` or `"clear"`), `beard` and `knit` (`true` or `false`).

## Security

The browser window talks to a small local server, `bridge/bridge.py`, which runs for the session's life:

- It listens on `127.0.0.1` only, and answers only to that exact Host (no DNS rebinding).
- Each session has a random 256-bit token, compared in constant time and never written to a log or a tool result.
- Posting a message needs the bridge's own Origin and the token in a custom header; there are no CORS headers.
- Only a fixed list of files is served. Pages carry a strict Content-Security-Policy (`default-src 'none'`, scripts
  and styles from the bridge alone), `Referrer-Policy: no-referrer`, and no framing.
- Chat text is only ever set as text, never parsed as HTML. Messages are capped at 4 KB and 20 a minute.
- Each session writes its files to its own run folder; the bridge clears run folders left by sessions gone for three
  days. Nothing leaves your machine: no outbound network calls.

See [SECURITY.md](SECURITY.md) to report a problem.

## Requirements

- Claude Code with plugin function hooks (the pane needs a surface that draws SVG: the desktop app, or a terminal
  that shows panes; a terminal without SVG gets the lists).
- Python 3.8 or newer for the browser window's chat bridge (`py -3`, `python3` or `python` on your PATH). Without it
  the browser window still opens, read-only.
- Windows, macOS or Linux.

## Develop

```sh
claude --plugin-dir .                                   # run it from this folder
claude plugin validate .
claude plugin test .                                    # tests/*.test.ts(x)
python -m unittest discover -s tests -p "test_*.py"     # the bridge
```

## License

[MIT](LICENSE)
