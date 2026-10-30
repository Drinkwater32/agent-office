# agent-office

> In the commands below, replace `<owner>` with the GitHub account or organization that hosts this repository.

## What it is

A pixel-art office for Claude Code. Every subagent Claude starts walks in, takes a desk in its department and works
there, its latest words in a bubble and its current tool on a tag. When it finishes, it walks its report to the front
desk, where Claude sits. The office opens in your browser beside a chat with Claude: what you type there goes to your
session as if you had typed it in the terminal. It also has a conference room where Claude runs meetings between your
departments, a usage gauge, a whiteboard with your branches, pets, and day and night.

![The office in a browser window, with a meeting in the conference room](docs/screenshot.png)

## Requirements

- **Claude Code**: the CLI, the VS Code extension or the desktop app.
- **Python 3.8 or newer**, for the small local server behind the chat. Check that you have it:

  ```sh
  python --version        # macOS, Linux, Windows
  python3 --version       # macOS, Linux
  py -3 --version         # Windows
  ```

  Without Python the office still opens, read-only (no chat).
- Windows, macOS or Linux.

## Install

1. Add the marketplace:

   ```sh
   claude plugin marketplace add <owner>/agent-office
   ```

2. Install the plugin:

   ```sh
   claude plugin install agent-office@agent-office
   ```

3. Start a new Claude Code session (or run `/reload-plugins` in one that is open).

The same steps from inside a session: `/plugin marketplace add <owner>/agent-office`, then
`/plugin install agent-office@agent-office`, then `/reload-plugins`. In the desktop app: click **+** next to the prompt
box, then **Plugins**, **Add marketplace** with `<owner>/agent-office`, then **Add plugin**.

**Update later:**

```sh
claude plugin marketplace update agent-office
claude plugin update agent-office@agent-office
```

Then start a new session.

**Uninstall:**

```sh
claude plugin uninstall agent-office@agent-office
claude plugin marketplace remove agent-office
```

## First run

1. Start a Claude Code session in any project. The office opens in your default browser by itself, with the front desk
   (the chat) on the right.
2. The office is quiet until Claude starts a subagent. Ask for something that uses one ("explore how the config is
   loaded, with an agent") and watch it walk in.
3. Type in the chat at the front desk and press Enter: it goes to the same session as the terminal.

**Open it again:** `/office`.

**Didn't pop up?** Run `/office`. If no browser opens, the reply gives the address to open by hand
(`http://127.0.0.1:<port>/office.html?k=...`). The part after `k=` is this session's private key: the local server
answers nothing without it, so no other web page or program can use it. It stops working when the session ends; don't
share it.

**Prefer the terminal?** `/office-pane` opens the office in a pane beside the chat, where your Claude Code shows panes.

## Customize

The config is one JSON file. Create a starter with `/office-config`, edit it, then run `/office-config` again to apply
it (an open browser window reloads by itself).

| OS | Where the file lives |
| --- | --- |
| Windows | `%USERPROFILE%\.claude\agent-office\office.config.json` |
| macOS, Linux | `~/.claude/agent-office/office.config.json` |
| Any, when `CLAUDE_CONFIG_DIR` is set | `$CLAUDE_CONFIG_DIR/agent-office/office.config.json` |

Every field is optional. A missing or invalid field falls back to its default, and `/office-config` lists what it
skipped and why. A full example (the `//` notes are for reading here; JSON has no comments, so leave them out of your
file):

```jsonc
{
  "owner": {                                    // you: your character, in your own office
    "name": "Sam",                              // up to 16 letters, digits, spaces and . ' & -  (default "You")
    "look": { "skin": "light", "hair": "#3b2a20", "style": "crop", "top": "#5b6b8c", "glasses": true }
  },
  "departments": [                              // 1 to 8 rooms; each agent goes to one, by `routing`
    { "name": "Engineering", "color": "#7c3aed",
      "agentTypes": ["general-purpose"],        // an agent of this type always comes here
      "keywords": ["implement", "fix", "bug"] },  // else: the department whose words its task mentions most
    { "name": "Review", "color": "#ef4444", "keywords": ["review", "audit", "test"] },
    { "name": "Research", "agentTypes": ["Explore", "Plan"] }    // no color: one from the palette
  ],
  "routing": "match",                           // "match" (types, then keywords, then in turn) or "round-robin"
  "staff": ["Ada", "Grace", { "name": "", "look": { "style": "curls" } }],   // up to 12; "" is an unnamed teammate
  "pets": [                                     // up to 4; [] for none
    { "name": "Biscuit", "coat": "short", "color": "orange" },
    { "name": "Mochi", "coat": "long", "color": "cream" }
  ],
  "usage": {
    "warnAt": 90,                               // % of a usage window: red gauge, and Claude writes the handoff
    "closeAt": 98,                              // %: the office closes until the window resets
    "handoffFile": "HANDOFF.md"                 // relative to the project folder, or absolute; "" for no handoff
  },
  "deadline": { "label": "Launch", "at": "2026-12-01T17:00" },   // a countdown on the whiteboard (your local time)
  "seasons": true,                              // Halloween, Thanksgiving and holiday decor by the date
  "openOnStart": true                           // open the browser window as each session starts
}
```

The values each field takes:

- **look** (owner and staff): `skin` (`fair`, `light`, `tan`, `brown`, `deep`); `style` (`crop`, `curls`, `bun`,
  `beanie`, `cap`, `long`, `lob`, `buzz`, `swoop`, `puffs`, `twists`); colors `hair`, `top`, `pants`, `shoes`, `hat`,
  `headphones` as `#rrggbb`; `glasses` (`true`, `false` or `"clear"`); `beard` and `knit` (`true` or `false`).
- **departments**: `name` up to 16 characters, `color` as `#rrggbb`, up to 16 `agentTypes` (`Explore`, `Plan`,
  `general-purpose`, or your own agent types) and 60 `keywords`. Default: Engineering, Review, Design, Research.
- **staff**: a name, or `{ "name", "look" }`; `[]` for an empty office. Default: six unnamed teammates.
- **pets**: `coat` is `"short"` or `"long"`; `color` is `orange`, `cream`, `gray`, `black`, `brown` or `white`.
- **usage**: `warnAt` a whole number from 50 to 99; `closeAt` from 51 to 100, above `warnAt`; `handoffFile` a path to
  a `.md` or `.txt` file, with no `..` in it.
- **deadline**: `at` is `"YYYY-MM-DD"` or `"YYYY-MM-DDTHH:MM"` on this computer's clock. Leave it out for no countdown.

## Using it

| Command | What it does |
| --- | --- |
| `/office` | Opens the office in your browser, with the chat. Asking Claude to "open the office" does the same. |
| `/office-pane` | Opens the office in a pane beside the chat instead (the conference room is in the browser window only). |
| `/office-config` | Creates a starter config if you have none, reads it again, and lists what it holds and what it skipped. |
| `/office-meeting [topic]` | Calls a meeting in the conference room. No topic: "Our priorities for the next week". |
| `/office-usage` | Lists your usage windows, the context window, the thresholds, and whether the office is open. |

**Talking to Claude:** type at the front desk and press Enter (Shift+Enter for a new line). Close the chat with the X or
Esc; the bell brings it back, with a count of replies you haven't seen. Click an agent in the list under the office to
find it on the floor.

**Meetings:** call one with `/office-meeting Ship the search feature`, with **Call a meeting** in the front desk's
**Meeting** tab, or with the plate on the conference room's screen. Claude chairs: each department presents a
proposal, they discuss, and Claude records the decisions. The attendees walk in and sit, the speaker's words show in a
bubble, and the Meeting tab keeps the transcript. To speak, turn on **Say in meeting** above the chat box: your message
reaches Claude as your line in the meeting. One meeting at a time.

**The gauge** (beside the title, and on the pane's first line): your 5-hour usage window's percentage and when it
resets, then this session's context window. Each number turns amber 15 points before `warnAt` and red at it. At
`warnAt`, Claude is asked once to rewrite the handoff file from scratch (never append to it), so a later session can pick
up where this one stopped. At `closeAt` the office closes: the lights go down, the staff go home, and a sign at the door
says when it opens again. The numbers appear after Claude's first reply on a subscription plan.

**The whiteboard** (in the conference room): up to three branches of this project's git repository, this folder's
branch first, each marked open or merged, with a dot for each department that has an agent on it. It reads git once a
minute and never writes to it. Set `deadline` for a countdown at the top.

## Troubleshooting

- **The window didn't open.** Run `/office`. If no browser opens, the reply gives the address to paste into a browser on
  this computer. On Linux the office tries `xdg-open`, then `gio open`, then `sensible-browser`.
- **"Read-only: chatting needs the local bridge."** The local server didn't start. Check Python (see Requirements), then
  run `/office` again. The server's log is `~/.claude/plugins/data/agent-office/bridge.log`. A busy port is not a
  problem: the server picks a free one by itself.
- **The office is empty.** It shows subagents: nobody comes in until Claude starts one. The staff and pets are always
  there.
- **A meeting didn't start.** It starts after Claude's current task. The Meeting tab says "Called" until Claude begins.
  A meeting nobody touches for three hours counts as over, and you can call another.
- **The gauge shows "–".** No usage reading yet: it comes with Claude's first reply, on a subscription plan.
- **Reset everything.** Delete `~/.claude/agent-office/office.config.json` (the defaults come back) and the folder
  `~/.claude/plugins/data/agent-office/` (the sessions' page files and the log), then start a new session.

## Security and privacy

- The chat runs through a small server on your own computer (`bridge/bridge.py`). It listens on `127.0.0.1` only and
  answers only to that exact address, so other machines and rebinding tricks can't reach it.
- Each session has a random 256-bit key that every request needs; posting also needs the server's own origin, and there
  are no CORS headers. Pages carry a strict Content-Security-Policy, and chat text is only ever shown as text.
- No network calls: nothing leaves your computer (no weather, no telemetry). The whiteboard runs read-only `git`
  commands in your project, never through a shell.
- What is stored: your config (`~/.claude/agent-office/`); each session's page files and the server's log
  (`~/.claude/plugins/data/agent-office/`, cleared three days after a session ends); and the usage guard's memory, in
  Claude Code's own plugin storage. The key goes only to the browser window it opens; `/office` shows it only when no
  browser opens.

To report a security problem, see [SECURITY.md](SECURITY.md).

## Spoilers

<details>
<summary>The easter eggs (click to reveal)</summary>

None makes a sound. Codes typed at the front desk play in the office and are never sent to Claude. A long press is about
half a second; a short click still does what it always did.

| Egg | Trigger |
| --- | --- |
| The pets dance, notes rising | Long press on a pet |
| The trophy in the lobby spins and sparkles; Claude says "Champions!" | Long press on the trophy |
| The coffee machine overflows down the counter; someone calls for a mop | Three long presses on the kitchen's coffee machine within 30 seconds (the first two puff steam) |
| Confetti over the whole office | Type `/confetti` at the front desk |
| An extra life: everyone cheers with a 1UP, and the arcade cabinet plays its attract mode | The Konami code on a keyboard (up, up, down, down, left, right, left, right, B, A), anywhere but a text box |
| A paper airplane drifts across the office | One page load in 50 |
| The lights flicker and the pets' eyes glow | Midnight on your computer's clock |

The pets also get up to things on their own now and then: a mug knocked off your desk, a nap on your keyboard, a laser
dot chased around the room, a sudden dash to another room.

</details>

## Develop

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
and the reply never repeats a turn's words.

## License

[MIT](LICENSE)
