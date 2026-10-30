# Configuring agent-office

← [Back to the README](../README.md)

## Where the settings live

One file, `office.config.json`, for every project on this computer (it isn't per project):

| OS | Path |
| --- | --- |
| Windows | `%USERPROFILE%\.claude\agent-office\office.config.json` |
| macOS, Linux | `~/.claude/agent-office/office.config.json` |
| Any, when `CLAUDE_CONFIG_DIR` is set | `$CLAUDE_CONFIG_DIR/agent-office/office.config.json` |

**To edit it:** run `/office-config` once to create a starter file, edit it, then run `/office-config` again. That
applies it right away (an open office window redraws itself) and lists anything it skipped and why. A new session
reads it too. Department changes reach Claude's meeting tool in the next session.

Paste only the parts you want to change. Anything you leave out keeps its default.

## The pieces

### You

Your name and your character's look. Where you sit is fixed for now: your own office, beside the lobby.

```json
"owner": { "name": "Sam", "look": { "skin": "tan", "hair": "#2a1c14", "style": "curls", "top": "#14b8a6", "glasses": true } }
```

### Claude at the front desk

Its look. Its name stays "Claude".

```json
"claude": { "look": { "style": "bun", "hair": "#1d140f", "top": "#3b82f6", "headphones": "#f4c542" } }
```

### Departments

One to eight rooms. Rename them, recolor them, add or remove them. `agentTypes` sends every agent of that type to that
room. Otherwise an agent goes to the department whose `keywords` its task mentions most (or set
`"routing": "round-robin"` to take turns).

```json
"departments": [
  { "name": "Backend", "color": "#3b82f6", "agentTypes": ["general-purpose"], "keywords": ["api", "database", "fix"] },
  { "name": "Frontend", "color": "#ec4899", "keywords": ["ui", "css", "page"] },
  { "name": "QA", "color": "#ef4444", "keywords": ["test", "review", "audit"] },
  { "name": "Research", "agentTypes": ["Explore", "Plan"] }
]
```

### The crew and the pets

Up to 12 teammates (a name, `""` for an unnamed one, or a name with a look) and up to 4 pets. `[]` for none.

```json
"staff": ["Ada", "Grace", { "name": "Linus", "look": { "style": "beanie", "hat": "#e4572e", "beard": true } }, ""],
"pets": [{ "name": "Waffles", "coat": "short", "color": "white" }, { "name": "Pepper", "coat": "long", "color": "brown" }]
```

### The lo-fi soundtrack

`false` removes the Lo-fi button. When it's shown, it always starts off: it plays only after you click it (browsers
don't allow sound before a click anyway).

```json
"soundtrack": { "enabled": false }
```

### The usage guard and the handoff file

The handoff file is on by default, at `.agent-office/HANDOFF.md` in the project. Point it elsewhere (relative to the
project, or absolute), or set it to `""` to turn it off. `warnAt` and `closeAt` are the usage percentages for the
warning (and the handoff) and for closing the office.

```json
"usage": { "warnAt": 85, "closeAt": 98, "handoffFile": "docs/HANDOFF.md" }
```

### Everything else

- `"openOnStart": false`: don't open the window as each session starts.
- `"seasons": false`: no holiday decor.
- `"deadline": { "label": "Launch", "at": "2026-12-01T17:00" }`: a countdown on the whiteboard.

## A full example

Every field is optional. A missing or invalid field falls back to its default, and `/office-config` lists what it
skipped and why. The `//` notes are for reading here: JSON has no comments, so leave them out of your file.

```jsonc
{
  "owner": {                                    // you: your character, in your own office
    "name": "Sam",                              // up to 16 letters, digits, spaces and . ' & -  (default "You")
    "look": { "skin": "light", "hair": "#3b2a20", "style": "crop", "top": "#5b6b8c", "glasses": true }
  },
  "claude": { "look": { "top": "#d97757", "headphones": "#d97757" } },   // Claude's look (its name stays Claude)
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
    { "name": "Waffles", "coat": "short", "color": "white" },
    { "name": "Pepper", "coat": "long", "color": "brown" }
  ],
  "usage": {
    "warnAt": 90,                               // % of a usage window: red gauge, and Claude writes the handoff
    "closeAt": 98,                              // %: the office closes until the window resets
    "handoffFile": ".agent-office/HANDOFF.md"   // relative to the project folder, or absolute; "" for no handoff
  },
  "deadline": { "label": "Launch", "at": "2026-12-01T17:00" },   // a countdown on the whiteboard (your local time)
  "seasons": true,                              // Halloween, Thanksgiving and holiday decor by the date
  "openOnStart": true,                          // open the browser window as each session starts
  "soundtrack": { "enabled": true }             // show the Lo-fi toggle (playback always starts off); false hides it
}
```

## The values each field takes

| Field | Values |
| --- | --- |
| **look** (owner, Claude, staff) | `skin`: `fair`, `light`, `tan`, `brown`, `deep`. `style`: `crop`, `curls`, `bun`, `beanie`, `cap`, `long`, `lob`, `buzz`, `swoop`, `puffs`, `twists`. Colors `hair`, `top`, `pants`, `shoes`, `hat`, `headphones` as `#rrggbb`. `glasses`: `true`, `false` or `"clear"`. `beard` and `knit`: `true` or `false`. |
| **departments** | `name` up to 16 characters, `color` as `#rrggbb`, up to 16 `agentTypes` (`Explore`, `Plan`, `general-purpose`, or your own agent types) and 60 `keywords`. Default: Engineering, Review, Design, Research. |
| **staff** | A name, or `{ "name", "look" }`. `[]` for an empty office. Default: six unnamed teammates. |
| **pets** | `coat`: `"short"` or `"long"`. `color`: `orange`, `cream`, `gray`, `black`, `brown` or `white`. |
| **usage** | `warnAt`: a whole number from 50 to 99. `closeAt`: 51 to 100, above `warnAt`. `handoffFile`: a path to a `.md` or `.txt` file, with no `..` in it. |
| **deadline** | `at`: `"YYYY-MM-DD"` or `"YYYY-MM-DDTHH:MM"` on this computer's clock. Leave it out for no countdown. |
| **soundtrack** | `{ "enabled": false }` removes the Lo-fi toggle from the window entirely. |

## Reset everything

Delete `~/.claude/agent-office/office.config.json` (the defaults come back) and the folder
`~/.claude/plugins/data/agent-office/` (the sessions' page files and the log), then start a new session.
