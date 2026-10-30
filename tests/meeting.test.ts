import { expect, test } from 'claude-code/testing'

import * as M from '../hooks/meeting'

const CTX: M.MeetCtx = {
  owner: 'Sam',
  depts: [
    { id: 'd0', key: 'engineering', name: 'Engineering', color: '#7c3aed' },
    { id: 'd1', key: 'review', name: 'Review', color: '#ef4444' },
  ],
  staff: [
    { id: 's0', key: 'ada', name: 'Ada', dept: 'd0' },
    { id: 's1', key: 'teammate-1', name: 'Teammate 1', dept: 'd1' },
  ],
}
const NOW = 1_800_000_000_000

test('a meeting read back is checked field by field', async () => {
  const m = M.cleanMeeting({
    id: 'Weekly Sync!', title: 'x'.repeat(500), status: 'nonsense',
    agenda: Array.from({ length: 20 }, (_, i) => ({ dept: i % 2 ? 'Review' : 'd0', title: `Item ${i}` })),
    attendees: [{ id: 'owner', name: 'Mallory' }, { id: 'ada', name: 'Not Ada' }, { id: 'review' },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `guest-${i}`, name: '<img src=x onerror=alert(1)>', dept: 'nope' }))],
    turns: [{ speaker_id: 'ada', kind: 'proposal', text: 'Ship it.\u0007\n\n\n\nToday.', n: 5 },
      { speaker_id: 'stranger', kind: 'note', text: 'not in the room' },
      { speaker_id: 'review', kind: 'shout', text: 'y'.repeat(2000) }],
  }, CTX, NOW)!
  expect(m.id).toBe('weekly-sync')
  expect(m.title.length).toBe(M.TITLE_MAX)
  expect(m.status).toBe('scheduled')
  expect(m.agenda.length).toBe(M.AGENDA_MAX)
  expect(m.agenda[1]!.dept).toBe('d1')                      // a department's name works, kept as its id
  expect(m.attendees.length).toBe(2 + M.OTHERS_MAX)
  expect(m.attendees.find(a => a.id === 'owner')!.name).toBe('Sam')   // the owner keeps the config's name
  expect(m.attendees.find(a => a.id === 'ada')!.name).toBe('Ada')
  expect(m.attendees.find(a => a.id === 'guest-0')!.dept).toBe('chair')
  expect(m.turns.length).toBe(2)                            // the stranger's turn is refused
  expect(m.turns[0]!.n).toBe(5)
  expect(m.turns[0]!.text).toBe('Ship it.\n\nToday.')        // control characters out, paragraph breaks kept
  expect(m.turns[1]!.kind).toBe('note')
  expect(m.turns[1]!.text.length).toBe(M.TEXT_MAX)
})

test('a meeting file over the cap, not JSON, or without an id is no meeting', async () => {
  expect(M.parseMeeting('{"id":"a","pad":"' + 'x'.repeat(M.FILE_MAX) + '"}', CTX)).toBe(undefined)
  expect(M.parseMeeting('{ nope', CTX)).toBe(undefined)
  expect(M.parseMeeting('[1,2]', CTX)).toBe(undefined)
  expect(M.parseMeeting('{"title":"no id"}', CTX)).toBe(undefined)
  expect(M.parseMeeting(42, CTX)).toBe(undefined)
  expect(M.parseMeeting('{"id":"ok"}', CTX)!.attendees.map(a => a.id)).toEqual(['claude', 'owner'])
})

test('the tool merges a meeting and says what it did, never the words', async () => {
  const called = M.callMeeting(undefined, '  Plan\nthe   week ', CTX, NOW)
  expect('meeting' in called).toBe(true)
  const m0 = (called as { meeting: M.Meeting }).meeting
  expect(m0.title).toBe('Plan the week')
  expect('busy' in M.callMeeting(m0, 'again', CTX, NOW + 1000)).toBe(true)        // one at a time
  const r = M.mergeMeeting(m0, { status: 'in_session', attendees: [{ id: 'engineering' }],
    turn: { speaker_id: 'engineering', kind: 'proposal', title: 'Search', text: 'A secret plan only the transcript holds.' } }, CTX, NOW + 2000)
  expect(r.turn?.n).toBe(1)
  const report = M.mergeReport(r)
  expect(report).toMatch(/Recorded turn 1: proposal by Engineering/)
  expect(report.includes('secret plan')).toBe(false)
  const bad = M.mergeMeeting(r.meeting, { status: 'loud', turn: { speaker_id: 'nobody', text: 'hi' } }, CTX, NOW + 3000)
  expect(bad.turn).toBe(undefined)
  expect(bad.notes.join(' ')).toMatch(/status ignored.*turn not recorded: speaker_id "nobody" is not an attendee/)
  const ended = M.mergeMeeting(r.meeting, { status: 'ended' }, CTX, NOW + 4000).meeting
  expect(M.isLive(ended, NOW + 5000)).toBe(false)
  expect(M.mergeMeeting(ended, { turn: { speaker_id: 'claude', text: 'late' } }, CTX, NOW + 6000).notes[0]).toMatch(/ended/)
  expect(M.isLive(r.meeting, NOW + M.STALE_MS + 3000)).toBe(false)                // three quiet hours: over
})

test("the protocol prompt is generic: the config's people, nobody else's", async () => {
  const p = M.meetPrompt('Plan the week', CTX)
  expect(p).toMatch(/proposal/)
  expect(p).toMatch(/discussion/)
  expect(p).toMatch(/decision/)
  expect(p).toMatch(/engineering \(Engineering\)/)
  expect(p).toMatch(/Staff: ada\./)
  expect(p).toMatch(/\[Meeting\] Sam: /)
  expect(/memory/i.test(p)).toBe(false)                     // no file of anyone's: the protocol is all in the prompt
  expect(M.meetingLine('  I agree  ', CTX)).toBe('[Meeting] Sam: I agree')
})

test('the page view seats the chair at the head, the owner at the foot, and brings staff as themselves', async () => {
  const m = M.mergeMeeting(undefined, { id: 'm1', status: 'gathering', attendees: [{ id: 'review' }, { id: 'ada' }] }, CTX, NOW).meeting
  const v = M.meetingView(m, NOW, CTX)!
  const by = (id: string) => v.attendees.find(a => a.id === id)!
  expect(by('claude').seat).toBe(0)
  expect(by('owner').seat).toBe(1)
  expect(by('review').kind).toBe('agent')
  expect(by('review').desk).toBe('d1')
  expect(by('ada').kind).toBe('crew')
  expect(by('ada').crew).toBe('s0')
  expect(by('review').color).toBe('#ef4444')
})
