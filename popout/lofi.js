// The office's lo-fi soundtrack: off on every load, and it plays only once you turn it on (browsers allow sound only
// after a click anyway). The loop is the plugin's own file (lofi.wav, made from scratch by tools/make_lofi.py), read
// from the local bridge like the scripts (a fetch, so the page's CSP needs nothing new) and played through Web Audio,
// looped without a seam. A mute button sits beside the toggle while it plays, both in the office's title bar. Once on,
// it keeps playing in a hidden, minimized or covered window until you turn it off or mute it; if the browser itself
// suspends the sound, it resumes on your return or your next click or key. `soundtrack.enabled: false` in the config
// leaves the toggle out entirely. Its style is in office.css.
(function () {
  'use strict'
  const CFG = window.__aoCfg || {}
  const KEY = new URLSearchParams(location.search).get('k') || ''
  const AC = window.AudioContext || window.webkitAudioContext
  if (CFG.soundtrack === false || !/^[\w-]{40,}$/.test(KEY) || !/^https?:$/.test(location.protocol) || !AC) return
  const VOL = 0.35
  let ctx = null
  let gain = null
  let buf = null
  let src = null
  let state = 'off'                                  // off, loading, on, error
  let muted = false

  // the icons, pixel paths built as SVG elements: a note, and a speaker (its sound waves, or a cross when muted)
  const SVGNS = 'http://www.w3.org/2000/svg'
  function icon(paths) {
    const s = document.createElementNS(SVGNS, 'svg')
    for (const [k, v] of [['viewBox', '0 0 8 8'], ['width', '14'], ['height', '14'], ['aria-hidden', 'true'], ['shape-rendering', 'crispEdges']]) s.setAttribute(k, v)
    for (const [cls, d] of paths) {
      const p = document.createElementNS(SVGNS, 'path')
      p.setAttribute('fill', 'currentColor')
      p.setAttribute('d', d)
      if (cls) p.setAttribute('class', cls)
      s.appendChild(p)
    }
    return s
  }
  const NOTE = [['', 'M3 0h5v5h-1v1h-2v-1h1v-3h-2v4h-1v1h-2v-1h1v-1h1z']]
  const SPK = [['', 'M0 3h2l2-2h1v6h-1l-2-2h-2z'], ['w', 'M6 2h1v4h-1z'], ['x', 'M6 2h1v1h-1zM7 3h1v1h-1zM6 4h1v1h-1zM7 5h1v1h-1z']]

  async function load() {
    const r = await fetch(`lofi.wav?k=${encodeURIComponent(KEY)}`, { credentials: 'omit', cache: 'no-cache' })
    if (!r.ok) throw new Error('not loaded')
    const ab = await r.arrayBuffer()
    if (ab.byteLength > 2_000_000) throw new Error('too large')
    return new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej))
  }
  function play() {
    src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(gain)
    src.start()
  }
  async function turnOn() {
    try {
      if (!ctx) {                                    // made inside the click, so the browser lets it sound
        ctx = new AC()
        gain = ctx.createGain()
        gain.gain.value = VOL
        gain.connect(ctx.destination)
      }
      if (ctx.state === 'suspended') resume()
      ctx.onstatechange = wake
      state = 'loading'
      draw()
      if (!buf) buf = await load()
      if (state !== 'loading') return               // turned off while it loaded
      muted = false
      gain.gain.value = VOL
      play()
      state = 'on'
    } catch (e) {
      state = 'error'
    }
    draw()
  }
  function turnOff() {
    if (src) {
      try { src.stop() } catch (e) { /* already stopped */ }
      src.disconnect()
      src = null
    }
    state = 'off'
    muted = false
    draw()
  }
  function setMute(m) {
    if (!gain) return
    muted = m
    gain.gain.setTargetAtTime(m ? 0 : VOL, ctx.currentTime, 0.04)
    draw()
  }
  // never paused here: if the browser suspended the sound (some do in a background tab), wake it when it can
  function wake() {
    if (ctx && state === 'on' && ctx.state !== 'running' && ctx.state !== 'closed') resume()
  }
  function resume() {
    try {
      const p = ctx.resume()
      if (p && p.catch) p.catch(() => undefined)        // not allowed yet: the next click or key tries again
    } catch (e) { /* an old browser */ }
  }
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('pointerdown', wake, true)
  window.addEventListener('keydown', wake, true)

  // -- the controls: two buttons side by side, the same height (the toggle, and mute while it plays)
  const g = document.createElement('div')
  g.className = 'lofi'
  g.setAttribute('role', 'group')
  g.setAttribute('aria-label', 'Soundtrack')
  const t = document.createElement('button')
  t.type = 'button'
  t.className = 'lf-toggle'
  const m = document.createElement('button')
  m.type = 'button'
  m.className = 'lf-mute'
  m.appendChild(icon(SPK))
  t.addEventListener('click', () => (state === 'off' || state === 'error' ? turnOn() : turnOff()))
  m.addEventListener('click', () => setMute(!muted))
  g.append(t, m)
  function draw() {
    t.replaceChildren(icon(NOTE), document.createTextNode(state === 'on' ? 'Lo-fi on' : state === 'loading' ? 'Lo-fi…' : state === 'error' ? 'Lo-fi: retry' : 'Lo-fi'))
    t.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false')
    t.title = state === 'on' ? 'Stop the lo-fi soundtrack' : 'Play a lo-fi soundtrack'
    m.hidden = state !== 'on'
    m.classList.toggle('muted', muted)
    m.setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
    m.title = muted ? 'Unmute' : 'Mute'
  }
  const bar = document.querySelector('.bar')
  const h1 = bar && bar.querySelector('h1')
  if (bar) bar.insertBefore(g, h1 ? h1.nextSibling : bar.firstChild)
  draw()
  window.__aoLofi = { get state() { return state }, get muted() { return muted } }
})()
