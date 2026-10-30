# Changelog

## 0.2.2

### Fixed

- **Meeting bubbles sit over the speaker's head.** In a wide window the bubble used to sit beside the conference room
  and point at it from the west. It now always sits above the speaker (or under their feet when there's no room above).

### Changed

- **No pull requests:** the repository doesn't accept them. A workflow (`.github/workflows/close-pull-requests.yml`)
  closes any that is opened, with a note pointing to `CONTRIBUTING.md`.
- **README:** rewritten for first-time users: a quick install (three commands in a session), a step-by-step setup for
  people new to the terminal (Claude Code, Python, the plugin), a tour with pictures, beginner troubleshooting and a
  glossary. New screenshots throughout. The full settings reference moved to `docs/CONFIG.md`.

## 0.2.1

### Fixed

- **Meetings play at a person's pace.** Claude can send a whole meeting in a second or two; the room used to show each
  update as it came, so it could end before anyone had walked in. The room now keeps a playback queue
  (`popout/meetplay.js`): the attendees walk in and sit (a walk is waited for, up to 25 seconds), each turn's bubble
  stays up for 2.5 seconds plus 0.05 a character (at most 9 seconds a page), the decisions stay on the screen, and only
  then do they walk out. Updates that come while it plays are queued, never dropped; a new meeting waits for the one
  playing to finish; more than 20 steps behind, the room skips to the newest state and sums it up in a few seconds. The
  Meeting tab's transcript still shows every line at once, and a page opened or reloaded mid-meeting jumps to where the
  meeting stands. The meeting tool's description tells Claude it can send turns quickly.
- **The lo-fi soundtrack keeps playing** in a hidden, minimized or covered window, until you turn it off or mute it.
  If the browser itself suspends the sound, it resumes when you come back or click. It still starts off on every load.
- **The pane says what it is.** `/office-pane` is a compact text view (who's working, the inbox, your usage); the README
  no longer calls it the office. A handed-back report there reads "Handed back: Research · ... · took 2m", never like
  someone still at work.

### Changed

- **New default cast:** different looks for the six default teammates, and the default pets are Pixel (gray, short
  coat) and Noodle (black, long coat).
- **Claude's look is configurable:** `"claude": { "look": { ... } }`, with the same fields as yours. Its name stays
  Claude.
- **The trophy is gone** from the lobby, with its easter egg.
- **The handoff file** is now `.agent-office/HANDOFF.md` in the project by default (it was `HANDOFF.md` at the root).
  The README suggests adding `.agent-office/` to `.gitignore`.
- **README:** a "Try it in 2 minutes" section at the top, a "Make it yours" section with copy-paste config examples
  for you, Claude, the departments, the crew and pets, the soundtrack and the handoff file, and a new screenshot. The
  install lines name the repository, `Drinkwater32/agent-office`.
- License holder: Lee Drinkwater.

## 0.2.0

### Added

- **The conference room and meetings.** A room east of the kitchen and the lounge, with a long table, a wall screen and
  a whiteboard. Call a meeting with `/office-meeting [topic]`, the **Call a meeting** button in the front desk's new
  **Meeting** tab, or the plate on the screen. Claude chairs it through the new `office_meeting_update` tool: each
  department proposes, they discuss, and the decisions are recorded. The attendees (you, the departments, your named
  staff, and Claude as the chair) walk in and sit; the speaker's words show in a bubble; the Meeting tab keeps a live
  transcript. **Say in meeting** above the chat box sends your message as your line in the meeting.
- **The usage gauge and guard.** Beside the title (and on the pane's first line): the 5-hour usage window's percentage
  and reset time, and the context window's. At `usage.warnAt` (90% by default) Claude is asked, once a window, to
  rewrite the handoff file (`usage.handoffFile`, `HANDOFF.md` in the project by default) from scratch. At
  `usage.closeAt` (98%), or when the API reports a rate limit, the office closes until the window resets. New
  `/office-usage` command.
- **The whiteboard:** this project's branches (read-only git) and whether each is open or merged, with a dot for each
  department working on one; a countdown to `deadline` when you set one.
- **Day and night by your computer's clock** (desk lamps come on at night) and **seasonal decor by its calendar**
  (Halloween, Thanksgiving, the holidays; the pets dress up too). `seasons: false` turns the decor off.
- **The pets act on their own:** a mug knocked off your desk, a nap on your keyboard, a laser dot chased around a room, a
  dash to another room.
- **Easter eggs**, listed under Spoilers in the README. Codes typed at the front desk never reach Claude: the page, the
  local server and the plugin each drop them.
- **A lo-fi soundtrack.** A **Lo-fi** toggle and a mute button in the window's title bar. It is off every time the
  window opens, plays only after you click it, and pauses while the tab is hidden (until 0.2.1). The loop (`popout/lofi.wav`) is
  generated by the included `tools/make_lofi.py`, so it is the project's own and MIT-licensed. The local server serves
  it as a fixed file, like the scripts; the page fetches and decodes it, so the Content-Security-Policy is unchanged.
  `soundtrack.enabled: false` hides the toggle.
- Config: `usage`, `deadline`, `seasons`, `openOnStart`, `soundtrack`.

### Changed

- **The browser window is now the default.** It opens as each interactive session starts (`openOnStart: false` turns
  that off), and `/office` opens it. The pane moved to `/office-pane`. `/office-popout` is gone.
- When no browser opens, `/office` says so and gives the address to open by hand. On Linux it tries `xdg-open`, then
  `gio open`, then `sensible-browser`.
- The README is rewritten as a step-by-step guide: install, first run, customize, use, troubleshoot.
- The local server takes two new requests: `POST /meeting` (a meeting call) and the `X-Office-Mode: meeting` header on
  a message. Both need the session's key and the server's own origin, like every post.

## 0.1.0

- The first version: agents at their desks by department, the front desk's inbox, the staff and pets, the pane and the
  browser window with a chat to Claude through a local, key-locked server.
