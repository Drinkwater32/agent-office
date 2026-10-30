// The codes typed at the front desk that the office keeps for itself: each plays something in the office and never
// reaches Claude. Three guards: the page (frontdesk.js, which reads these patterns from layout.js) catches a code
// before it sends; the bridge (bridge.py, the same pattern) drops one that is posted anyway; and register.tsx drops one
// that reaches it from the bridge (an older page, say). The rest of the easter eggs need nothing from here: they live
// in the page (extras.js, engine.js). The README's "Spoilers" lists them all.

export const EGG_CODES = {
  confetti: '^\\s*/confetti\\s*$',
} as const
export type EggCode = keyof typeof EGG_CODES

const RES = (Object.keys(EGG_CODES) as EggCode[]).map(k => [k, new RegExp(EGG_CODES[k], 'i')] as const)

/** Which code a message is, if it is one (a code is short: anything longer is a message). */
export function eggOf(text: unknown): EggCode | undefined {
  const t = typeof text === 'string' ? text : ''
  if (!t || t.length > 40) return undefined
  return RES.find(([, re]) => re.test(t))?.[0]
}
