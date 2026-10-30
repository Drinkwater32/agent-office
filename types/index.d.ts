// One agent in the office: the subagent's id, its task, the department (d0, d1, ...) it was sent to, how it ended,
// and what it is doing now.
export type Staffer = {
  id: string
  task: string
  desk: string
  isDone: boolean
  isFailed: boolean
  startedAt: number
  endedAt?: number
  tool?: string
  say?: string     // the first sentence of what the agent last said, plain text, for its speech bubble
}

// One line of the conversation the browser window mirrors: the user's prompts (typed in the terminal or in the
// window) and Claude's replies on the main session.
export type ChatMsg = {
  id: string
  who: 'owner' | 'claude'
  text: string
  at: number
  via?: 'window' | 'terminal'
  state?: 'queued' | 'sent' | 'failed'   // a window message: waiting for Claude, delivered, or never delivered
  cid?: string                // the window's own id for a message it sent
  turn?: string               // Claude's: the turn it answers in
}

// the session's bridge token and port, kept through a hot reload so the next bridge takes them over
export type BridgeKeep = { token: string; port: number }

// the conference room's meeting, as office_meeting_update (or a call) last wrote it: plain JSON, checked again
// (hooks/meeting.ts, cleanMeeting) every time it is read
export type MeetingKept = { [key: string]: unknown } | null

declare module 'claude-code' {
  interface PluginState {
    'agent-office': { staff: Shaped<Staffer[]>; chat: Shaped<ChatMsg[]>; keep: Shaped<BridgeKeep>; meeting: Shaped<MeetingKept> }
  }
}
