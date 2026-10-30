// agent-office, walking: the page's own engine. The plugin draws the office once (office.html) with the floor plan in
// window.__aoCfg (layout.js); this script puts the people in it and moves them about. Every few seconds it reads the
// live list (staff.js: through the bridge by fetch, which a 304 answers while nothing changed; from a file by a
// script tag, the one way a file page can read another) and updates the page in place: agents walk in from the
// entrance to a free workstation in their department, work there with their bubble, and when they finish walk their
// report to Claude at the front desk and leave. The staff work at their desks, take breaks in the kitchen and the
// lounge, and stop to talk when they meet; every few minutes one of them drops by your office. The pets wander
// between your office, the lobby, the lounge and the kitchen, and now and then get up to something of their own. A
// meeting (conference.js says who and where) walks its attendees to the conference room; the office closes when the
// usage guard says so (the live list's usage). The easter eggs are drawn here; extras.js decides when. The chat
// (frontdesk.js) tells the office what is said through window.__aoOffice. Nothing on the page ever reloads; text from
// the lists is only ever set as text.
(function () {
  'use strict'
  const CFG = window.__aoCfg
  const svg = document.getElementById('nr')
  const stage = document.getElementById('nr-stage')
  const over = document.getElementById('nr-over')
  if (!CFG || !svg || !stage || !over) return
  const NS = 'http://www.w3.org/2000/svg'
  const defs = svg.querySelector('defs')
  const STEP = 1 / 12            // the world moves in twelfths of a second: a walk cycle with a pixel-art feel
  const OUT = '#1a0f26'
  const KEY = new URLSearchParams(location.search).get('k') || ''
  const q = KEY ? `k=${encodeURIComponent(KEY)}&` : ''
  let shut = false               // the office is closed (the usage guard): see setShut
  let ownerAway = false          // you are in a meeting: your chair is empty
  let claudeAway = false         // Claude chairs a meeting: the front desk is empty
  const extraFolk = new Set()    // people who are not the staff or an agent: a meeting's attendees from elsewhere

  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag)
    for (const k in attrs) e.setAttribute(k, attrs[k])
    if (parent) parent.appendChild(e)
    return e
  }
  const rnd = (a, b) => a + Math.random() * (b - a)
  const pick = arr => arr[Math.floor(Math.random() * arr.length)]
  let NOW = 0

  // -- the walking graph
  const N = CFG.nodes
  const adj = {}
  for (const [a, b] of CFG.edges) {
    (adj[a] = adj[a] || []).push(b)
    ;(adj[b] = adj[b] || []).push(a)
  }
  const gap = (a, b) => Math.hypot(N[a][0] - N[b][0], N[a][1] - N[b][1])
  // the nodes from a to b, without a (Dijkstra; the graph is small)
  function route(a, b) {
    if (a === b || !N[a] || !N[b]) return []
    const dist = { [a]: 0 }
    const prev = {}
    const open = new Set([a])
    while (open.size) {
      let u = null
      for (const n of open) if (u === null || dist[n] < dist[u]) u = n
      open.delete(u)
      if (u === b) break
      for (const v of adj[u] || []) {
        const d = dist[u] + gap(u, v)
        if (dist[v] === undefined || d < dist[v]) {
          dist[v] = d
          prev[v] = u
          open.add(v)
        }
      }
    }
    if (dist[b] === undefined) return [b]
    const out = []
    for (let n = b; n !== a; n = prev[n]) out.unshift(n)
    return out
  }

  // -- the stage: the furniture stays put in depth order; people and their props slot in between by their feet. What
  // the page drew for a script-less view (the crew and agents standing still, their bubbles, taken seats) goes.
  document.querySelectorAll('.nr-static').forEach(u => {
    const holder = u.parentNode && u.parentNode.parentNode === stage ? u.parentNode : u
    holder.remove()
  })
  svg.querySelectorAll('.nr-seat.on').forEach(g => g.classList.remove('on'))
  svg.querySelectorAll('.nr-tag').forEach(t => t.setAttribute('display', 'none'))
  const statics = [...stage.children].map(el => ({ el, z: +el.getAttribute('data-z') }))
  const above = z => {           // the first piece of furniture in front of depth z
    let lo = 0
    let hi = statics.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (statics[m].z <= z) lo = m + 1
      else hi = m
    }
    return lo
  }
  const actors = new Set()       // anything with .el and .z
  function sortStage() {
    const list = [...actors].sort((p, q2) => p.z - q2.z)
    for (let i = list.length - 1; i >= 0; i--) {
      const k = above(list[i].z)
      const anchor = statics[k] ? statics[k].el : null
      const next = list[i + 1] && above(list[i + 1].z) === k ? list[i + 1].el : anchor
      if (list[i].el.nextSibling !== next || list[i].el.parentNode !== stage) stage.insertBefore(list[i].el, next)
    }
  }

  // -- sprites: the crew's are in the page; an agent's come in sprites.js, with a stand-in until they do
  const have = new Set([...defs.querySelectorAll('g[id^="sp-"]')].map(g => g.id))
  const skins = {}
  const COLOR = /^#[0-9a-f]{6}$/i
  const PATH = /^[Mmhv0-9 -]+$/
  window.__aoSprites = all => {
    if (!all || typeof all !== 'object') return
    for (const key of Object.keys(all)) {
      if (!/^a[0-9a-z]+$/.test(key) || have.has(`sp-${key}-f0`)) continue
      const set = all[key]
      if (!set || !set.f) continue
      if (COLOR.test(set.skin)) skins[key] = set.skin
      for (const f of Object.keys(set.f)) {
        if (!/^[a-z0-9]+$/.test(f)) continue
        const g = mk('g', { id: `sp-${key}-${f}` }, defs)
        for (const p of set.f[f] || []) {
          if (!COLOR.test(p[0]) || !PATH.test(p[1])) continue
          const a = { fill: p[0], d: p[1] }
          if (typeof p[2] === 'number') a['fill-opacity'] = p[2]
          mk('path', a, g)
        }
        have.add(g.id)
      }
    }
  }
  let spritesVer = null
  function loadSprites(v) {
    spritesVer = v
    const s = document.createElement('script')
    s.src = `sprites.js?${q}v=${encodeURIComponent(v)}&t=${Date.now()}`
    s.onload = s.onerror = () => s.remove()
    document.head.appendChild(s)
  }

  // -- bubbles: an agent's says what it last said, two lines at most, or thinks with its dots going; the crew's are
  // lighter. Clamped inside the room the speaker stands in.
  function wrap(s, width, max) {
    const out = []
    let cur = ''
    for (let word of String(s).split(' ')) {
      while (word.length > width) {
        if (cur) out.push(cur)
        out.push(word.slice(0, width))
        cur = ''
        word = word.slice(width)
      }
      if (!cur) cur = word
      else if (cur.length + 1 + word.length <= width) cur += ' ' + word
      else {
        out.push(cur)
        cur = word
      }
    }
    if (cur) out.push(cur)
    if (out.length > max) {
      out.length = max
      out[max - 1] = out[max - 1].slice(0, width - 1).replace(/[\s,;:]+$/, '') + '…'
    }
    return out
  }
  const roomAt = (x, y) => CFG.rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)
  function bubble(kind, words, cx, tip) {
    const g = mk('g', { class: `nr-bubble nr-${kind}` })
    const room = roomAt(cx, tip + 12) || { x: 0, w: CFG.aw || 344 }
    if (kind === 'think') {
      const x = cx - 7
      const y = tip - 9
      mk('rect', { x: x - 1, y, width: 16, height: 7, fill: OUT }, g)
      mk('rect', { x, y: y - 1, width: 14, height: 9, fill: OUT }, g)
      mk('rect', { x, y, width: 14, height: 7, fill: '#ffffff' }, g)
      mk('rect', { x: cx - 1, y: y + 7, width: 2, height: 1, fill: '#ffffff' }, g)
      for (let i = 0; i < 3; i++) {
        const d = mk('rect', { x: x + 3 + i * 3, y: y + 3, width: 2, height: 2, fill: '#5b4a86' }, g)
        mk('animate', { attributeName: 'opacity', values: '.25;1;.25', dur: '1.2s', begin: `${i * 0.3}s`,
          repeatCount: 'indefinite' }, d)
      }
      return g
    }
    const agent = kind === 'agent'
    const lines = wrap(words, agent ? 24 : 22, 2)
    const cw = agent ? 1.98 : 1.87
    const w = Math.ceil(Math.max(...lines.map(l => l.length)) * cw) + (agent ? 6 : 5)
    const h = Math.ceil(lines.length * (agent ? 4.5 : 4.3) + (agent ? 3.5 : 2.5))
    const x = Math.max(room.x + 1, Math.min(room.x + room.w - 1 - w, Math.round(cx - w / 2)))
    const y = Math.max(1, tip - 2 - h)
    const t = Math.max(x + 3, Math.min(x + w - 4, cx))
    const edge = agent ? OUT : '#7a6c96'
    const fillOp = agent ? '1' : '.94'
    mk('rect', { x: x - 1, y, width: w + 2, height: h, fill: edge }, g)
    mk('rect', { x, y: y - 1, width: w, height: h + 2, fill: edge }, g)
    mk('rect', { x: t - 2, y: y + h, width: 5, height: 1, fill: edge }, g)
    mk('rect', { x: t - 1, y: y + h + 1, width: 3, height: 1, fill: edge }, g)
    mk('rect', { x: t, y: y + h + 2, width: 1, height: 1, fill: edge }, g)
    mk('rect', { x, y, width: w, height: h, fill: '#ffffff', 'fill-opacity': fillOp }, g)
    mk('rect', { x: t - 1, y: y + h, width: 3, height: 1, fill: '#ffffff' }, g)
    mk('rect', { x: t, y: y + h + 1, width: 1, height: 1, fill: '#ffffff' }, g)
    lines.forEach((line, i) => {
      const tx = mk('text', { x: x + (agent ? 3 : 2.5), y: y + (agent ? 5.1 : 4.4) + i * (agent ? 4.5 : 4.3),
        'font-size': agent ? 3.6 : 3.4, 'font-family': "Consolas, 'Courier New', monospace",
        fill: agent ? '#2b2342' : '#4a3f63', 'font-weight': agent ? 'bold' : 'normal' }, g)
      tx.textContent = line
    })
    return g
  }

  // -- a person: a sprite in the stage at integer pixels, its shadow, a prop (hands typing, a laptop) and a bubble
  class Who {
    constructor(kind, id, sprite, node) {
      this.kind = kind
      this.id = id
      this.sprite = sprite
      this.node = node
      this.x = N[node][0]
      this.y = N[node][1]
      this.dir = 'down'
      this.pose = 'stand'
      this.poseT = 0
      this.path = []
      this.walked = 0
      this.speed = kind === 'agent' ? 22 : 17
      this.el = mk('g', { class: 'nr-who' })
      this.shadow = mk('rect', { x: 2, y: 20, width: 8, height: 1, fill: '#140a24', 'fill-opacity': '.22' }, this.el)
      this.use = mk('use', {}, this.el)
      this.prop = null
      this.said = null
      this.cache = {}
      actors.add(this)
    }
    get z() { return Math.round(this.y) }
    goTo(target, then) {
      const head = this.path.length ? [this.path[0]] : []
      const ids = route(head.length ? head[0].id : this.node, target)
      this.path = head.concat(ids.map(id => ({ id, x: N[id][0], y: N[id][1] })))
      this.dropProp()
      if (!this.path.length) {
        this.pose = 'stand'
        if (then) then()
        return
      }
      this.pose = 'walk'
      this.then = then
    }
    step(dt) {
      if (this.pose !== 'walk' || this.paused) return
      let left = this.speed * dt
      while (left > 0 && this.path.length) {
        const p = this.path[0]
        const dx = p.x - this.x
        const dy = p.y - this.y
        const d = Math.hypot(dx, dy)
        if (d > 0.01) this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
        if (d <= left) {
          this.x = p.x
          this.y = p.y
          left -= d
          this.walked += d
          this.node = p.id
          this.path.shift()
        } else {
          this.x += dx / d * left
          this.y += dy / d * left
          this.walked += left
          left = 0
        }
      }
      if (!this.path.length) {
        this.pose = 'stand'
        const t = this.then
        this.then = null
        if (t) t()
      }
    }
    // a prop drawn with the person but at its own depth: hands on a keyboard in front of a desk, a laptop on a lap
    setProp(kind, z, skin) {
      this.dropProp()
      const el = mk('g', {})
      const hand = (x, y, w, h, ph) => {
        const r = mk('rect', { x, y, width: w, height: h, fill: skin }, el)
        mk('animate', { attributeName: 'y', values: `${y};${y - 1};${y}`, dur: '.36s', begin: `${ph}s`,
          repeatCount: 'indefinite' }, r)
      }
      if (kind === 'seat') {
        hand(0, 16, 2, 1, 0)
        hand(8, 16, 2, 1, 0.18)
      } else if (kind === 'desk') {
        hand(1, 12, 2, 1, 0)
        hand(9, 12, 2, 1, 0.18)
      } else if (kind === 'laptop') {
        mk('rect', { x: 1, y: 10, width: 10, height: 7, fill: OUT }, el)
        mk('rect', { x: 2, y: 11, width: 8, height: 5, fill: '#c9cdd8' }, el)
        mk('rect', { x: 2, y: 15, width: 8, height: 1, fill: '#a9adba' }, el)
        mk('rect', { x: 5, y: 13, width: 2, height: 1, fill: '#a78bfa' }, el)
        hand(1, 14, 1, 2, 0)
        hand(10, 14, 1, 2, 0.2)
      }
      this.prop = { el, z }
      actors.add(this.prop)
    }
    dropProp() {
      if (!this.prop) return
      actors.delete(this.prop)
      this.prop.el.remove()
      this.prop = null
    }
    frame() {
      const v = this.dir === 'up' ? 'b' : this.dir === 'down' ? 'f' : 's'
      const since = NOW - this.poseT
      if (this.pose === 'walk' && !this.paused) return v + [1, 0, 2, 0][Math.floor(this.walked / 3) % 4]
      if (this.react && this.react.until > NOW) return this.react.frame      // an easter egg's cheer: arms up
      switch (this.pose) {
        case 'type': case 'lounge': return 'f0'
        case 'sip': return since % 6 < 4.4 ? 'fs1' : 'fs2'
        case 'phone': case 'beanphone': return 'fp'
        case 'stretch': return 'fu'
        case 'couch': case 'arcade': return 'b0'
        case 'brew':
          if (since < 4) return 'b0'
          return since % 6 < 4.4 ? 'fs1' : 'fs2'
        default: return v + '0'
      }
    }
    render() {
      const f = this.frame()
      const base = have.has(`sp-${this.sprite}-f0`) ? this.sprite : `g-${this.desk || 'd0'}`
      let id = `sp-${base}-${f}`
      if (!have.has(id)) id = `sp-${base}-${f[0]}0`  // an agent has no sip or phone frames: it stands
      let jx = 0
      if (this.pose === 'foos') jx = Math.floor(NOW * 3 + this.y) % 2
      const x = Math.round(this.x) + jx
      const y = Math.round(this.y)
      const flip = f[0] === 's' && this.dir === 'left'
      const tr = `translate(${x - 6} ${y - 20})`
      const sitting = this.pose === 'couch' || this.pose === 'lounge' || this.pose === 'beanphone'
      const c = this.cache
      if (c.tr !== tr) this.el.setAttribute('transform', (c.tr = tr))
      if (c.id !== id) this.use.setAttribute('href', '#' + (c.id = id))
      if (c.flip !== flip) {
        c.flip = flip
        if (flip) this.use.setAttribute('transform', 'translate(12 0) scale(-1 1)')
        else this.use.removeAttribute('transform')
      }
      if (c.sit !== sitting) this.shadow.setAttribute('display', (c.sit = sitting) ? 'none' : 'inline')
      if (this.prop && this.prop.tr !== tr) this.prop.el.setAttribute('transform', (this.prop.tr = tr))
      const reacting = !!(this.react && this.react.until > NOW && this.pose !== 'walk')
      if (this.prop && this.prop.hid !== reacting) {    // hands off the keyboard while they cheer
        this.prop.hid = reacting
        this.prop.el.setAttribute('display', reacting ? 'none' : 'inline')
      }
      // the bubble
      const want = this.hidden ? null : this.speech()
      const key = want ? `${want.kind}|${want.text}|${x}|${y}` : ''
      if (key !== (this.said && this.said.key)) {
        if (this.said) this.said.el.remove()
        this.said = want ? { key, el: over.appendChild(bubble(want.kind, want.text, x, y - 21)) } : null
      }
    }
    speech() { return null }
    remove() {
      this.dropProp()
      actors.delete(this)
      this.el.remove()
      if (this.said) this.said.el.remove()
    }
  }

  // -- little things that float and fade over the office: hearts, sparkles, a paper plane, a pizza slice
  const floats = []
  const HEART = 'M1 0h1v1h1v-1h1v1h1v2h-1v1h-1v1h-1v-1h-1v-1h-1v-2h1z'
  function float(kind, x, y, opts) {
    const o = Object.assign({ dur: 1.8, rise: 10, t0: NOW, x, y }, opts || {})
    const el = mk('g', {}, over)
    if (kind === 'heart') {
      mk('path', { d: HEART, fill: OUT, transform: 'translate(-.6 -.6) scale(1.24)' }, el)
      mk('path', { d: HEART, fill: o.color || '#ff5c9a' }, el)
    } else if (kind === 'spark') {
      for (const [dx, dy] of [[0, -3], [0, 3], [-3, 0], [3, 0], [-2, -2], [2, 2], [2, -2], [-2, 2]]) {
        mk('rect', { x: dx, y: dy, width: 1, height: 1, fill: '#fff3a3' }, el)
      }
    } else if (kind === 'plane') {
      mk('path', { d: 'M0 2h1v-1h2v-1h3v1h1v1h-1v1h-3v1h-2v-1h-1z', fill: OUT, transform: 'translate(-1 -1) scale(1.2)' }, el)
      mk('path', { d: 'M0 2h1v-1h2v-1h3v1h-3v1h3v1h-3v1h-2v-1h-1z', fill: '#fffdf6' }, el)
      mk('rect', { x: 3, y: 2, width: 3, height: 1, fill: '#c9c2d6' }, el)
    } else if (kind === 'confetti') {
      const wide = Math.random() < 0.5
      mk('rect', { x: 0, y: 0, width: wide ? 2 : 1, height: wide ? 1 : 2, fill: o.color || '#f4c542' }, el)
    } else if (kind === 'note') {                   // a music note, for the pets' dance
      mk('path', { d: 'M2 0h3v1h-2v4h-1v1h-2v-2h2z', fill: OUT, transform: 'translate(-.5 -.5) scale(1.2)' }, el)
      mk('path', { d: 'M2 0h3v1h-2v4h-1v1h-2v-2h2z', fill: o.color || '#fde047' }, el)
    } else if (kind === 'z') {                      // a napper's z
      mk('path', { d: 'M0 0h3v1h-1v1h-1v1h2v1h-3v-1h1v-1h1v-1h-2z', fill: OUT, transform: 'translate(-.5 -.5) scale(1.25)' }, el)
      mk('path', { d: 'M0 0h3v1h-1v1h-1v1h2v1h-3v-1h1v-1h1v-1h-2z', fill: '#e9e4ff' }, el)
    } else if (kind === 'bang') {                   // a pet's ears up: !
      mk('rect', { x: -1, y: -1, width: 3, height: 7, fill: OUT }, el)
      mk('rect', { x: 0, y: 0, width: 1, height: 3, fill: '#fde047' }, el)
      mk('rect', { x: 0, y: 4, width: 1, height: 1, fill: '#fde047' }, el)
    } else if (kind === 'txt') {                    // a word of ours, never anything from outside: 1UP
      const t = mk('text', { x: 0, y: 0, 'font-size': o.size || 4, 'font-weight': 'bold', 'text-anchor': 'middle', fill: o.color || '#fde047',
        stroke: OUT, 'stroke-width': '.8', 'paint-order': 'stroke', 'font-family': "Consolas, 'Courier New', monospace" }, el)
      t.textContent = String(o.text || '').slice(0, 12)
    } else if (kind === 'mug') {
      mk('rect', { x: -1, y: -1, width: 5, height: 5, fill: OUT }, el)
      mk('rect', { x: 0, y: 0, width: 3, height: 3, fill: '#fffdf6' }, el)
      mk('rect', { x: 3, y: 1, width: 1, height: 1, fill: '#fffdf6' }, el)
      mk('rect', { x: 0, y: 0, width: 3, height: 1, fill: '#7a4a24' }, el)
    } else if (kind === 'slice') {
      mk('path', { d: 'M0 0h4v1h-1v1h-1v1h-1v-1h-1z', fill: '#f4c542' }, el)
      mk('rect', { x: 0, y: 0, width: 4, height: 1, fill: '#c98a3a' }, el)
      mk('rect', { x: 1, y: 1, width: 1, height: 1, fill: '#d1452f' }, el)
    }
    o.el = el
    floats.push(o)
    return o
  }
  function floatTick() {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]
      const k = Math.min(1, (NOW - f.t0) / f.dur)
      let x = f.x
      let y = f.y - f.rise * k
      if (f.to) {                                   // a flight from one point to another, arcing up
        x = f.x + (f.to[0] - f.x) * k
        y = f.y + (f.to[1] - f.y) * k - Math.sin(Math.PI * k) * (f.arc || 14)
      }
      f.el.setAttribute('transform', `translate(${Math.round(x)} ${Math.round(y)})`)
      if (!f.to && !f.stay) f.el.setAttribute('opacity', k < 0.7 ? '1' : String(Math.max(0, (1 - k) / 0.3)))
      if (k >= 1 && !f.stay) {
        f.el.remove()
        floats.splice(i, 1)
        if (f.done) f.done()
      }
    }
  }

  // -- the staff: work at their desk, now and then a sip or a stretch; get up for a break somewhere free; maybe one
  // more; walk back. Two who meet on the way may stop for a word; two in spots side by side talk now and then.
  const crew = CFG.crew.map(c => {
    const w = new Who('crew', c.name, c.name, c.home)
    w.cfg = c
    w.lastChat = -99
    w.lines = []
    w.speech = function () {
      const l = this.lines.find(x => NOW >= x.from && NOW < x.to)
      return l ? { kind: 'crew', text: l.text } : null
    }
    return w
  })
  const VISIT = CFG.visit || null
  const OWNER = CFG.owner
  const visitor = VISIT ? crew.find(w => w.id === VISIT.who) : null      // the one who drops by your office
  const taken = {}
  const recentPairs = []
  function startWork(w) {
    w.state = 'work'
    w.dir = 'down'
    w.pose = w.cfg.pose
    w.poseT = NOW
    w.timer = NOW + rnd(25, 70)
    w.idleAt = NOW + rnd(8, 18)
    w.setProp(w.cfg.pose === 'lounge' ? 'laptop' : 'desk', w.cfg.pose === 'lounge' ? w.y + 1.5 : w.cfg.hz, w.cfg.skin)
  }
  function chooseSpot(w) {
    const free = Object.keys(CFG.spots).filter(id => !taken[id] && id !== w.lastSpot)
    if (!free.length) return null
    const weight = id => {
      const s = CFG.spots[id]
      const partner = s.pairs.some(p => taken[p] && taken[p].state === 'break')
      return s.weight * (partner ? 2.5 : 1)
    }
    let r = Math.random() * free.reduce((a, id) => a + weight(id), 0)
    for (const id of free) if ((r -= weight(id)) <= 0) return id
    return free[free.length - 1]
  }
  function goBreak(w) {
    const id = chooseSpot(w)
    if (!id) {
      startWork(w)
      w.timer = NOW + rnd(10, 20)
      return
    }
    taken[id] = w
    w.spot = id
    w.state = 'going'
    w.goTo(CFG.spots[id].node, () => atSpot(w))
  }
  function atSpot(w) {
    const s = CFG.spots[w.spot]
    w.state = 'break'
    w.pose = s.pose
    w.dir = s.dir
    w.poseT = NOW
    w.timer = NOW + rnd(18, 36)
    w.chatAt = NOW + rnd(1.5, 4)
  }
  function leaveSpot(w) {
    delete taken[w.spot]
    w.lastSpot = w.spot
    w.spot = null
    if (Math.random() < 0.35) return goBreak(w)
    w.state = 'going'
    w.goTo(w.cfg.home, () => startWork(w))
  }
  function chat(a, b, stop) {
    let i
    do i = Math.floor(Math.random() * CFG.chatter.length)
    while (recentPairs.includes(i) && CFG.chatter.length > 8)
    recentPairs.push(i)
    if (recentPairs.length > 8) recentPairs.shift()
    const [q1, r] = CFG.chatter[i]
    a.lines = [{ text: q1, from: NOW, to: NOW + 3.4 }]
    b.lines = [{ text: r, from: NOW + 3.6, to: NOW + 7 }]
    a.chatEnd = b.chatEnd = NOW + 7.2
    a.lastChat = b.lastChat = NOW
    a.chatting = b.chatting = true
    if (stop) {
      a.paused = b.paused = true
      a.dir = a.x <= b.x ? 'right' : 'left'
      b.dir = a.x <= b.x ? 'left' : 'right'
      if (Math.abs(a.x - b.x) < 4) {               // one above the other: face up and down
        a.dir = a.y < b.y ? 'down' : 'up'
        b.dir = a.y < b.y ? 'up' : 'down'
      }
    }
  }
  function crewTick(w) {
    if (w.chatting && NOW > w.chatEnd) {
      w.chatting = false
      w.paused = false
    }
    if (shut || w.state === 'meeting' || w.state === 'away' || w.state === 'leaving') return   // closed, or in a meeting
    if (w === visitor) return visitorTick(w)
    if (w.state === 'work') {
      if (NOW > w.timer && !w.chatting) {
        w.dropProp()
        goBreak(w)
      } else if (w.cfg.pose === 'type') idleAtDesk(w)
    } else if (w.state === 'break') {
      if (NOW > w.timer && !w.chatting) leaveSpot(w)
      else if (!w.chatting && NOW > w.chatAt) {
        const mate = CFG.spots[w.spot].pairs.map(p => taken[p]).find(p => p && p.state === 'break' && !p.chatting)
        if (mate) chat(w, mate, false)
        w.chatAt = NOW + rnd(10, 18)
      }
    }
  }
  function idleAtDesk(w) {
    if (w.pose === 'type' && NOW > w.idleAt) {
      w.pose = pick(['sip', 'stretch', 'phone', 'sip'])
      w.poseT = NOW
      w.idleEnd = NOW + (w.pose === 'stretch' ? 2.5 : rnd(5, 8))
      w.dropProp()
    } else if (w.pose !== 'type' && NOW > w.idleEnd) {
      w.pose = 'type'
      w.idleAt = NOW + rnd(10, 22)
      w.setProp('desk', w.cfg.hz, w.cfg.skin)
    }
  }
  function meetings() {                          // two walking past each other
    for (let i = 0; i < crew.length; i++) {
      const a = crew[i]
      if (a === visitor || a.state !== 'going' || a.paused || a.chatting || NOW - a.lastChat < 40) continue
      for (let j = i + 1; j < crew.length; j++) {
        const b = crew[j]
        if (b === visitor || b.state !== 'going' || b.paused || b.chatting || NOW - b.lastChat < 40) continue
        if (Math.hypot(a.x - b.x, a.y - b.y) > 12) continue
        const met = `${a.id}|${b.id}`
        if ((a.met || {})[met] > NOW) continue
        a.met = a.met || {}
        a.met[met] = NOW + 30
        if (Math.random() < 0.55) chat(a, b, true)
      }
    }
  }

  // -- you in your office, as the office sees you: your back to the room at the monitors, turning your chair when
  // someone drops by; your own bubble; the coffee and the sticky note they leave
  const owner = {
    at: OWNER.at,
    lines: [],
    said: null,
    turned: false,
    turn(on) {
      if (this.turned === on) return
      this.turned = on
      const back = document.getElementById('nr-owner-back')
      const turn = document.getElementById('nr-owner-turn')
      if (!back || !turn) return
      while (turn.firstChild) turn.firstChild.remove()
      back.setAttribute('display', on ? 'none' : 'inline')
      if (on) mk('use', { href: '#sp-owner-s0', x: OWNER.turnAt[0], y: OWNER.turnAt[1] }, turn)
    },
    say(text, from, dur) { this.lines.push({ text, from: NOW + (from || 0), to: NOW + (from || 0) + (dur || 3) }) },
    render() {
      this.lines = ownerAway || shut ? [] : this.lines.filter(l => l.to > NOW)
      const l = this.lines.find(x => NOW >= x.from)
      const key = l ? l.text : ''
      if (key === (this.said ? this.said.key : '')) return
      if (this.said) this.said.el.remove()
      this.said = l ? { key, el: over.appendChild(bubble('crew', l.text, this.at[0], this.at[1] - 21)) } : null
    },
  }
  const leftOnDesk = []          // [{ el, until }]
  function leave(kind, secs) {
    const el = mk('g', {}, over)
    if (kind === 'note') {
      const [x, y] = OWNER.monitor
      mk('rect', { x: x - 1, y: y - 1, width: 6, height: 6, fill: OUT }, el)
      mk('rect', { x, y, width: 4, height: 4, fill: '#fde68a' }, el)
      mk('path', { d: `M${x + 1} ${y + 1}h2v1h-2zM${x + 1} ${y + 2}h1v1h-1z`, fill: '#a16207' }, el)
    } else {
      const [x, y] = OWNER.desk
      mk('rect', { x: x - 1, y: y - 1, width: 5, height: 5, fill: OUT }, el)
      mk('rect', { x, y, width: 3, height: 3, fill: '#fffdf6' }, el)
      mk('rect', { x: x + 3, y: y + 1, width: 1, height: 1, fill: '#fffdf6' }, el)
      mk('rect', { x, y, width: 3, height: 1, fill: '#7a4a24' }, el)
      for (let i = 0; i < 2; i++) {
        const st = mk('rect', { x: x + i, y: y - 2, width: 1, height: 1, fill: '#ffffff', opacity: 0 }, el)
        mk('animate', { attributeName: 'opacity', values: '0;.8;0', dur: '1.8s', begin: `${i * 0.9}s`, repeatCount: 'indefinite' }, st)
      }
    }
    leftOnDesk.push({ el, until: NOW + secs })
  }

  // -- the visits: every few minutes a teammate gets up, goes to your office by its one door, does one small thing,
  // and walks back. Each moment: where they stand, which way they face, and what happens when, in seconds.
  const MOMENTS = {
    coffee: { spot: 'side', dir: 'left', len: 5.5, run: [
      [0, () => visitor.say('Coffee, fresh.', 0, 2.6)], [0.8, () => leave('mug', 120)],
      [1.6, () => owner.turn(true)], [2.8, () => owner.say('Thank you!', 0, 2.6)]] },
    monitors: { spot: 'side', dir: 'up', len: 7.5, run: [
      [0, () => visitor.say('How is the build going?', 0, 2.6)], [2.8, () => owner.say('Green, for now.', 0, 2.6)],
      [5.4, () => { owner.turn(true); visitor.say('Ha!', 0, 1.8); owner.say('Ha!', 0.3, 1.8) }]] },
    pizza: { spot: 'side', dir: 'left', len: 6.5, run: [
      [0, () => { visitor.say('Split a slice?', 0, 2.6); slice = float('slice', visitor.x + 5, visitor.y - 10, { stay: true }) }],
      [1.4, () => owner.turn(true)], [2.8, () => owner.say('Always.', 0, 2.2)],
      [5.2, () => { if (slice) { slice.el.remove(); floats.splice(floats.indexOf(slice), 1); slice = null } }]] },
    highfive: { spot: 'side', dir: 'left', len: 4.5, run: [
      [0, () => visitor.say('Big day. Nice work!', 0, 2.6)], [0.6, () => owner.turn(true)],
      [1.4, () => float('spark', owner.at[0] + 12, owner.at[1] - 13, { dur: 0.8, rise: 0 })], [2, () => owner.say('Team!', 0, 2)]] },
    note: { spot: 'side', dir: 'up', len: 5.5, run: [
      [0.6, () => leave('note', 300)], [1.2, () => visitor.say('Left you a note.', 0, 2.4)],
      [3.4, () => owner.say('Got it.', 0, 1.8)]] },
    perch: { spot: 'perch', dir: 'down', len: 8, run: [
      [0, () => visitor.say('Standup in five?', 0, 2.8)], [0.6, () => owner.turn(true)],
      [3.2, () => owner.say('On my way.', 0, 2.8)]] },
  }
  let slice = null
  const bag = []
  const pending = []
  let visitAt = 0
  function visitorTick(w) {
    if (w.state === 'work') {
      idleAtDesk(w)
      if (NOW > visitAt && !w.chatting && !ownerAway && !shut) startMoment(w)
    } else if (w.state === 'moment' && NOW > w.momentEnd) {
      owner.turn(false)
      w.state = 'going'
      w.goTo(w.cfg.home, () => { startWork(w); visitAt = NOW + rnd(180, 360) })
    }
  }
  function startMoment(w, name) {
    if (!bag.length) bag.push(...Object.keys(MOMENTS).sort(() => Math.random() - 0.5))
    const id = name && MOMENTS[name] ? name : bag.shift()
    const m = MOMENTS[id]
    w.dropProp()
    w.state = 'going'
    w.moment = id
    w.goTo(VISIT.spots[m.spot], () => {
      w.state = 'moment'
      w.pose = 'stand'
      w.dir = m.dir
      w.momentEnd = NOW + m.len
      for (const [t, fn] of m.run) pending.push({ at: NOW + t, fn })
    })
  }
  if (visitor) {
    visitor.say = function (text, from, dur) {
      this.lines = this.lines.filter(l => l.to > NOW)
      this.lines.push({ text, from: NOW + from, to: NOW + from + dur })
    }
    visitAt = rnd(45, 100)                       // the first visit comes soon after the page opens
  }

  // the start: a few already on a break, the rest at their desks (the visitor always at theirs)
  {
    const order = crew.filter(w => w !== visitor).sort(() => Math.random() - 0.5)
    order.forEach((w, i) => {
      if (i < 3) {
        const id = chooseSpot(w)
        if (id) {
          taken[id] = w
          w.spot = id
          w.node = CFG.spots[id].node
          w.x = N[w.node][0]
          w.y = N[w.node][1]
          atSpot(w)
          w.timer = NOW + rnd(6, 30)
          return
        }
      }
      startWork(w)
      w.timer = NOW + rnd(4, 45)
    })
    if (visitor) startWork(visitor)
  }

  // -- the pets: on a small graph of their own, between your office (by its one door), the lobby, the lounge, and
  // now and then the kitchen with their bowls. At a spot a pet curls up, loafs, sits up on your desk by a monitor,
  // stares out at the room, grooms, stretches, or rubs against your legs and gets a pat (a small heart).
  const CATCFG = CFG.cats || null
  const cats = []
  const catTaken = {}
  if (CATCFG) {
    const CN = CATCFG.nodes
    const cadj = {}
    for (const [a, b] of CATCFG.edges) {
      (cadj[a] = cadj[a] || []).push(b)
      ;(cadj[b] = cadj[b] || []).push(a)
    }
    const jumps = new Set()
    for (const [a, b] of CATCFG.jumps) jumps.add(`${a}|${b}`).add(`${b}|${a}`)
    const cgap = (a, b) => Math.hypot(CN[a][0] - CN[b][0], CN[a][1] - CN[b][1])
    const croute = (a, b) => {
      if (a === b || !CN[a] || !CN[b]) return []
      const dist = { [a]: 0 }
      const prev = {}
      const open = new Set([a])
      while (open.size) {
        let u = null
        for (const n of open) if (u === null || dist[n] < dist[u]) u = n
        open.delete(u)
        if (u === b) break
        for (const v of cadj[u] || []) {
          const d = dist[u] + cgap(u, v)
          if (dist[v] === undefined || d < dist[v]) {
            dist[v] = d
            prev[v] = u
            open.add(v)
          }
        }
      }
      if (dist[b] === undefined) return [b]
      const out = []
      for (let n = b; n !== a; n = prev[n]) out.unshift(n)
      return out
    }
    class Kitty {
      constructor(c) {
        this.i = c.i
        this.name = c.id
        this.label = String(c.name || 'Kitty').slice(0, 16)       // its name from the config, for what you say to it
        this.eyes = c.eyes && typeof c.eyes === 'object' ? c.eyes : {}
        this.glow = 0
        this.trick = null
        this.speed = c.speed
        this.size = c.size
        this.path = []
        this.walked = 0
        this.hop = 0
        this.dir = 'right'
        this.act = 'sit'
        this.until = 0
        this.spot = null
        this.spotZ = null
        this.el = mk('g', { class: 'nr-cat' })
        this.use = mk('use', {}, this.el)
        this.cache = {}
        actors.add(this)
      }
      get z() { return this.spotZ !== null && !this.path.length ? this.spotZ : Math.round(this.y) }
      place(node) {
        this.node = node
        this.x = CN[node][0]
        this.y = CN[node][1]
      }
      goTo(target, then) {
        const ids = croute(this.node, target)
        this.path = ids.map(id => ({ id, x: CN[id][0], y: CN[id][1] }))
        this.seg = null
        this.spotZ = null
        this.then = then
        this.act = 'walk'
        if (!this.path.length) {
          this.then = null
          if (then) then()
        }
      }
      step(dt) {
        if (!this.path.length) return
        let left = this.speed * dt
        while (left > 0 && this.path.length) {
          const p = this.path[0]
          if (!this.seg || this.seg.id !== p.id) {
            this.seg = { id: p.id, len: Math.max(0.01, Math.hypot(p.x - this.x, p.y - this.y)), jump: jumps.has(`${this.node}|${p.id}`) }
          }
          const dx = p.x - this.x
          const dy = p.y - this.y
          const d = Math.hypot(dx, dy)
          if (Math.abs(dx) > 0.01) this.dir = dx > 0 ? 'right' : 'left'
          if (d <= left) {
            this.x = p.x
            this.y = p.y
            left -= d
            this.walked += d
            this.node = p.id
            this.path.shift()
            this.seg = null
          } else {
            this.x += dx / d * left
            this.y += dy / d * left
            this.walked += left
            left = 0
          }
        }
        this.hop = this.seg && this.seg.jump ? Math.sin(Math.PI * (1 - Math.hypot(this.path[0].x - this.x, this.path[0].y - this.y) / this.seg.len)) * 7 : 0
        if (!this.path.length) {
          this.hop = 0
          const t = this.then
          this.then = null
          if (t) t()
        }
      }
      frame() {
        if (this.path.length) return this.seg && this.seg.jump ? 'stretch' : (Math.floor(this.walked / 2.5) % 2 ? 'w2' : 'w1')
        switch (this.act) {
          case 'rub': return Math.floor(NOW * 2) % 2 ? 'sit' : 'w1'
          case 'groom': return Math.floor(NOW / 0.7) % 2 ? 'groom' : 'sit'
          default: return this.act
        }
      }
      render() {
        const f = this.frame()
        const [w, h] = this.size[f] || this.size.sit
        const jx = this.act === 'rub' && !this.path.length ? Math.floor(NOW * 2) % 2 : 0
        const x = Math.round(this.x) - Math.floor(w / 2) + jx
        const y = Math.round(this.y - this.hop) - h
        const flip = this.dir === 'left' && f !== 'front'
        const c = this.cache
        const tr = `translate(${x} ${y})`
        if (c.tr !== tr) this.el.setAttribute('transform', (c.tr = tr))
        const id = `#sp-cat-${this.name}-${f}`
        if (c.id !== id) this.use.setAttribute('href', (c.id = id))
        const ft = flip ? `translate(${w} 0) scale(-1 1)` : ''
        if (c.ft !== ft) {
          c.ft = ft
          if (ft) this.use.setAttribute('transform', ft)
          else this.use.removeAttribute('transform')
        }
        // midnight: the eyes glow, in front of everything, where the frame has them open
        const eyes = this.glow > NOW && Array.isArray(this.eyes[f]) ? this.eyes[f] : null
        const gk = eyes ? `${f}|${x}|${y}|${flip}` : ''
        if (gk !== c.gk) {
          c.gk = gk
          if (this.glowEl) this.glowEl.remove()
          this.glowEl = null
          if (eyes) {
            this.glowEl = mk('g', { 'pointer-events': 'none' }, over)
            for (const [ex0, ey0] of eyes.slice(0, 4)) {
              const ex = x + (flip ? w - 1 - ex0 : ex0)
              const ey = y + ey0
              mk('rect', { x: ex - 1, y: ey - 1, width: 3, height: 3, fill: '#b6ff3b', opacity: '.35' }, this.glowEl)
              mk('rect', { x: ex, y: ey, width: 1, height: 1, fill: '#eaff9e' }, this.glowEl)
            }
          }
        }
      }
    }
    function catChoose(k) {
      const opts = []
      for (const id of Object.keys(CATCFG.spots)) {
        const sp = CATCFG.spots[id]
        if ((typeof sp.who === 'number' && sp.who !== k.i % 2) || (catTaken[id] && catTaken[id] !== k) || id === k.spot) continue
        if (sp.person === 'owner' && (owner.turned || ownerAway || shut || (visitor && visitor.state === 'moment'))) continue
        let w = sp.weight
        if (sp.room === 'kitchen') w = k.room === 'kitchen' ? 0 : 0.15
        else if (sp.room !== k.room) w *= k.room === 'kitchen' ? 1 : 0.2
        if (w > 0) opts.push([id, w])
      }
      let r = Math.random() * opts.reduce((a, o) => a + o[1], 0)
      for (const [id, w] of opts) if ((r -= w) <= 0) return id
      return opts.length ? opts[opts.length - 1][0] : null
    }
    function catGo(k, id, then) {
      if (k.spot && catTaken[k.spot] === k) delete catTaken[k.spot]
      catTaken[id] = k
      k.spot = id
      k.goTo(CATCFG.spots[id].node, () => {
        catSettle(k)
        if (then) then()
      })
    }
    function catSettle(k, act) {
      const sp = CATCFG.spots[k.spot]
      k.room = sp.room
      k.dir = sp.dir
      k.spotZ = typeof sp.z === 'number' ? sp.z : null
      k.act = act || pick(sp.acts)
      const len = { curl: [50, 110], front: [15, 30], loaf: [20, 45], sit: [15, 30], groom: [7, 12], stretch: [2.6, 2.6],
        eat: [8, 14], rub: [4, 4] }[k.act] || [15, 30]
      k.until = NOW + rnd(len[0], len[1])
      if (k.act === 'rub') {
        pending.push({ at: NOW + 2.2, fn: () => {
          if (k.act === 'rub' && !k.path.length) {
            float('heart', Math.round(k.x) - 2, Math.round(k.y) - 12, { dur: 2, rise: 9 })
          }
        } })
      }
    }
    function catTick(k) {
      if (k.trick || k.path.length || NOW < k.until) return
      if (k.act === 'stretch' || k.act === 'rub') {
        k.act = 'sit'
        k.until = NOW + rnd(5, 10)
        return
      }
      const id = catChoose(k)
      if (id) catGo(k, id)
      else k.until = NOW + 10
    }
    for (const c of CATCFG.list) {
      const k = new Kitty(c)
      const st = CATCFG.start[c.i]
      const sp = st && CATCFG.spots[st.spot]
      if (!sp) continue
      k.place(sp.node)
      k.spot = st.spot
      catTaken[st.spot] = k
      catSettle(k, st.act)
      k.until = NOW + rnd(20, 40)
      cats.push(k)
    }
    cats.tick = () => { for (const k of cats) catTick(k) }
    cats.step = dt => { for (const k of cats) k.step(dt) }
    cats.go = (name, spot) => {
      const k = cats.find(x => x.name === name)
      if (k && CATCFG.spots[spot]) catGo(k, spot)
    }

    // -- their own antics, now and then, on a timer of their own (never on anything that happens in the office, a
    // test run included): a mug knocked off your desk, a nap on your keyboard, a laser dot chased round the room, a
    // sudden perk-up and a trot to another room. You say something when it is your desk.
    const at = (dt, fn) => pending.push({ at: NOW + dt, fn })
    const ownerSays = text => { if (!ownerAway && !shut) owner.say(text, 0, 2.6) }
    function prop(draw, z) {                           // a thing drawn at its own depth among the furniture
      const el = mk('g', {})
      draw(el)
      const p = { el, z }
      actors.add(p)
      return { remove() { actors.delete(p); el.remove() } }
    }
    function finish(k, act, secs) {
      k.trick = null
      k.act = act || 'sit'
      k.until = NOW + (secs || rnd(6, 12))
    }
    const DESK = 'denDesk'
    const deskFree = k => CATCFG.spots[DESK] && (!catTaken[DESK] || catTaken[DESK] === k)
    const TRICKS = {
      mug(k) {                                         // up on the desk, a mug beside it, a swipe, and down it goes
        if (!deskFree(k)) return false
        k.trick = 'mug'
        catGo(k, DESK, () => {
          k.act = 'sit'
          const side = CATCFG.spots[DESK].dir === 'right' ? 1 : -1
          const mx = Math.round(k.x + side * 6 - 1)
          const my = Math.round(k.y - 3)
          const mug = float('mug', mx, my, { stay: true })
          at(1.6, () => { k.act = 'groom' })            // the paw
          at(2.2, () => {
            mug.el.remove()
            floats.splice(floats.indexOf(mug), 1)
            const f = float('mug', mx, my, { to: [mx + side * 5, my + 16], dur: 0.55, arc: 4 })
            f.done = () => {
              float('spark', mx + side * 6, my + 17, { dur: 0.6, rise: 0 })
              const shards = mk('g', {}, over)
              for (const [dx, dy] of [[0, 0], [3, 1], [-2, 1], [1, 2]]) {
                mk('rect', { x: mx + side * 5 + dx, y: my + 18 + dy, width: 1, height: 1, fill: '#fffdf6' }, shards)
              }
              at(9, () => shards.remove())
            }
          })
          at(2.6, () => { k.act = 'front'; ownerSays(`${k.label}!`) })
          at(3.2, () => finish(k, 'front', rnd(5, 9)))
        })
        return true
      },
      nap(k) {                                         // curled up on the keyboard, z's rising
        if (!deskFree(k)) return false
        k.trick = 'nap'
        catGo(k, DESK, () => {
          const kx = Math.round(k.x) - 6
          const ky = Math.round(k.y) - 2
          const kb = prop(el => {
            mk('rect', { x: kx - 1, y: ky - 1, width: 13, height: 5, fill: OUT }, el)
            mk('rect', { x: kx, y: ky, width: 11, height: 3, fill: '#2a2638' }, el)
            ;['#ff5f6d', '#fff275', '#5fd3ff', '#a78bfa', '#7cf29c'].forEach((c, i) => mk('rect', { x: kx + 1 + i * 2, y: ky + 1, width: 1, height: 1, fill: c }, el))
          }, (k.spotZ !== null ? k.spotZ : Math.round(k.y)) - 0.5)
          k.act = 'curl'
          const len = rnd(25, 45)
          const zs = () => { if (k.trick === 'nap') { float('z', Math.round(k.x) + 2, Math.round(k.y) - 7, { dur: 2.2, rise: 9 }); at(1.6, zs) } }
          at(0.8, zs)
          at(2.5, () => ownerSays('That was my keyboard.'))
          at(len, () => { kb.remove(); finish(k, 'stretch', 2.6) })
        })
        return true
      },
      chase(k) {                                       // a red dot darts about the room; the pet goes after it, fast
        const ids = Object.keys(CATCFG.spots).filter(id => CATCFG.spots[id].room === k.room && typeof CATCFG.spots[id].z !== 'number' &&
          typeof CATCFG.spots[id].who !== 'number' && !CATCFG.spots[id].person && (!catTaken[id] || catTaken[id] === k))
        if (ids.length < 2) return false
        k.trick = 'chase'
        const dot = mk('g', {}, over)
        mk('rect', { x: -1, y: -1, width: 3, height: 3, fill: '#ff4d4d', opacity: '.35' }, dot)
        mk('rect', { x: 0, y: 0, width: 1, height: 1, fill: '#ff2020' }, dot)
        let n = 0
        const speed = k.speed
        k.speed = speed * 2.4
        const hop = () => {
          if (n++ >= 4) {
            dot.remove()
            k.speed = speed
            return finish(k, 'front', rnd(6, 10))
          }
          const id = pick(ids.filter(x => x !== k.spot)) || ids[0]
          const [tx, ty] = CATCFG.nodes[CATCFG.spots[id].node]
          dot.setAttribute('transform', `translate(${tx} ${ty - 1})`)
          at(0.25, () => catGo(k, id, () => { k.act = 'sit'; k.until = NOW + 99; at(0.4, hop) }))
        }
        hop()
        return true
      },
      perk(k) {                                        // ears up, a look, and off to another room
        const ids = Object.keys(CATCFG.spots).filter(id => CATCFG.spots[id].room !== k.room && CATCFG.spots[id].room !== 'kitchen' &&
          !CATCFG.spots[id].person && typeof CATCFG.spots[id].who !== 'number' && !catTaken[id])
        if (!ids.length) return false
        k.trick = 'perk'
        k.act = 'front'
        float('bang', Math.round(k.x) - 1, Math.round(k.y) - 14, { dur: 1.4, rise: 3 })
        at(1.5, () => catGo(k, pick(ids), () => finish(k, 'loaf', rnd(20, 40))))
        return true
      },
    }
    // the dance (a long press on a pet): every pet, wherever it is, bobs through its poses with notes rising
    cats.dance = () => {
      if (napping) return false
      for (const k of cats) {
        if (k.trick === 'nap' || k.trick === 'dance') continue
        if (k.path.length) {
          k.path = []
          k.seg = null
          k.then = null
        }
        k.trick = 'dance'
        k.spotZ = null
        const moves = ['sit', 'stretch', 'front', 'groom', 'front', 'sit', 'stretch', 'front']
        const len = 6.5
        for (let i = 0; i * 0.32 < len; i++) {
          at(i * 0.32, () => {
            k.act = moves[i % moves.length]
            k.hop = i % 2 ? 3 : 0
            if (i % 4 === 0) float('note', Math.round(k.x) + (i % 8 ? 3 : -5), Math.round(k.y) - 14, { dur: 1.4, rise: 9, color: i % 8 ? '#fde047' : '#f472b6' })
          })
        }
        at(len, () => { k.hop = 0; finish(k, 'front', rnd(6, 10)) })
      }
      ownerSays('Dance party.')
      return true
    }
    let nextTrick = rnd(35, 70)
    cats.trick = (name, kind) => {
      const k = cats.find(x => x.name === name) || pick(cats)
      if (!k || k.trick || k.path.length) return false
      const kinds = kind && TRICKS[kind] ? [kind] : Object.keys(TRICKS).sort(() => Math.random() - 0.5)
      return kinds.some(t => TRICKS[t](k))
    }
    // the office closed: each pet, once done with what it was doing, curls up where it is and sleeps
    let napping = false
    function napNow(k) {
      k.trick = 'closed'
      k.hop = 0
      k.act = 'curl'
      k.until = NOW + 1e9
      const zs = () => {
        if (k.trick !== 'closed') return
        float('z', Math.round(k.x) + 2, Math.round(k.y) - 7, { dur: 2.4, rise: 9 })
        at(rnd(2.6, 3.6), zs)
      }
      at(rnd(0.6, 2.4), zs)
    }
    cats.nap = on => {
      napping = !!on
      if (!napping) for (const k of cats) if (k.trick === 'closed') finish(k, 'stretch', 2.6)
    }
    const plainTick = cats.tick
    cats.tick = () => {
      if (napping) {
        for (const k of cats) if (!k.trick && !k.path.length) napNow(k)
        return
      }
      plainTick()
      if (NOW < nextTrick) return
      nextTrick = NOW + rnd(70, 170)
      const free = cats.filter(k => !k.trick && !k.path.length && k.room !== 'kitchen')
      if (free.length) cats.trick(pick(free).name)
    }
  }

  // -- the agents: in from the entrance to a free workstation (or standing by, each on a spot of their own, when
  // they're all taken); at work with their bubble, the room's agents taking turns; done, their report to Claude at
  // the front desk, and out
  const agents = new Map()
  const gone = new Set()
  const seatOf = {}
  const standing = {}            // overflow node -> agent
  const papers = []
  let shownInbox = 0
  let dataInbox = 0
  function seatEl(id) { return svg.querySelectorAll(`[data-seat="${id}"]`) }
  function seatOn(seat, w) {
    seatEl(seat.id).forEach(g => g.classList.toggle('on', !!w))
    tag(seat, w ? w.data.tool : '')
  }
  function tag(seat, tool) {
    seatEl(seat.id).forEach(g => {
      const t = g.querySelector('.nr-tag')
      if (!t) return
      const tx = t.querySelector('.nr-tag-t')
      const b = t.querySelector('.nr-tag-b')
      const o = t.querySelector('.nr-tag-o')
      const cx = +t.getAttribute('data-cx')
      const fs = tool.length > 8 ? 3.1 : 3.5
      const w = Math.ceil(tool.length * fs * 0.55) + 3
      t.setAttribute('display', tool ? 'inline' : 'none')
      tx.textContent = tool
      tx.setAttribute('font-size', fs)
      b.setAttribute('x', cx - Math.ceil(w / 2))
      b.setAttribute('width', w)
      o.setAttribute('x', cx - Math.ceil(w / 2) - 1)
      o.setAttribute('width', w + 2)
    })
  }
  function addAgent(d, instant) {
    const w = new Who('agent', d.id, d.look, CFG.lobby.out)
    w.desk = d.desk
    w.data = d
    w.speech = function () {
      if (this.state !== 'seated' || !this.turn) return null
      return this.data.say ? { kind: 'agent', text: this.data.say } : { kind: 'think', text: '' }
    }
    agents.set(d.id, w)
    seat(w, instant)
  }
  function freeStand(desk) {
    const list = CFG.overflow[desk] || []
    return list.find(n => !standing[n]) || list[list.length - 1]
  }
  function seat(w, instant) {
    const s = CFG.seats[w.desk].find(x => !seatOf[x.id])
    if (s) seatOf[s.id] = w
    w.seat = s || null
    const target = s ? s.node : freeStand(w.desk)
    if (!s) {
      standing[target] = w
      w.stand = target
    }
    w.state = 'arriving'
    if (instant) {
      w.node = target
      w.x = N[target][0]
      w.y = N[target][1]
      sit(w)
    } else w.goTo(target, () => sit(w))
  }
  function sit(w) {
    w.state = 'seated'
    w.dir = 'down'
    w.pose = w.seat ? 'type' : 'stand'
    if (w.seat) {
      seatOn(w.seat, w)
      w.setProp('seat', w.seat.hz, skins[w.sprite] || '#f7d7bd')
    }
    if (w.data.done) leave(w)
  }
  function unstand(w) {
    if (w.stand && standing[w.stand] === w) delete standing[w.stand]
    w.stand = null
  }
  function leave(w) {
    if (w.state === 'leaving' || w.state === 'handoff' || w.state === 'out') return
    w.state = 'leaving'
    w.dropProp()
    unstand(w)
    if (w.seat) {
      seatOn(w.seat, null)
      delete seatOf[w.seat.id]
      const freed = w.seat
      w.seat = null
      const waiting = [...agents.values()].find(a => a.desk === w.desk && a.state === 'seated' && !a.seat)
      if (waiting) {                              // whoever was standing by takes the seat
        unstand(waiting)
        seatOf[freed.id] = waiting
        waiting.seat = freed
        waiting.state = 'arriving'
        waiting.goTo(freed.node, () => sit(waiting))
      }
    }
    w.state = 'leaving'
    const busyHands = new Set([...agents.values()].filter(a => a.state === 'handoff' || a.state === 'leaving').map(a => a.hand))
    w.hand = CFG.lobby.handoff.find(h => !busyHands.has(h)) || CFG.lobby.handoff[0]
    w.goTo(w.hand, () => handoff(w))
  }
  function handoff(w) {
    w.state = 'handoff'
    w.dir = 'up'
    w.pose = 'stand'
    w.timer = NOW + 2.6
    papers.push({ w, from: [w.x, w.y - 13], to: CFG.lobby.tray, t0: NOW, el: null, failed: w.data.failed })
    claudeSays(w.data.failed ? 'Noted. We will retry.' : pick(['Thanks!', 'Nice work.', 'Got it.', 'On the pile.']), 2.8)
  }
  function agentTick(w) {
    if (w.state === 'handoff' && NOW > w.timer) {
      w.state = 'out'
      w.goTo(CFG.lobby.out, () => {
        w.remove()
        agents.delete(w.id)
        gone.add(w.id)
      })
    }
  }
  function turns() {                              // in a room with several agents, their bubbles take turns
    const by = {}
    for (const w of agents.values()) if (w.state === 'seated') (by[w.desk] = by[w.desk] || []).push(w)
    for (const w of agents.values()) w.turn = false
    for (const list of Object.values(by)) {
      list.sort((a, b) => (a.seat ? a.seat.id : 'z').localeCompare(b.seat ? b.seat.id : 'z'))
      list[Math.floor(NOW / 4) % list.length].turn = true
    }
  }
  function paperTick() {
    for (let i = papers.length - 1; i >= 0; i--) {
      const p = papers[i]
      const k = Math.min(1, (NOW - p.t0) / 0.9)
      const x = p.from[0] + (p.to[0] - p.from[0]) * k
      const y = p.from[1] + (p.to[1] - p.from[1]) * k - Math.sin(Math.PI * k) * 14
      if (!p.el) {
        p.el = mk('g', {}, over)
        mk('rect', { x: -1, y: -1, width: 8, height: 6, fill: OUT }, p.el)
        mk('rect', { x: 0, y: 0, width: 6, height: 4, fill: '#fffdf6' }, p.el)
        mk('rect', { x: 1, y: 1, width: 4, height: 1, fill: p.failed ? '#ef4444' : '#c9c2d6' }, p.el)
      }
      p.el.setAttribute('transform', `translate(${Math.round(x)} ${Math.round(y)})`)
      if (k >= 1) {
        p.el.remove()
        papers.splice(i, 1)
        p.w.landed = true
        inbox()
      }
    }
  }
  function inbox() {
    const waiting = [...agents.values()].filter(a => a.data.done && !a.landed).length
    shownInbox = Math.max(0, dataInbox - waiting)
    const t = document.getElementById('nr-inbox')
    if (t) t.textContent = `INBOX ${shownInbox}`
    svg.querySelectorAll('.nr-pile').forEach((r, i) => r.setAttribute('display', i < shownInbox ? 'inline' : 'none'))
  }

  // -- Claude at the front desk: thinking while the main session works, its reply's first line for a while after,
  // a word for each agent that hands in a report
  const claudeState = { busy: false, brief: '', briefUntil: 0, word: '', wordUntil: 0, shown: null }
  function claudeSays(words, secs) {
    claudeState.word = words
    claudeState.wordUntil = NOW + secs
  }
  function claudeTick() {
    const c = claudeState
    let want = null
    if (claudeAway || shut) want = null                    // not at the desk: in a meeting, or the office is closed
    else if (NOW < c.wordUntil) want = { kind: 'agent', text: c.word }
    else if (NOW < c.briefUntil && c.brief) want = { kind: 'agent', text: c.brief }
    else if (c.busy) want = { kind: 'think', text: '' }
    const key = want ? `${want.kind}|${want.text}` : ''
    if (key === (c.shown ? c.shown.key : '')) return
    if (c.shown) c.shown.el.remove()
    c.shown = want ? { key, el: over.appendChild(bubble(want.kind, want.text, CFG.lobby.claude[0], CFG.lobby.claude[1])) } : null
  }

  // -- picking an agent out: an arrow over its head and a ring at its feet, bouncing for a few seconds
  let marker = null
  function highlight(id) {
    const w = agents.get(id)
    if (marker) marker.el.remove()
    marker = null
    if (!w) return false
    const color = (CFG.desks[w.desk] || {}).color || '#ffffff'
    const el = mk('g', { class: 'nr-mark' }, over)
    if (!w.seat) mk('ellipse', { cx: 0, cy: 0, rx: 8, ry: 3, fill: 'none', stroke: color, 'stroke-width': 1 }, el)
    const arrow = mk('g', {}, el)
    mk('path', { d: 'M-3 -32h7v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z', fill: OUT, transform: 'translate(-.5 -.5) scale(1.12)' }, arrow)
    mk('path', { d: 'M-3 -32h7v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z', fill: color }, arrow)
    mk('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0;0 -2;0 0', dur: '.6s', repeatCount: 'indefinite' }, arrow)
    marker = { el, w, until: NOW + 6 }
    return true
  }
  function markerTick() {
    if (!marker) return
    if (NOW > marker.until || !agents.has(marker.w.id)) {
      marker.el.remove()
      marker = null
      return
    }
    marker.el.setAttribute('transform', `translate(${Math.round(marker.w.x)} ${Math.round(marker.w.y)})`)
  }

  // -- the clock in the kitchen, and the sky in the windows: the browser's own time
  let minute = -1
  function hands(h, m) {
    const g = document.getElementById('nr-hands')
    if (!g || !CFG.clock || m === minute) return
    minute = m
    while (g.firstChild) g.firstChild.remove()
    const [cx, cy] = CFG.clock
    const hand = (a, len, c) => {
      for (let k = 1; k <= len; k++) {
        mk('rect', { x: cx + Math.round(Math.sin(a) * k), y: cy - Math.round(Math.cos(a) * k), width: 1, height: 1, fill: c }, g)
      }
    }
    hand(m / 60 * 2 * Math.PI, 5, '#6b6385')
    hand(((h % 12) + m / 60) / 12 * 2 * Math.PI, 3, '#2b2342')
    mk('rect', { x: cx, y: cy, width: 1, height: 1, fill: '#ef4444' }, g)
  }

  // -- the lists under the drawing: who is on the floor (a row each; pick one to find it in the office) and what
  // was handed back lately
  function lists(d) {
    const working = d.staff.filter(s => !s.done)
    const row = (s, done) => {
      const li = document.createElement('li')
      const desk = CFG.desks[s.desk] || {}
      const el = document.createElement(done ? 'div' : 'button')
      el.className = 'row' + (done ? ' done' : '') + (done && s.failed ? ' failed' : '')
      if (!done) {
        el.type = 'button'
        el.dataset.id = s.id
        el.title = 'Find in the office'
      }
      const dot = document.createElement('i')
      dot.className = 'dot'
      dot.style.background = desk.color || '#ffffff'
      const dept = document.createElement('b')
      dept.textContent = desk.label || ''
      const task = document.createElement('span')
      task.className = 'task'
      task.textContent = (done && s.failed ? 'Failed: ' : '') + s.task
      const tool = document.createElement('em')
      tool.textContent = done ? '' : s.tool
      const m = document.createElement('small')
      m.textContent = `${s.mins}m`
      el.append(dot, dept, task, tool, m)
      li.append(el)
      return li
    }
    const w = document.getElementById('nr-work')
    const r = document.getElementById('nr-done')
    if (w) w.replaceChildren(...(working.length ? working.map(s => row(s, false)) : [empty('Nobody at a desk right now.')]))
    if (r) r.replaceChildren(...((d.recent || []).length ? d.recent.map(s => row(s, true)) : [empty('Nothing handed back yet.')]))
    const n = document.getElementById('nr-n-work')
    if (n) n.textContent = working.length ? String(working.length) : ''
    const nd = document.getElementById('nr-n-done')
    if (nd) nd.textContent = d.inbox ? String(d.inbox) : ''
    document.dispatchEvent(new CustomEvent('nr:staff', { detail: { working: working.length } }))
  }
  function empty(text) {
    const li = document.createElement('li')
    li.className = 'empty'
    li.textContent = text
    return li
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button.row[data-id]')
    if (!b) return
    document.querySelectorAll('button.row.picked').forEach(x => x.classList.remove('picked'))
    if (highlight(b.dataset.id)) b.classList.add('picked')
  })

  function sky() {
    const h = new Date().getHours()
    svg.setAttribute('data-sky', h < 6 || h >= 19 ? 'night' : h >= 17 ? 'dusk' : 'day')
    hands(h, new Date().getMinutes())
  }

  // -- the live list
  const DESKS = Object.keys(CFG.seats)
  let first = true
  let staffBusy = false
  function apply(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.staff)) return
    if (CFG.key && d.key && d.key !== CFG.key) {    // the page was rebuilt: load it, once (the chat keeps a draft)
      let tried = ''
      try { tried = sessionStorage.getItem('ao-reload') || '' } catch (e) { /* private window */ }
      if (tried !== d.key) {
        const go = () => {
          try { sessionStorage.setItem('ao-reload', d.key) } catch (e) { /* private window */ }
          location.reload()
        }
        if (window.__aoReload ? window.__aoReload(go) : (go(), true)) return
      }
    }
    staffBusy = !!d.busy
    svg.setAttribute('data-busy', staffBusy || claudeState.busy ? '1' : '0')
    sky()
    if (typeof d.sprites === 'string' && d.sprites !== spritesVer) loadSprites(d.sprites)
    const seen = new Set()
    for (const s0 of d.staff) {
      if (!s0 || !/^a[0-9a-z]+$/.test(s0.id) || !/^a[0-9a-z]+$/.test(s0.look) || !DESKS.includes(s0.desk)) continue
      const s = { id: s0.id, look: s0.look, desk: s0.desk, task: String(s0.task || ''), tool: String(s0.tool || ''),
        say: String(s0.say || ''), done: !!s0.done, failed: !!s0.failed, mins: +s0.mins || 0 }
      seen.add(s.id)
      const w = agents.get(s.id)
      if (!w) {
        if (s.done || gone.has(s.id)) {
          gone.add(s.id)
          continue
        }
        addAgent(s, first)
        continue
      }
      const was = w.data
      w.data = s
      if (w.seat && was.tool !== s.tool) tag(w.seat, s.tool)
      if (s.done && !was.done && (w.state === 'seated' || w.state === 'arriving')) leave(w)
    }
    for (const w of agents.values()) {               // dropped from the list without finishing: off they go
      if (!seen.has(w.id) && (w.state === 'seated' || w.state === 'arriving')) {
        w.data = Object.assign({}, w.data, { done: true })
        leave(w)
      }
    }
    dataInbox = +d.inbox || 0
    inbox()
    lists(d)
    first = false
  }
  // the list: one read at a time; through the bridge by fetch on a fixed address (the browser revalidates it, and the
  // bridge answers a bodiless 304 while it is unchanged), parsed as JSON, never run; from a file by a script tag
  const LIVE = /^https?:$/.test(location.protocol)
  let polling = false
  function got(d, ok) {
    if (ok) {
      try { apply(d) } catch (e) { console.error(e) }
    }
    document.dispatchEvent(new CustomEvent('nr:data', { detail: { ok, data: ok ? d : null } }))
  }
  function poll() {
    if (document.hidden || polling) return
    polling = true
    if (LIVE) {
      fetch(`staff.js?${q.replace(/&$/, '')}`, { cache: 'no-cache', credentials: 'omit' })
        .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(t => {
          const m = /^window\.__aoStaff = ([\s\S]*);\s*$/.exec(t)
          got(m ? JSON.parse(m[1]) : null, !!m)
        })
        .catch(() => got(null, false))
        .finally(() => { polling = false })
      return
    }
    window.__aoStaff = undefined
    const s = document.createElement('script')
    s.src = `staff.js?${q}t=${Date.now()}`
    s.onload = () => {
      s.remove()
      polling = false
      got(window.__aoStaff, !!window.__aoStaff)
    }
    s.onerror = () => {
      s.remove()
      polling = false
      got(null, false)
    }
    document.head.appendChild(s)
  }

  // -- what the chat tells the office
  const showEl = (id, on) => { const el = document.getElementById(id); if (el) el.setAttribute('display', on ? 'inline' : 'none') }
  const hide = (w, on) => {
    w.hidden = on
    w.el.setAttribute('display', on ? 'none' : 'inline')
  }
  const rooms = CFG.rooms || []
  const span = () => ({ x0: Math.min(...rooms.map(r => r.x)), x1: Math.max(...rooms.map(r => r.x + r.w)), y1: Math.max(...rooms.map(r => r.y + r.h)) })
  const roomAtW = w => { const r = roomAt(w.x, w.y); return r ? r.id : '' }
  function lineFrom(list, text, secs) {
    const w = pick(list)
    if (!w) return
    w.lines = (w.lines || []).filter(l => l.to > NOW)
    w.lines.push({ text, from: NOW + 0.4, to: NOW + 0.4 + secs })
  }
  const CONFETTI = ['#f4c542', '#ec4899', '#a78bfa', '#14b8a6', '#ef4444', '#60a5fa', '#22c55e', '#fff2c4']
  function confetti(n) {
    const { x0, x1 } = span()
    for (let i = 0; i < n; i++) {
      pending.push({ at: NOW + Math.random() * 1.6, fn: () => {
        const x = rnd(x0, x1)
        const y = rnd(-12, 4)
        float('confetti', x, y, { to: [x + rnd(-16, 16), y + rnd(170, 215)], dur: rnd(2.8, 4.4), arc: rnd(-8, 8), color: pick(CONFETTI) })
      } })
    }
  }

  // -- the office closed (the usage guard, from the live list): the lights go down, a CLOSED sign stands at the
  // lobby's entrance with the time it opens, the staff head out by the entrance, you and Claude leave your desks, and
  // the pets curl up and sleep. Agents still at work stay. When it opens the staff come back in, one by one. A page
  // that loads while it is closed shows it closed at once. The time is set as text.
  let shutFirst = true
  let shutUntil = null
  let shutG = null
  function shutSign(until) {
    if (shutG) shutG.remove()
    shutG = null
    if (!shut || !rooms.length) return
    const { x0, x1, y1 } = span()
    shutG = mk('g', { id: 'nr-shut', 'pointer-events': 'none' }, over.parentNode)
    const dim = mk('rect', { x: x0, y: 0, width: x1 - x0, height: y1 + 4, fill: '#05020d', opacity: shutFirst ? '.5' : '0' }, shutG)
    if (!shutFirst) {
      dim.style.transition = 'opacity 2.4s ease'
      requestAnimationFrame(() => requestAnimationFrame(() => { dim.style.opacity = '.5' }))
    }
    const back = until ? `BACK ${until.toUpperCase()}` : 'BACK SOON'
    const [ex, ey] = Array.isArray(CFG.door) ? CFG.door : [207, 158]
    const w = Math.max(50, Math.ceil(back.length * 5.6 * 0.6) + 10)
    const bx = Math.round(ex - w / 2)
    const sign = mk('g', {}, shutG)
    mk('rect', { x: bx + 3, y: ey + 29, width: w - 6, height: 2, fill: '#05020d', opacity: '.35' }, sign)
    mk('rect', { x: bx + 6, y: ey + 22, width: 2, height: 7, fill: OUT }, sign)
    mk('rect', { x: bx + w - 8, y: ey + 22, width: 2, height: 7, fill: OUT }, sign)
    mk('rect', { x: bx - 1, y: ey - 1, width: w + 2, height: 25, fill: OUT }, sign)
    mk('rect', { x: bx, y: ey, width: w, height: 23, fill: '#fff6dc' }, sign)
    mk('rect', { x: bx, y: ey, width: w, height: 13, fill: '#e0323c' }, sign)
    mk('rect', { x: bx, y: ey + 13, width: w, height: 1, fill: '#9c1520' }, sign)
    const t1 = mk('text', { x: ex, y: ey + 10, 'font-size': 10, 'font-weight': 'bold', 'text-anchor': 'middle', fill: '#ffffff',
      'font-family': "Consolas, 'Courier New', monospace", 'letter-spacing': '.6' }, sign)
    t1.textContent = 'CLOSED'
    const t2 = mk('text', { x: ex, y: ey + 20.6, 'font-size': 5.6, 'font-weight': 'bold', 'text-anchor': 'middle', fill: '#2e1065',
      'font-family': "Consolas, 'Courier New', monospace" }, sign)
    t2.textContent = back
  }
  function setShut(on, until) {
    const first = shutFirst
    const u = typeof until === 'string' && /^\d{1,2}:\d{2} [AP]M$/.test(until) ? until : ''
    if (on === shut) {
      shutFirst = false
      if (on && u !== shutUntil) {
        shutUntil = u
        shutSign(u)
      }
      return
    }
    shut = on
    shutUntil = u
    svg.setAttribute('data-closed', on ? '1' : '0')
    for (const id of ['nr-owner-back', 'nr-owner-turn', 'nr-claude']) showEl(id, !on && !(id === 'nr-claude' ? claudeAway : ownerAway))
    if (on) {
      mtgClear()                                    // a meeting on: its people go home with everyone else
      owner.turn(false)
      owner.lines = []
      if (cats.nap) cats.nap(true)
      crew.forEach((w, i) => {
        if (w.spot) {
          delete taken[w.spot]
          w.spot = null
        }
        w.chatting = false
        w.paused = false
        w.lines = []
        w.react = null
        w.dropProp()
        w.state = 'leaving'
        const away = () => {
          w.state = 'away'
          w.pose = 'stand'
          hide(w, true)
        }
        if (first) {                               // loaded closed: already gone
          w.path = []
          w.node = CFG.lobby.out
          w.x = N[w.node][0]
          w.y = N[w.node][1]
          away()
          return
        }
        pending.push({ at: NOW + i * 0.7, fn: () => { if (shut) w.goTo(CFG.lobby.out, away) } })
      })
    } else {
      if (cats.nap) cats.nap(false)
      crew.forEach((w, i) => pending.push({ at: NOW + 0.8 + i * 1.3, fn: () => {
        if (shut) return
        hide(w, false)
        if (w.state === 'away' || w.state === 'leaving') {
          w.state = 'going'
          w.goTo(w.cfg.home, () => startWork(w))
        }
      } }))
      if (mtgWant) pending.push({ at: NOW + 2, fn: () => { if (!shut) meetApply(mtgWant, false) } })   // back to the meeting
    }
    shutFirst = false
    shutSign(u)
  }

  // -- the easter eggs (README's "Spoilers"). extras.js decides when (a long press, a code typed at the front desk,
  // the clock, a rare page load) and calls egg(name); this draws them. Nothing here makes a sound, waits on the chat or
  // touches what a click does. Every word is ours.
  const EGG = CFG.eggs || {}
  const tweens = []                                  // a thing moved every step for a while: k runs 0 to 1
  function tween(dur, fn, done) { tweens.push({ t0: NOW, dur, fn, done }) }
  function tweenTick() {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const t = tweens[i]
      const k = Math.min(1, (NOW - t.t0) / t.dur)
      try { t.fn(k) } catch (e) { console.error(e) }
      if (k >= 1) {
        tweens.splice(i, 1)
        if (t.done) t.done()
      }
    }
  }
  const later = (dt, fn) => pending.push({ at: NOW + dt, fn })
  const idleCrew = () => crew.filter(w => !w.hidden && w.pose !== 'walk' && w.state !== 'moment' && w.state !== 'meeting')
  const eggUntil = {}                                // one of each at a time
  function once(name, secs) {
    if (eggUntil[name] > NOW) return false
    eggUntil[name] = NOW + secs
    return true
  }
  const isBox = (a, n) => Array.isArray(a) && a.length === n && a.every(v => typeof v === 'number' && Number.isFinite(v))
  const EGGS = {
    // the lobby's trophy turns on its plinth, catching the light
    trophy() {
      const t = document.getElementById('nr-trophy')
      if (!t || !once('trophy', 2.6)) return false
      const cx = typeof EGG.trophyX === 'number' ? EGG.trophyX : 221
      tween(2.2, k => {
        const sx = Math.cos(k * Math.PI * 6)
        t.setAttribute('transform', `translate(${cx} 0) scale(${sx.toFixed(3)} 1) translate(${-cx} 0)`)
      }, () => t.removeAttribute('transform'))
      const z = EGG.press && isBox(EGG.press.trophy, 4) ? EGG.press.trophy : null
      if (z) for (let i = 0; i < 5; i++) later(0.3 + i * 0.4, () => float('spark', Math.round(rnd(z[0] + 2, z[2] - 2)), Math.round(rnd(z[1] + 1, z[1] + 12)), { dur: 0.8, rise: 2 }))
      if (!shut) later(1.2, () => claudeSays('Champions!', 2.4))
      return true
    },
    // the arcade cabinet's attract mode: five seconds of a chase across its screen, a flash, the marquee blinking
    arcade() {
      const A = EGG.arcade
      if (!A || !isBox(A.screen, 4) || !isBox(A.marquee, 4) || !once('arcade', 5.4)) return false
      const [sx, sy, sw, sh] = A.screen
      const [mx, my, mw, mh] = A.marquee
      const g = mk('g', { 'pointer-events': 'none' }, over)
      const scr = mk('rect', { x: sx, y: sy, width: sw, height: sh, fill: '#05040c' }, g)
      const mq = mk('rect', { x: mx, y: my, width: mw, height: mh, fill: '#fde047', opacity: '0' }, g)
      const dots = []
      for (let i = 0; i < 3; i++) dots.push(mk('rect', { x: sx + 2 + i * 2, y: sy + 2, width: 1, height: 1, fill: '#fff2c4' }, g))
      const pac = mk('rect', { x: sx, y: sy + 2, width: 2, height: 1, fill: '#fde047' }, g)
      const ghost = mk('rect', { x: sx - 3, y: sy + 2, width: 1, height: 1, fill: '#ff5c9a' }, g)
      const COLS = ['#ec4899', '#60a5fa', '#5ef08a', '#fde047', '#a78bfa']
      let hi = false
      tween(5, k => {
        mq.setAttribute('opacity', Math.floor(k * 20) % 2 ? '.85' : '0')
        if (k < 0.55) {
          const px = sx + Math.floor((k / 0.55) * (sw + 2))
          pac.setAttribute('x', String(Math.min(px, sx + sw - 2)))
          pac.setAttribute('height', Math.floor(k * 30) % 2 ? '1' : '2')
          ghost.setAttribute('x', String(px - 3))
          ghost.setAttribute('display', px - 3 >= sx ? 'inline' : 'none')
          dots.forEach(d => d.setAttribute('display', +d.getAttribute('x') <= px ? 'none' : 'inline'))
        } else if (k < 0.85) {
          pac.setAttribute('display', 'none')
          ghost.setAttribute('display', 'none')
          scr.setAttribute('fill', COLS[Math.floor(k * 40) % COLS.length])
        } else if (!hi) {
          hi = true
          scr.setAttribute('fill', '#05040c')
          for (let i = 0; i < 3; i++) mk('rect', { x: sx + 1 + i * 2, y: sy + 2, width: 1, height: 1, fill: COLS[i] }, g)
        }
      }, () => g.remove())
      for (let i = 0; i < 3; i++) later(0.5 + i * 1.4, () => float('spark', mx + Math.round(rnd(0, mw)), my - 2, { dur: 0.8, rise: 4 }))
      return true
    },
    // the coffee machine pressed once or twice: a puff of steam (a third time, it overflows)
    puff() {
      const C = EGG.coffee
      if (!C || !isBox(C.spout, 2)) return false
      for (let i = 0; i < 2; i++) later(i * 0.25, () => float('spark', C.spout[0] + Math.round(rnd(-2, 2)), C.spout[1] - 4, { dur: 0.6, rise: 4 }))
      return true
    },
    // the coffee machine, pressed three times: it overflows, down the counter and onto the floor
    coffee() {
      const C = EGG.coffee
      if (!C || !isBox(C.spout, 2) || typeof C.counter !== 'number' || !once('coffee', 16)) return false
      const [cx, cy] = C.spout
      const g = mk('g', { 'pointer-events': 'none' }, over)
      const BREW = '#5a3218'
      const potFull = mk('rect', { x: cx - 2, y: cy + 1, width: 4, height: 0, fill: BREW }, g)
      const spill = mk('rect', { x: cx - 3, y: cy + 5, width: 0, height: 1, fill: BREW }, g)
      const drip = mk('rect', { x: cx + 3, y: cy + 6, width: 1, height: 0, fill: BREW }, g)
      const pool = mk('ellipse', { cx: cx + 3, cy: C.counter + 2, rx: 0, ry: 0, fill: BREW, opacity: '.92' }, g)
      tween(4.5, k => {
        potFull.setAttribute('height', String(Math.min(3, Math.floor(k * 12))))
        spill.setAttribute('width', String(Math.max(0, Math.min(7, Math.floor((k - 0.2) * 20)))))
        drip.setAttribute('height', String(Math.max(0, Math.min(C.counter - cy - 6, Math.floor((k - 0.35) * 30)))))
        const p = Math.max(0, (k - 0.55) / 0.45)
        pool.setAttribute('rx', (p * 9).toFixed(1))
        pool.setAttribute('ry', (p * 2.4).toFixed(1))
      })
      for (let i = 0; i < 6; i++) later(i * 0.5, () => float('spark', cx + Math.round(rnd(-3, 3)), cy - 3, { dur: 0.7, rise: 5 }))
      const near = idleCrew().filter(w => roomAtW(w) === 'kitchen')
      later(2.4, () => lineFrom(near.length ? near : idleCrew(), pick(['Who broke the coffee machine?', 'Coffee everywhere!', 'Somebody get a mop.']), 3))
      later(14, () => tween(1.5, k => g.setAttribute('opacity', String(1 - k)), () => g.remove()))
      return true
    },
    // midnight on this machine's clock: the lights flicker, and the pets' eyes glow in the dark
    midnight() {
      if (!rooms.length || !once('midnight', 30)) return false
      const { x0, x1, y1 } = span()
      const dim = mk('rect', { x: x0, y: 0, width: x1 - x0, height: y1 + 4, fill: '#05020d', opacity: '0', 'pointer-events': 'none' }, over.parentNode)
      const STEPS = [[0, '.55'], [0.12, '.05'], [0.3, '.6'], [0.42, '.1'], [0.75, '.62'], [0.9, '.2'], [1.15, '.5']]
      for (const [t, o] of STEPS) later(t, () => dim.setAttribute('opacity', o))
      for (const k of cats) {
        k.glow = NOW + 11
        if (!k.trick && !k.path.length && k.act !== 'curl') {
          k.act = 'front'
          k.until = NOW + 11
        }
      }
      later(11, () => tween(1.6, k => dim.setAttribute('opacity', (0.5 * (1 - k)).toFixed(2)), () => dim.remove()))
      return true
    },
    // "/confetti" at the front desk
    confetti() {
      if (!once('confetti', 2)) return false
      confetti(90)
      return true
    },
    // a paper airplane drifts across the office (one page load in fifty)
    plane() {
      if (!rooms.length || !once('plane', 10)) return false
      const { x0, x1 } = span()
      const y = Math.round(rnd(40, 110))
      float('plane', x0 - 8, y, { to: [x1 + 8, y + Math.round(rnd(-20, 30))], dur: 9, arc: 26 })
      return true
    },
    // up, up, down, down, left, right, left, right, B, A: an extra life for everyone
    konami() {
      if (!once('konami', 4)) return false
      for (const w of idleCrew()) {
        w.react = { frame: 'fu', until: NOW + 2.6 }
        float('txt', Math.round(w.x), Math.round(w.y) - 22, { text: '1UP', size: 4, color: '#5ef08a', dur: 1.6, rise: 8 })
      }
      EGGS.arcade()
      return true
    },
  }

  // -- the meeting: conference.js says who attends, in which chair, and who has the floor; this walks them in and out.
  // The staff leave what they were doing and go themselves; you get up from your chair, Claude from the front desk; a
  // department comes as an agent from its room and goes back there after. Seated, each faces the table; the speaker
  // turns to the room with a glow at their feet. Nothing here is outside text.
  const MC = CFG.conf && Array.isArray(CFG.conf.seats) ? CFG.conf : null
  const mtg = new Map()                              // attendee id -> { id, kind, w, seat, own, from, color }
  let mtgWant = null
  let mtgSpeaker = null
  let halo = null
  function mtgSeated(m) {
    const w = m.w
    w.state = 'meeting'
    w.seated = true
    w.pose = 'stand'
    w.dir = m.seat.dir
  }
  function mtgGo(m, instant) {
    const w = m.w
    w.seated = false
    w.state = 'meeting'
    if (instant) {
      w.path = []
      w.node = m.seat.node
      w.x = N[m.seat.node][0]
      w.y = N[m.seat.node][1]
      mtgSeated(m)
    } else w.goTo(m.seat.node, () => mtgSeated(m))
  }
  function mtgJoin(a, instant) {
    const seat = MC.seats[a.seat]
    if (!seat || !N[seat.node]) return
    let w = null
    let own = false
    let from = null
    if (a.kind === 'crew') w = crew.find(c => c.id === a.crew) || null
    if (w) {
      if (w.spot) {
        delete taken[w.spot]
        w.spot = null
      }
      if (w === visitor && w.state === 'moment') owner.turn(false)
      w.chatting = false
      w.paused = false
      w.lines = []
      w.react = null
      w.dropProp()
    } else {
      own = true
      const fromMap = MC.from || {}
      from = a.kind === 'owner' ? fromMap.owner : a.kind === 'claude' ? fromMap.claude : fromMap[a.desk] || fromMap.claude
      if (!N[from]) return
      const sprite = a.kind === 'owner' ? 'owner' : a.kind === 'claude' ? 'claude' : `g-${a.desk}`
      w = new Who(a.kind === 'agent' ? 'agent' : 'crew', `mtg-${a.id}`, sprite, from)
      w.desk = a.desk
      w.lines = []
      extraFolk.add(w)
      if (a.kind === 'owner') {
        owner.turn(false)
        owner.lines = []
        ownerAway = true
        showEl('nr-owner-back', false)
      }
      if (a.kind === 'claude') {
        claudeAway = true
        showEl('nr-claude', false)
      }
    }
    const m = { id: a.id, kind: a.kind, w, seat, own, from, color: a.color }
    mtg.set(a.id, m)
    mtgGo(m, instant)
  }
  function mtgLeave(m) {
    const w = m.w
    mtg.delete(m.id)
    w.seated = false
    if (!m.own) {
      w.state = 'going'
      w.goTo(w.cfg.home, () => startWork(w))
      return
    }
    w.state = 'out'
    w.goTo(m.from, () => {
      extraFolk.delete(w)
      w.remove()
      if (m.kind === 'owner' && ![...mtg.values()].some(x => x.kind === 'owner')) {
        ownerAway = false
        if (!shut) showEl('nr-owner-back', true)
      }
      if (m.kind === 'claude' && ![...mtg.values()].some(x => x.kind === 'claude')) {
        claudeAway = false
        if (!shut) showEl('nr-claude', true)
      }
    })
  }
  // everyone out at once, no walking: the office closed
  function mtgClear() {
    mtgSpeaker = null
    meetTick()
    for (const m of mtg.values()) {
      if (m.own) {
        extraFolk.delete(m.w)
        m.w.remove()
      } else m.w.seated = false
    }
    mtg.clear()
    ownerAway = claudeAway = false
  }
  const KINDS = ['crew', 'owner', 'claude', 'agent']
  const COLOR6 = /^#[0-9a-f]{6}$/i
  function meetApply(st, instant) {
    if (!MC) return
    mtgWant = st || null
    if (shut) return
    const on = !!(st && st.on && Array.isArray(st.attendees))
    const want = new Map()
    if (on) {
      for (const a of st.attendees.slice(0, MC.seats.length)) {
        if (!a || typeof a.id !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(a.id) || !KINDS.includes(a.kind)) continue
        if (!Number.isInteger(a.seat) || !MC.seats[a.seat] || [...want.values()].some(x => x.seat === a.seat)) continue
        if (a.kind === 'crew' && !crew.some(c => c.id === a.crew)) continue
        if (a.kind === 'agent' && !have.has(`sp-g-${a.desk}-f0`)) continue
        want.set(a.id, { id: a.id, kind: a.kind, seat: a.seat, desk: a.desk, crew: a.crew, color: COLOR6.test(a.color) ? a.color : '#a78bfa' })
      }
    }
    for (const m of [...mtg.values()]) {
      const a = want.get(m.id)
      if (!a) mtgLeave(m)
      else if (MC.seats[a.seat] !== m.seat) {                // a new chair: over to it
        m.seat = MC.seats[a.seat]
        mtgGo(m, false)
      }
      if (a) m.color = a.color
    }
    for (const a of want.values()) if (!mtg.has(a.id)) mtgJoin(a, instant)
    mtgSpeaker = on && st.speaker && mtg.has(st.speaker) ? st.speaker : null
  }
  function meetTick() {
    for (const m of mtg.values()) {
      if (m.w.seated && m.w.pose !== 'walk') m.w.dir = m.id === mtgSpeaker ? 'down' : m.seat.dir
    }
    const sp = mtgSpeaker && mtg.get(mtgSpeaker)
    const want = sp && sp.w.seated ? sp : null
    if (!want) {
      if (halo) {
        actors.delete(halo)
        halo.el.remove()
        halo.arrow.remove()
        halo = null
      }
      return
    }
    if (!halo || halo.color !== want.color) {
      if (halo) {
        actors.delete(halo)
        halo.el.remove()
        halo.arrow.remove()
      }
      const el = mk('g', { 'pointer-events': 'none' })
      const e1 = mk('ellipse', { cx: 6, cy: 20, rx: 9, ry: 3.4, fill: want.color, opacity: '.55' }, el)
      mk('animate', { attributeName: 'opacity', values: '.3;.7;.3', dur: '1.4s', repeatCount: 'indefinite' }, e1)
      mk('ellipse', { cx: 6, cy: 20, rx: 6, ry: 2, fill: '#ffffff', opacity: '.35' }, el)
      const arrow = mk('g', { 'pointer-events': 'none' }, over)
      const bob = mk('g', {}, arrow)
      mk('path', { d: 'M3 -8h7v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z', fill: OUT, transform: 'translate(6.5 -4) scale(1.12) translate(-6.5 4)' }, bob)
      mk('path', { d: 'M3 -8h7v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z', fill: want.color }, bob)
      mk('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0;0 -1.5;0 0', dur: '.8s', repeatCount: 'indefinite' }, bob)
      halo = { el, z: 0, color: want.color, arrow }
      actors.add(halo)
    }
    halo.z = Math.round(want.w.y) - 0.5
    const tr = `translate(${Math.round(want.w.x) - 6} ${Math.round(want.w.y) - 20})`
    if (halo.tr !== tr) {
      halo.el.setAttribute('transform', (halo.tr = tr))
      halo.arrow.setAttribute('transform', tr)
    }
  }
  // where a seated attendee's head is, in art pixels (conference.js's bubble): null while they walk
  function meetPos(id) {
    const m = mtg.get(id)
    if (!m || !m.w.seated) return null
    return { x: Math.round(m.w.x), y: Math.round(m.w.y) - 21, feet: Math.round(m.w.y) }
  }

  // the guard's state, from the live list: closed or open
  document.addEventListener('nr:data', e => {
    const d = e.detail && e.detail.data
    if (!d || !d.usage || typeof d.usage !== 'object') return
    setShut(d.usage.closed === true, d.usage.until)
  })

  window.__aoOffice = {
    meet: meetApply,
    meetPos,
    egg(name) { return Object.prototype.hasOwnProperty.call(EGGS, name) ? EGGS[name]() : false },
    dance() { return cats.dance ? cats.dance() : false },
    // where a pet is drawn now, in art pixels: its feet's middle and its frame's size (for a long press on it)
    petAt(ax, ay) {
      for (const k of cats) {
        const [w, h] = k.size[k.frame()] || k.size.sit
        const y = k.y - (k.hop || 0)
        if (ax >= k.x - w / 2 - 3 && ax <= k.x + w / 2 + 3 && ay >= y - h - 4 && ay <= y + 2) return true
      }
      return false
    },
    // you said something (in the window or the terminal): a bubble over you, a paper plane down to Claude's desk
    ownerSaid(text) {
      const t = String(text || '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
      if (!t || ownerAway || shut) return
      owner.say(t.length > 44 ? t.slice(0, 43) + '…' : t, 0, 4)
      const [lx, ly] = owner.at
      float('plane', lx - 3, ly - 14, { to: [CFG.lobby.claude[0] - 3, CFG.lobby.claude[1] + 6], dur: 1.6, arc: 10 })
    },
    // Claude's state: thinking while it works, its newest reply's first line for a while
    claude(busy, brief, fresh) {
      claudeState.busy = !!busy
      svg.setAttribute('data-busy', staffBusy || claudeState.busy ? '1' : '0')
      if (fresh && brief) {
        claudeState.brief = String(brief)
        claudeState.briefUntil = NOW + 9
      }
    },
    highlight,
    moment(name) { if (visitor && visitor.state === 'work') startMoment(visitor, name) },
  }

  // -- the clock that runs it all: fixed steps, drawn when something moved, paused with the tab
  function tick(dt) {
    NOW += dt
    for (let i = pending.length - 1; i >= 0; i--) {
      if (NOW >= pending[i].at) {
        const p = pending.splice(i, 1)[0]
        try { p.fn() } catch (e) { console.error(e) }
      }
    }
    for (const w of crew) crewTick(w)
    meetings()
    for (const w of agents.values()) agentTick(w)
    if (cats.tick) cats.tick()
    for (const w of crew) w.step(dt)
    for (const w of agents.values()) w.step(dt)
    for (const w of extraFolk) w.step(dt)
    if (cats.step) cats.step(dt)
    meetTick()
    tweenTick()
    turns()
    paperTick()
    floatTick()
    markerTick()
    for (let i = leftOnDesk.length - 1; i >= 0; i--) {
      if (NOW > leftOnDesk[i].until) {
        leftOnDesk[i].el.remove()
        leftOnDesk.splice(i, 1)
      }
    }
  }
  function draw() {
    for (const w of crew) w.render()
    for (const w of agents.values()) w.render()
    for (const w of extraFolk) w.render()
    for (const k of cats) k.render()
    owner.render()
    claudeTick()
    sortStage()
  }
  let last = performance.now()
  let acc = 0
  function loop(t) {
    acc += Math.min(0.25, (t - last) / 1000)
    last = t
    let moved = false
    while (acc >= STEP) {
      acc -= STEP
      tick(STEP)
      moved = true
    }
    if (moved) draw()
    requestAnimationFrame(loop)
  }
  document.addEventListener('visibilitychange', () => {
    last = performance.now()
    if (!document.hidden) poll()
  })
  sky()
  draw()
  requestAnimationFrame(loop)
  poll()
  setInterval(poll, 3000)
  window.__aoDebug = { crew, agents, taken, owner: owner, cats, get now() { return NOW }, moment: n => window.__aoOffice.moment(n),
    cat: (name, spot) => cats.go && cats.go(name, spot), trick: (name, kind) => cats.trick && cats.trick(name, kind), mtg, setShut }
})()
