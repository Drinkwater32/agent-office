<div align="center">

<img src=".claude-plugin/icon.png" alt="" width="112" height="112">

# agent-office

**A cozy pixel-art office for your Claude Code subagents.**<br>
Watch them walk in, take a desk, work, and hand their reports to Claude at the front desk.

[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FDrinkwater32%2Fagent-office%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=7c3aed)](CHANGELOG.md)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757)](https://code.claude.com/docs)
[![Platforms](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-supported-14b8a6)](#requirements)
[![License: MIT](https://img.shields.io/badge/license-MIT-3b82f6)](LICENSE)

[Install](#install) · [First steps](#first-steps) · [Commands](#commands) · [Make it yours](#make-it-yours) · [Troubleshooting](#troubleshooting)

<br>

<img src="docs/screenshot.png" alt="The office in a browser window: departments at work, a meeting in the conference room, and the chat at the front desk" width="900">

</div>

<br>

## What you get

|  |  |
| --- | --- |
| 🧑‍💻 **Your agents at work** | Every subagent Claude starts walks in, takes a desk in its department, and works there, with its latest words in a bubble and its current tool on a tag. |
| 💬 **A chat at the front desk** | Type to Claude from the browser. It reaches the same session as your terminal. |
| 🗓️ **Meetings** | Claude chairs a meeting between your departments in the conference room: proposals, discussion, and decisions on the big screen. |
| 📊 **A usage gauge** | Your 5-hour usage and context window at a glance. Near the limit, Claude writes a handoff note so the next session can pick up where this one stopped. |
| 🐈 **Little touches** | Office pets with minds of their own, day and night, holiday decor, a whiteboard with your branches, and an optional lo-fi soundtrack. |

<br>

## Install

**In a Claude Code session**, run these one at a time:

```
/plugin marketplace add Drinkwater32/agent-office
/plugin install agent-office@agent-office
/reload-plugins
```

**That's it.** The office opens in your browser. If it doesn't, type `/office`.

<details>
<summary><b>Other ways to install</b> (the terminal, the desktop app)</summary>

<br>

**From a terminal:**

```sh
claude plugin marketplace add Drinkwater32/agent-office
claude plugin install agent-office@agent-office
```

Then start a new session with `claude`.

**In the desktop app:** click **+** next to the prompt box, then **Plugins** → **Add marketplace**, enter
`Drinkwater32/agent-office`, then **Add plugin**.

</details>

### Requirements

- **Claude Code**: the CLI, the VS Code extension, or the desktop app, on Windows, macOS or Linux.
- **Python 3.8 or newer**, for the small local server behind the chat. Without it, the office still opens, read-only.
  To check, run `python --version` (or `python3 --version` on macOS and Linux, or `py -3 --version` on Windows).

> [!TIP]
> When you first start Claude in a folder, it may ask whether you trust it (say yes) and about **Claude in Chrome**
> (say no: the office doesn't need it).

<br>

## First steps

The office is quiet until Claude starts a subagent. Try these three:

1. **Send in an agent.** Ask: *"Explore how this project is laid out, with an agent."*<br>
   It walks in, takes a desk, works, then carries its report to the front desk.
2. **Say hi from the browser.** Type in the chat on the right and press <kbd>Enter</kbd>.<br>
   It reaches the same session as the terminal.
3. **Call a meeting.** Ask: *"Call a quick meeting with two departments about naming the office cat."*<br>
   They walk into the conference room, talk in speech bubbles, and the decision goes up on the screen.

<br>

## Commands

| Command | What it does |
| --- | --- |
| `/office` | Opens the office in your browser, with the chat. Asking Claude to "open the office" works too. |
| `/office-meeting [topic]` | Calls a meeting in the conference room. With no topic, it's "Our priorities for the next week". |
| `/office-pane` | A compact text view beside the chat: who's working, the inbox, and your usage. |
| `/office-config` | Creates a starter config if you have none, applies it, and lists anything it skipped. |
| `/office-usage` | Shows your usage windows, the context window, the thresholds, and whether the office is open. |

<details>
<summary><b>How each part works</b></summary>

<br>

**The chat.** Type at the front desk and press <kbd>Enter</kbd> (<kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line).
Close it with the X or <kbd>Esc</kbd>; the bell brings it back, with a count of replies you haven't seen. Click an
agent in the list under the office to find it on the floor.

**Meetings.** Call one with `/office-meeting Ship the search feature`, with **Call a meeting** in the front desk's
**Meeting** tab, or with the plate on the conference room's screen. Claude chairs: each department presents a
proposal, they discuss, and Claude records the decisions. The room plays it at a reading pace, however fast Claude
runs it: everyone sits down before the first word, each bubble stays up long enough to read, and the decisions stay on
the screen before everyone walks out. The Meeting tab keeps the whole transcript. To speak, turn on **Say in meeting**
above the chat box. One meeting at a time.

**The gauge.** Beside the title: your 5-hour usage window and when it resets, then this session's context window.
Each number turns amber 15 points before `warnAt` and red at it. At `warnAt`, Claude is asked once to rewrite the
handoff file (`.agent-office/HANDOFF.md` in the project) so a later session can pick up where this one stopped. Add
`.agent-office/` to your `.gitignore` if you don't want it committed. At `closeAt` the office closes: the lights go
down, the staff go home, and a sign at the door says when it opens again. The numbers appear after Claude's first
reply, on a subscription plan.

**The soundtrack.** The **Lo-fi** button beside the title plays a quiet loop, with a mute button next to it. It's off
every time the window opens; once on, it keeps playing in the background until you turn it off. The loop is generated
from scratch by `tools/make_lofi.py` (no samples or recordings), so it ships under the same MIT license.

**The whiteboard.** In the conference room: up to three branches of this project's git repository, each marked open or
merged, with a dot for each department that has an agent on it. It reads git once a minute and never writes to it.

</details>

<br>

## Make it yours

Run `/office-config` to create your settings file, edit it, then run `/office-config` again to apply it. Paste only
what you want to change. For example, your name and look, your own departments, and the office pets:

```json
{
  "owner": { "name": "Sam", "look": { "skin": "tan", "style": "curls", "top": "#14b8a6", "glasses": true } },
  "departments": [
    { "name": "Backend", "color": "#3b82f6", "keywords": ["api", "database", "fix"] },
    { "name": "Frontend", "color": "#ec4899", "keywords": ["ui", "css", "page"] },
    { "name": "Research", "agentTypes": ["Explore", "Plan"] }
  ],
  "pets": [{ "name": "Waffles", "coat": "short", "color": "white" }]
}
```

📖 **Every option, with a full example:** [docs/CONFIG.md](docs/CONFIG.md)

<br>

## Update or uninstall

```sh
# update
claude plugin marketplace update agent-office
claude plugin update agent-office@agent-office

# uninstall
claude plugin uninstall agent-office@agent-office
claude plugin marketplace remove agent-office
```

After an update, start a new session (or run `/reload-plugins`).

<br>

## Troubleshooting

<details>
<summary><b>The window didn't open</b></summary>

<br>

Run `/office`. If no browser opens, the reply gives an address to paste into a browser on this computer
(`http://127.0.0.1:<port>/office.html?k=...`). The part after `k=` is this session's private key: don't share it. On
Linux the office tries `xdg-open`, then `gio open`, then `sensible-browser`.

</details>

<details>
<summary><b>"Read-only: chatting needs the local bridge"</b></summary>

<br>

The local server didn't start. Check that Python is installed (see [Requirements](#requirements)), then run `/office`
again. The server's log is `~/.claude/plugins/data/agent-office/bridge.log`. A busy port isn't a problem: the server
picks a free one by itself.

</details>

<details>
<summary><b>The office is empty</b></summary>

<br>

It shows subagents, so nobody comes in until Claude starts one. Ask for something "with an agent". The staff and pets
are always there.

</details>

<details>
<summary><b>A meeting didn't start</b></summary>

<br>

It starts after Claude's current task; the Meeting tab says "Called" until then. A meeting nobody touches for three
hours counts as over, and you can call another.

</details>

<details>
<summary><b>The gauge shows "–"</b></summary>

<br>

There's no usage reading yet. It comes with Claude's first reply, on a subscription plan.

</details>

<details>
<summary><b>Reset everything</b></summary>

<br>

Delete `~/.claude/agent-office/office.config.json` (the defaults come back) and the folder
`~/.claude/plugins/data/agent-office/` (the sessions' page files and the log), then start a new session.

</details>

<br>

## Privacy and security

- 🏠 **Everything stays on your computer.** No telemetry and no network calls.
- 🔐 **The chat server is locked down.** It listens on `127.0.0.1` only, and every request needs a random 256-bit key
  made for that session. Pages carry a strict Content-Security-Policy, and chat text is only ever shown as text.
- 👀 **Read-only git.** The whiteboard runs read-only `git` commands in your project, never through a shell.
- 🗂️ **What's stored:** your config (`~/.claude/agent-office/`), each session's page files and the server's log
  (`~/.claude/plugins/data/agent-office/`, cleared three days after a session ends), and the usage guard's memory in
  Claude Code's own plugin storage.

Found a security problem? Please report it privately: see [SECURITY.md](SECURITY.md).

<br>

## Spoilers

<details>
<summary>🥚 <b>The easter eggs</b> (click to reveal)</summary>

<br>

None makes a sound. Codes typed at the front desk play in the office and are never sent to Claude. A long press is
about half a second; a short click still does what it always did.

| Egg | Trigger |
| --- | --- |
| The pets dance, notes rising | Long press on a pet |
| The coffee machine overflows down the counter; someone calls for a mop | Three long presses on the kitchen's coffee machine within 30 seconds (the first two puff steam) |
| Confetti over the whole office | Type `/confetti` at the front desk |
| An extra life: everyone cheers with a 1UP, and the arcade cabinet plays its attract mode | The Konami code on a keyboard (up, up, down, down, left, right, left, right, B, A), anywhere but a text box |
| A paper airplane drifts across the office | One page load in 50 |
| The lights flicker and the pets' eyes glow | Midnight on your computer's clock |

The pets also get up to things on their own now and then: a mug knocked off your desk, a nap on your keyboard, a laser
dot chased around the room, a sudden dash to another room.

</details>

<br>

## Develop

<details>
<summary><b>Run it from source, and the meeting tool</b></summary>

<br>

```sh
claude --plugin-dir .                                   # run it from this folder
claude plugin validate .
claude plugin test .                                    # tests/*.test.ts(x)
python -m unittest discover -s tests -p "test_*.py"     # the bridge
```

The tool Claude runs meetings with is `mcp__agent-office__office_meeting_update`: `id`, `title` (120 characters),
`status` (`scheduled`, `gathering`, `in_session`, `discussion`, `wrap_up`, `ended`), `agenda: [{dept, title}]` (up to 8),
`attendees: [{id, name, dept, role}]` (up to 8 besides `owner` and `claude`), and `turn: {speaker_id, kind, text, title?}`
(`kind` is `proposal`, `reply`, `question`, `decision` or `note`; `text` up to 600 characters). `dept` is `chair`,
`owner`, or a department's name or id. Every field is checked and capped; a turn by someone not attending is refused,
and the reply never repeats a turn's words. The room animates the turns at a reading pace (`popout/meetplay.js`), so
Claude can send them as fast as it likes.

</details>

<br>

---

<div align="center">

This repository doesn't accept pull requests (see [CONTRIBUTING.md](CONTRIBUTING.md)), but forks are welcome.<br>
[MIT License](LICENSE) · [Changelog](CHANGELOG.md)

</div>
