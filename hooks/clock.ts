// Time on this machine's own clock: the sky, the seasons' decor, the usage readout's reset time and the whiteboard's
// countdown all read it. Nothing here asks the network what time or weather it is.

export type Season = '' | 'halloween' | 'thanksgiving' | 'holiday'

/** "3:40 PM" on this machine's clock. */
export function clockText(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
/** A time to come: "3:40 PM" today, "Sat 3:40 PM" within the week, "Nov 5, 3:40 PM" past that. */
export function whenText(ms: number, now: number): string {
  const d = new Date(ms)
  if (sameDay(d, new Date(now))) return clockText(ms)
  if (ms - now < 6 * 86_400_000) return `${DAYS[d.getDay()]} ${clockText(ms)}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${clockText(ms)}`
}

/** How long until then, in the whiteboard's short words: "42M", "5H 07M", "3D 4H". */
export function untilText(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m}M`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}H ${String(m % 60).padStart(2, '0')}M`
  return `${Math.floor(h / 24)}D ${h % 24}H`
}

/**
 * The season's decor by the date: Halloween through November 1, Thanksgiving (the fourth Thursday of November) from
 * November 2, the holidays from the day after it through January 2; none the rest of the year.
 */
export function seasonOf(now: number): Season {
  const d = new Date(now)
  const y = d.getFullYear()
  const md = (d.getMonth() + 1) * 100 + d.getDate()
  const firstDow = new Date(y, 10, 1).getDay()
  const thanks = 1 + ((4 - firstDow + 7) % 7) + 21
  if (md >= 1001 && md <= 1101) return 'halloween'
  if (md >= 1102 && md <= 1100 + thanks) return 'thanksgiving'
  if (md > 1100 + thanks || md <= 102) return 'holiday'
  return ''
}
