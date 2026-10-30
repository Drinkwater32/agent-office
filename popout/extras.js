// The office's extras: the usage gauge beside the title, the usage notice at the front desk, the whiteboard's face, and
// when the easter eggs play (engine.js draws them). Everything comes from the live list (staff.js, which engine.js
// polls and hands on as an `nr:data` event): numbers, clock times and colors are checked before they reach an
// attribute, and every word is set as text.
(function () {
  'use strict'
  const CFG = window.__aoCfg
  const svg = document.getElementById('nr')
  if (!CFG || !svg) return
  const NS = 'http://www.w3.org/2000/svg'
  const COLOR = /^#[0-9a-f]{6}$/i
  const CLOCK = /^\d{1,2}:\d{2} [AP]M$/
  const LABEL = /^[A-Za-z0-9 -]{1,20}$/
  const LEVELS = ['ok', 'amber', 'red']
  const isNum = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 4096
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    if (parent) parent.appendChild(e)
    return e
  }
  const FONT = "Consolas, 'Courier New', monospace"
  const office = () => window.__aoOffice

  // -- the whiteboard: primitives the plugin laid out (hooks/board.ts), drawn as SVG
  const wb = document.getElementById('nr-p-wb')
  let wbSig = null
  function board(list) {
    if (!wb) return
    const sig = JSON.stringify(list)
    if (sig === wbSig) return
    wbSig = sig
    for (const c of [...wb.childNodes]) if (c.nodeName !== 'clipPath') c.remove()
    if (!Array.isArray(list)) return
    const g = mk('g', { 'clip-path': 'url(#nr-clip-wb)' }, wb)
    for (const p of list.slice(0, 80)) {
      if (!p || typeof p !== 'object') continue
      if (Array.isArray(p.t)) {
        const [x, y, s, c, t, a, b] = p.t
        if (!isNum(x) || !isNum(y) || !isNum(s) || !COLOR.test(c)) continue
        const e = mk('text', { x, y, 'font-size': s, 'font-family': FONT, fill: c }, g)
        if (a === 'm') e.setAttribute('text-anchor', 'middle')
        else if (a === 'e') e.setAttribute('text-anchor', 'end')
        if (b) e.setAttribute('font-weight', 'bold')
        e.textContent = String(t || '').slice(0, 60)
      } else if (Array.isArray(p.r)) {
        const [x, y, w, h, c] = p.r
        if ([x, y, w, h].every(isNum) && COLOR.test(c)) mk('rect', { x, y, width: Math.max(0, w), height: Math.max(0, h), fill: c }, g)
      }
    }
  }

  // -- the usage gauge, always on screen: the 5-hour window's % and its reset time, this session's context window,
  // smaller. Each number is colored by its level (amber, red, by the config's thresholds). Checked numbers only.
  const rdg = r => (r && typeof r === 'object' && Number.isInteger(r.pct) && r.pct >= 0 && r.pct <= 100 && LEVELS.includes(r.level)
    ? { pct: r.pct, level: r.level } : null)
  const ro = document.createElement('div')
  ro.className = 'ro'
  ro.id = 'nr-use'
  ro.setAttribute('role', 'group')
  ro.setAttribute('aria-label', 'Usage')
  const part = cls => {
    const el = document.createElement('span')
    el.className = `ro-g ${cls}`
    const l = document.createElement('span')
    l.className = 'ro-l'
    const n = document.createElement('b')
    n.className = 'ro-n'
    const bar = document.createElement('i')
    bar.className = 'ro-bar'
    const fill = document.createElement('i')
    bar.append(fill)
    const r = document.createElement('span')
    r.className = 'ro-r'
    el.append(l, n, bar, r)
    ro.append(el)
    return { el, l, n, r, bar, fill }
  }
  const RM = part('ro-main')
  const RC = part('ro-ctx')
  // overtime's stopwatch, before the main window's label (shown only in overtime)
  const otWatch = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  otWatch.setAttribute('class', 'ro-ot')
  otWatch.setAttribute('viewBox', '0 0 9 10')
  otWatch.setAttribute('shape-rendering', 'crispEdges')
  otWatch.setAttribute('aria-hidden', 'true')
  for (const [d, f] of [['M3 0h3v1h-3zM4 1h1v1h-1zM2 2h5v1h1v1h1v4h-1v1h-1v1h-5v-1h-1v-1h-1v-4h1v-1h1z', '#fbbf24'],
    ['M3 3h3v1h1v3h-1v1h-3v-1h-1v-3h1z', '#1a0f26'], ['M4 4h1v2h1v1h-2z', '#fbbf24']]) {
    const pa = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    pa.setAttribute('d', d)
    pa.setAttribute('fill', f)
    otWatch.append(pa)
  }
  RM.el.prepend(otWatch)
  const LEFT = /^(under 1m|\d{1,2}m|\d{1,3}h \d{2}m)$/
  const barEl = document.querySelector('.bar')
  if (barEl) barEl.appendChild(ro)
  function gauge(v) {
    const o = v && typeof v === 'object' ? v : {}
    const main = rdg(o.main)
    const ctx = rdg(o.ctx)
    const name = main && typeof o.main.label === 'string' && LABEL.test(o.main.label) ? o.main.label : '5-hour'
    const resets = main && typeof o.main.resets === 'string' && CLOCK.test(o.main.resets) ? o.main.resets : ''
    RM.el.className = `ro-g ro-main ${main ? main.level : 'none'}`
    RM.l.textContent = name
    RM.n.textContent = main ? `${main.pct}%` : '–'
    RM.bar.hidden = !main
    RM.fill.style.width = `${main ? Math.max(4, main.pct) : 0}%`
    RM.r.textContent = resets ? `resets ${resets}` : ''
    RM.r.hidden = !resets
    // overtime (past the limit on extra usage): OVERTIME, the time to the reset, the stopwatch; the office after hours
    const over = !!(main && o.main.over === true)
    const left = over && typeof o.main.left === 'string' && LEFT.test(o.main.left) ? o.main.left : ''
    if (over) {
      RM.el.className = 'ro-g ro-main over'
      RM.l.textContent = 'OVERTIME'
      RM.n.textContent = left ? `${left} left` : ''
    }
    svg.setAttribute('data-over', over ? '1' : '0')
    RC.el.hidden = !ctx
    RC.el.className = `ro-g ro-ctx ${ctx ? ctx.level : 'none'}`
    RC.l.textContent = 'context'
    RC.n.textContent = ctx ? `${ctx.pct}%` : ''
    RC.bar.hidden = true
    RC.r.hidden = true
    ro.title = [over ? `Overtime: past the ${name} limit on extra usage${resets ? ` until ${resets}` : ''}`
      : main ? `${name} limit: ${main.pct}% used${resets ? `, resets ${resets}` : ''}` : 'No usage reading yet (it comes with the first reply on a subscription)',
      ctx ? `Context window: ${ctx.pct}% full` : ''].filter(Boolean).join('\n')
  }
  gauge(null)

  // -- the usage notice at the front desk: amber once a window passes the warning (the handoff being written, or
  // saved), red while the office is closed
  const desk = document.getElementById('fd-desk')
  const head = desk && desk.querySelector('.fd-head')
  const note = document.createElement('div')
  note.className = 'use-note'
  note.hidden = true
  note.setAttribute('role', 'status')
  const nb = document.createElement('b')
  const ns = document.createElement('span')
  const ne = document.createElement('em')
  note.append(nb, ns, ne)
  if (head) head.after(note)
  function notice(u) {
    const pct = u && Number.isInteger(u.pct) && u.pct >= 0 && u.pct <= 100 ? u.pct : null
    const kind = u && typeof u.kind === 'string' && LABEL.test(u.kind) ? u.kind : ''
    const until = u && typeof u.until === 'string' && CLOCK.test(u.until) ? u.until : ''
    const closed = !!(u && u.closed === true)
    note.hidden = !(closed || (u && u.warn === true && pct !== null))
    if (note.hidden) return
    note.classList.toggle('shut', closed)
    nb.textContent = closed ? 'Closed' : `Usage ${pct}%`
    ns.textContent = closed ? (until ? `Opens again at ${until}` : 'Opens again when the limit resets')
      : `${kind ? `${kind} limit` : 'limit'} · at the close the office shuts until it resets`
    ne.textContent = u.asked ? (u.saved ? 'Handoff saved' : 'Writing handoff') : ''
  }

  document.addEventListener('nr:data', e => {
    const d = e.detail && e.detail.data
    if (!d) return
    gauge(d.readout)
    notice(d.usage)
    board(d.board)
  })

  // -- easter eggs (README's "Spoilers"). The engine draws them (window.__aoOffice.egg); this decides when. None makes
  // a sound or waits on the chat. A long press plays one; a short click does what it always did (Claude at the front
  // desk, the screen's "Call a meeting", the lists): only the click that ends a long press that played is taken.
  const EGG = CFG.eggs || {}
  const egg = name => !!(office() && office().egg && office().egg(name))
  const isBox = a => Array.isArray(a) && a.length === 4 && a.every(isNum)
  let press = null
  let swallowUntil = 0
  let brews = []
  function artPoint(e) {
    const vb = svg.viewBox.baseVal
    const r = svg.getBoundingClientRect()
    return [(vb.x + (e.clientX - r.left) / r.width * vb.width) / 2, (vb.y + (e.clientY - r.top) / r.height * vb.height) / 2]
  }
  function pressedOn(e) {
    const [ax, ay] = artPoint(e)
    if (office() && office().petAt && office().petAt(ax, ay)) return 'dance'
    const zones = EGG.press || {}
    return Object.keys(zones).find(k => isBox(zones[k]) && ax >= zones[k][0] && ax <= zones[k][2] && ay >= zones[k][1] && ay <= zones[k][3]) || ''
  }
  function longPress(what) {
    if (what === 'dance') return !!(office() && office().dance && office().dance())
    if (what === 'coffee') {                          // three presses inside half a minute; a puff of steam till then
      const now = Date.now()
      brews = brews.filter(t => now - t < 30_000).concat(now)
      if (brews.length < 3) return egg('puff')
      brews = []
      return egg('coffee')
    }
    return egg(what)
  }
  svg.addEventListener('pointerdown', e => {
    if (e.button > 0) return
    const what = pressedOn(e)
    if (!what) return
    const p = { x: e.clientX, y: e.clientY, fired: false }
    p.timer = setTimeout(() => {
      p.fired = true
      if (longPress(what) && navigator.vibrate) navigator.vibrate(30)
    }, 550)
    press = p
  })
  svg.addEventListener('pointermove', e => {
    if (press && !press.fired && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
      clearTimeout(press.timer)
      press = null
    }
  })
  const end = () => {
    if (!press) return
    clearTimeout(press.timer)
    if (press.fired) swallowUntil = Date.now() + 800       // the click this press ends in is the egg's
    press = null
  }
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', end)
  svg.addEventListener('pointerleave', end)
  svg.addEventListener('contextmenu', e => { if (press || Date.now() < swallowUntil) e.preventDefault() })
  window.addEventListener('click', e => {
    if (Date.now() < swallowUntil && e.target.closest && e.target.closest('#nr')) {
      swallowUntil = 0
      e.stopImmediatePropagation()
      e.preventDefault()
    }
  }, true)

  // midnight on this machine's clock: the lights flicker (once a day in a tab)
  function onceToday(k) {
    const d = new Date()
    const date = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    try {
      if (sessionStorage.getItem(k) === date) return false
      sessionStorage.setItem(k, date)
    } catch (e) { /* private window: once a page load */ }
    return true
  }
  setInterval(() => {
    const d = new Date()
    if (d.getHours() === 0 && d.getMinutes() === 0 && onceToday('ao-egg-midnight')) egg('midnight')
  }, 20_000)
  // one page load in fifty: a paper airplane, a little while after it opens
  if (Math.random() < 1 / 50) setTimeout(() => egg('plane'), 15_000 + Math.random() * 60_000)
  // the Konami code, on a keyboard, anywhere but a text box
  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a']
  let keys = []
  document.addEventListener('keydown', e => {
    const t = e.target
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
    keys = keys.concat(String(e.key || '').toLowerCase().slice(0, 12)).slice(-KONAMI.length)
    if (keys.join() === KONAMI.join()) {
      keys = []
      egg('konami')
    }
  })

  window.__aoExtrasDebug = { egg, gauge, notice, board }
})()
