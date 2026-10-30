# Changelog

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
- Config: `usage`, `deadline`, `seasons`, `openOnStart`.

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
