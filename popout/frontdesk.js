// The front desk: the conversation with Claude beside the office. It reads the conversation the plugin writes
// (convo.js) when the live list says it changed (through the bridge, by fetch, parsed as JSON; from a file, by a
// script tag) and, when the page came through the local bridge, sends what is typed to it (POST /send, with the
// session's token in a custom header). Every message is built as DOM nodes from text: nothing from the conversation
// is ever parsed as HTML. It also draws the page's pixel-type headings, keeps an unsent draft through a reload, and
// holds the page's own reloads (a rebuilt page) while something is being typed or a message is on its way.
(function () {
  'use strict'
  const $ = id => document.getElementById(id)
  const KEY = new URLSearchParams(location.search).get('k') || ''
  const LIVE = /^https?:$/.test(location.protocol) && /^[\w-]{40,}$/.test(KEY)
  const q = KEY ? `k=${encodeURIComponent(KEY)}&` : ''
  const office = () => window.__aoOffice
  const CFG0 = window.__aoCfg || {}
  const OWNER = String((CFG0.owner && CFG0.owner.name) || 'You').slice(0, 16)

  // -- pixel type: a 5 by 7 face for the headings, drawn as one path a run of text
  const G = {
    A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.', C: '.###.#...##....#....#....#...#.###.',
    D: '####.#...##...##...##...##...#####.', E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
    G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#', I: '.###...#....#....#....#....#...###.',
    J: '..###...#....#....#....##..#..##...', K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
    M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#', O: '.###.#...##...##...##...##...#.###.',
    P: '####.#...##...#####.#....#....#....', Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
    S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..', U: '#...##...##...##...##...##...#.###.',
    V: '#...##...##...##...##...#.#.#...#..', W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
    Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####', 0: '.###.#...##..###.#.###..##...#.###.',
    1: '..#...##....#....#....#....#...###.', 2: '.###.#...#....#...#...#...#...#####', 3: '####.....#....#.###.....#....#####.',
    4: '...#...##..#.#.#..#.#####...#....#.', 5: '######....####.....#....##...#.###.', 6: '.###.#....#....####.#...##...#.###.',
    7: '#####....#...#...#...#....#....#...', 8: '.###.#...##...#.###.#...##...#.###.', 9: '.###.#...##...#.####....#....#.###.',
    '.': '..............................#....', ':': '.......#..............#............', '-': '................###................',
    '!': '..#....#....#....#....#.........#..', '?': '.###.#...#....#...#...#.........#..', "'": '..#....#...........................',
    '/': '....#....#...#...#...#...#....#....', '&': '.##..#..#.#.#...#...#.#.##..#..##.#', '·': '.................#.................',
    '+': '.......#....#..#####..#....#.......', '#': '.#.#.#####.#.#..#.#.#####.#.#......',
  }
  function pixelPath(str) {
    let d = ''
    let x = 0
    for (const ch of String(str).toUpperCase()) {
      if (ch === ' ') { x += 4; continue }
      const g = G[ch]
      if (!g) { x += 4; continue }
      for (let i = 0; i < 35; i++) if (g[i] === '#') d += `M${x + (i % 5)} ${Math.floor(i / 5)}h1v1h-1z`
      x += 6
    }
    return { d, w: Math.max(1, x - 1) }
  }
  function pixelText(el) {
    const text = el.getAttribute('data-px') || el.textContent
    const { d, w } = pixelPath(text)
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    s.setAttribute('viewBox', `0 0 ${w} 7`)
    s.setAttribute('class', 'px')
    s.setAttribute('aria-hidden', 'true')
    s.setAttribute('shape-rendering', 'crispEdges')
    s.style.width = `calc(var(--px, 2px) * ${w})`
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    p.setAttribute('d', d)
    p.setAttribute('fill', 'currentColor')
    s.appendChild(p)
    const label = document.createElement('span')
    label.className = 'sr'
    label.textContent = text
    el.replaceChildren(s, label)
  }
  for (const k of Object.keys(G)) if (G[k].length !== 35) console.warn('pixel glyph', k, G[k].length)
  document.querySelectorAll('[data-px]').forEach(pixelText)
  window.__aoPixel = pixelText
  // a name in pixel type when every letter has a glyph, else as plain text
  const canPixel = t => [...String(t).toUpperCase()].every(ch => ch === ' ' || G[ch])

  // -- markdown, safely: blocks (code fences, headings, quotes, lists, tables kept monospace, paragraphs) and inline
  // code, bold, italic and links (as their text), all made with textContent
  function inline(parent, text) {
    const re = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|(^|[^\w])_([^_\s][^_]*?)_(?!\w)|!?\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g
    let at = 0
    let m
    while ((m = re.exec(text))) {
      const lead = m[6] || ''
      if (m.index + lead.length > at) parent.append(text.slice(at, m.index + lead.length))
      let el
      if (m[2] !== undefined) { el = document.createElement('code'); el.textContent = m[2] }
      else if (m[3] !== undefined || m[4] !== undefined) { el = document.createElement('strong'); inline(el, m[3] || m[4]) }
      else if (m[5] !== undefined || m[7] !== undefined) { el = document.createElement('em'); inline(el, m[5] || m[7]) }
      else {
        el = document.createElement('span')
        el.className = 'link'
        el.title = m[9]
        el.textContent = m[8]
      }
      parent.append(el)
      at = re.lastIndex
    }
    if (at < text.length) parent.append(text.slice(at))
  }
  function lines(parent, rows) {
    rows.forEach((r, i) => {
      if (i) parent.append(document.createElement('br'))
      inline(parent, r)
    })
  }
  function markdown(text) {
    const out = document.createDocumentFragment()
    const parts = String(text).replace(/\r\n/g, '\n').split(/^```[^\n]*\n?/m)
    parts.forEach((part, i) => {
      if (i % 2 === 1) {                       // a fenced block
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = part.replace(/\n$/, '')
        pre.append(code)
        out.append(pre)
        return
      }
      for (const block of part.split(/\n\s*\n/)) {
        const rows = block.split('\n').filter(r => r.trim() !== '')
        if (!rows.length) continue
        if (rows.every(r => /^\s*([-*+]|\d+[.)])\s+/.test(r))) {
          const ol = /^\s*\d/.test(rows[0])
          const list = document.createElement(ol ? 'ol' : 'ul')
          for (const r of rows) {
            const li = document.createElement('li')
            inline(li, r.replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
            list.append(li)
          }
          out.append(list)
        } else if (rows.length >= 2 && rows.every(r => /^\s*\|.*\|\s*$/.test(r))) {
          const pre = document.createElement('pre')
          pre.className = 'tbl'
          const code = document.createElement('code')
          code.textContent = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).join('\n')
          pre.append(code)
          out.append(pre)
        } else if (/^#{1,6}\s/.test(rows[0])) {
          const h = document.createElement('p')
          h.className = 'h'
          inline(h, rows[0].replace(/^#{1,6}\s+/, ''))
          out.append(h)
          if (rows.length > 1) {
            const p = document.createElement('p')
            lines(p, rows.slice(1))
            out.append(p)
          }
        } else if (rows.every(r => /^\s*>/.test(r))) {
          const bq = document.createElement('blockquote')
          lines(bq, rows.map(r => r.replace(/^\s*>\s?/, '')))
          out.append(bq)
        } else {
          const p = document.createElement('p')
          lines(p, rows)
          out.append(p)
        }
      }
    })
    return out
  }

  // -- the log
  const log = $('fd-log')
  const jump = $('fd-jump')
  const shown = new Map()        // id -> { li, sig }
  const pending = []             // { cid, text, at, status }
  let firstLoad = true
  let lastBrief = ''
  let data = null
  let dataAt = 0
  const time = ms => {
    try { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) } catch (e) { return '' }
  }
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80
  function avatar(who) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    s.setAttribute('viewBox', '1 1 10 10')
    s.setAttribute('class', 'av')
    s.setAttribute('aria-hidden', 'true')
    s.setAttribute('shape-rendering', 'crispEdges')
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    u.setAttribute('href', `#sp-${who === 'owner' ? 'owner' : 'claude'}-f0`)
    s.appendChild(u)
    return s
  }
  function note(m) {
    if (m.status === 'sending') return 'Sending…'
    if (m.status === 'failed') return m.why || 'Not sent.'
    if (m.state === 'failed') return 'Not delivered to Claude. Send it again.'
    if (m.via === 'terminal') return 'From the terminal'
    if (m.state === 'queued') return "Queued · Claude's mid-task"
    if (m.state === 'sent') return 'Sent'
    return ''
  }
  function build(m) {
    const li = document.createElement('li')
    li.className = `msg ${m.who}` + (m.status ? ` ${m.status}` : m.state === 'failed' ? ' failed' : '')
    const head = document.createElement('div')
    head.className = 'who'
    const name = document.createElement('span')
    name.className = 'name'
    const label = m.who === 'owner' ? OWNER : 'Claude'
    const t = document.createElement('time')
    t.textContent = time(m.at)
    head.append(avatar(m.who), name, t)
    if (canPixel(label)) {
      name.setAttribute('data-px', label)
      pixelText(name)
    } else name.textContent = label
    const body = document.createElement('div')
    body.className = 'body'
    body.append(m.who === 'claude' ? markdown(m.text) : plainBody(m.text))
    li.append(head, body)
    const n = note(m)
    if (n) {
      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = n
      li.append(meta)
    }
    return li
  }
  function plainBody(text) {               // your words as typed, line breaks kept
    const f = document.createDocumentFragment()
    const p = document.createElement('p')
    p.className = 'pre'
    p.textContent = text
    f.append(p)
    return f
  }
  function render() {
    const msgs = (data && Array.isArray(data.msgs) ? data.msgs : []).filter(m => m && typeof m.text === 'string' &&
      (m.who === 'owner' || m.who === 'claude') && typeof m.id === 'string')
    const stick = firstLoad || nearBottom()
    const known = new Set(msgs.map(m => m.cid).filter(Boolean))
    for (let i = pending.length - 1; i >= 0; i--) if (known.has(pending[i].cid)) pending.splice(i, 1)
    const all = msgs.map(m => ({ key: m.id, m })).concat(pending.map(p => ({ key: 'p' + p.cid,
      m: { who: 'owner', text: p.text, at: p.at, status: p.status, why: p.why } })))
    const keep = new Set(all.map(x => x.key))
    for (const [k, v] of shown) if (!keep.has(k)) { v.li.remove(); shown.delete(k) }
    let added = false
    let prev = null
    for (const { key, m } of all) {
      const sig = `${m.text.length}|${m.state || ''}|${m.status || ''}|${m.via || ''}`
      let cur = shown.get(key)
      if (!cur || cur.sig !== sig) {
        const li = build(m)
        if (cur) cur.li.replaceWith(li)
        else {
          added = true
          if (!firstLoad && m.who === 'owner' && !m.status && !(m.cid && sentHere.has(m.cid)) && office()) office().ownerSaid(m.text)
        }
        cur = { li, sig }
        shown.set(key, cur)
      }
      const want = prev ? prev.nextSibling : log.firstChild
      if (cur.li !== want) log.insertBefore(cur.li, want)
      prev = cur.li
    }
    const empty = $('fd-empty')
    if (empty) {
      empty.textContent = data ? 'No messages yet. Say hi to Claude.' : ''
      empty.hidden = all.length > 0
    }
    if (stick) log.scrollTop = log.scrollHeight
    else if (added) jump.hidden = false
    if (data) firstLoad = false
  }
  log.addEventListener('scroll', () => { if (nearBottom()) jump.hidden = true })
  jump.addEventListener('click', () => {
    log.scrollTop = log.scrollHeight
    jump.hidden = true
  })

  // -- the status line: Claude idle or at work (and how long), and how many agents are out
  let agentsOut = 0
  document.addEventListener('nr:staff', e => {
    agentsOut = +(e.detail && e.detail.working) || 0
    status()
  })
  function status() {
    const el = $('fd-status')
    if (!el) return
    const busy = !!(data && data.busy)
    let text = busy ? 'Working' : 'Idle'
    if (busy && data.since && data.now) {
      const mins = Math.floor(((data.now - data.since) + (Date.now() - dataAt)) / 60000)
      if (mins >= 1) text += ` · ${mins}m`
    }
    if (agentsOut) text += ` · ${agentsOut} agent${agentsOut === 1 ? '' : 's'} out`
    el.textContent = text
    el.className = 'status ' + (busy ? 'busy' : 'idle')
  }

  // -- reading the conversation
  function apply(d) {
    if (!d || typeof d !== 'object') return
    data = d
    dataAt = Date.now()
    render()
    where()
    status()
    const lastClaude = (d.msgs || []).filter(m => m && m.who === 'claude').slice(-1)[0]
    const claudeCount = (d.msgs || []).filter(m => m && m.who === 'claude').length
    if (seenClaude !== null && claudeCount > seenClaude && deskClosed()) unread(claudeCount - seenClaude)
    seenClaude = claudeCount
    const brief = lastClaude ? String(lastClaude.brief || '') : ''
    const fresh = !!brief && brief !== lastBrief && lastBrief !== null && !(firstPoll && lastClaude)
    if (office()) office().claude(!!d.busy, brief, fresh)
    lastBrief = brief
    firstPoll = false
  }
  let firstPoll = true
  let seenClaude = null
  function where() {                       // the session's folder, so two sessions' offices are told apart
    const el = $('fd-where')
    const w = data && typeof data.where === 'string' ? data.where : ''
    if (el && w && el.textContent !== w) el.textContent = w
    if (el) el.hidden = !el.textContent
  }
  // one read at a time; another asked for meanwhile runs when it ends
  let reading = false
  let again = false
  function poll() {
    if (document.hidden) return
    if (reading) { again = true; return }
    reading = true
    const done = d => {
      reading = false
      if (d) {
        try { apply(d) } catch (e) { console.error(e) }
      }
      if (again) {
        again = false
        poll()
      }
    }
    if (LIVE) {
      fetch(`convo.js?${q.replace(/&$/, '')}`, { cache: 'no-cache', credentials: 'omit' })
        .then(r => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then(t => {
          const m = /^window\.__aoConvo = ([\s\S]*);\s*$/.exec(t)
          done(m ? JSON.parse(m[1]) : null)
        })
        .catch(() => done(null))
      return
    }
    window.__aoConvo = undefined
    const s = document.createElement('script')
    s.src = `convo.js?${q}t=${Date.now()}`
    s.onload = () => {
      s.remove()
      done(window.__aoConvo || null)
    }
    s.onerror = () => {
      s.remove()
      done(null)
    }
    document.head.appendChild(s)
  }
  // the live list (engine.js, every 3 s) carries the conversation's version: read it only when that moved. The list
  // answering is also how the page knows the bridge is there.
  let convoVer = null
  let misses = 0
  document.addEventListener('nr:data', e => {
    const d = e.detail || {}
    if (!d.ok) {
      if (++misses > 3) online(false)
      return
    }
    misses = 0
    online(true)
    const v = d.data && typeof d.data.convo === 'string' ? d.data.convo : ''
    if (v && v !== convoVer) {
      convoVer = v
      poll()
    }
  })

  // -- sending
  const form = $('fd-form')
  const box = $('fd-text')
  const send = $('fd-send')
  const off = $('fd-off')
  const sentHere = new Set()
  let isOnline = true
  function online(on) {
    if (!LIVE) return
    isOnline = on
    off.hidden = on
    off.textContent = on ? '' : 'The bridge is not answering. Run /office-popout in Claude Code again.'
    send.disabled = !on
  }
  if (LIVE) {
    form.hidden = false
    off.hidden = true
  }
  // the draft: kept for this tab through a reload
  const DRAFT = 'ao-draft'
  function saveDraft() { try { sessionStorage.setItem(DRAFT, box.value) } catch (e) { /* private window */ } }
  try {
    const d = sessionStorage.getItem(DRAFT)
    if (d && !box.value) box.value = d
  } catch (e) { /* private window */ }
  // the page's own reloads wait while something is being typed or a message is on its way; `go` reloads, and the call returns
  // true when it went
  let reloadGo = null
  function reloadNow(go) {
    const typing = document.activeElement === box
    const sending = pending.some(p => p.status === 'sending')
    if (typing || sending) {
      reloadGo = go
      return false
    }
    reloadGo = null
    saveDraft()
    go()
    return true
  }
  window.__aoReload = (go, force) => {
    const g = typeof go === 'function' ? go : () => location.reload()
    if (force) {
      saveDraft()
      g()
      return true
    }
    return reloadNow(g)
  }
  const retryReload = () => { if (reloadGo) setTimeout(() => { if (reloadGo) reloadNow(reloadGo) }, 400) }
  box.addEventListener('blur', retryReload)
  const bytes = s => new TextEncoder().encode(s).length
  function grow() {
    box.style.height = ''
    if (box.value) {                       // empty, it keeps the composer's own height
      box.style.height = 'auto'
      box.style.height = Math.min(box.scrollHeight, 180) + 'px'
    }
    const n = bytes(box.value)
    const c = $('fd-count')
    if (c) {
      c.hidden = n < 3200
      c.textContent = `${n} / 4096`
      c.classList.toggle('over', n > 4096)
    }
  }
  box.addEventListener('input', () => {
    grow()
    saveDraft()
  })
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      form.requestSubmit ? form.requestSubmit() : submit()
    }
  })
  form.addEventListener('submit', e => {
    e.preventDefault()
    submit()
  })
  async function submit() {
    const text = box.value.replace(/\s+$/, '').replace(/^\s+/, '')
    if (!text || !LIVE || !isOnline) return
    if (bytes(text) > 4096) {
      grow()
      return
    }
    const cid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4)
    const p = { cid, text, at: Date.now(), status: 'sending' }
    pending.push(p)
    sentHere.add(cid)
    box.value = ''
    saveDraft()
    grow()
    render()
    log.scrollTop = log.scrollHeight
    if (office()) office().ownerSaid(text)
    try {
      const r = await fetch('send', { method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain;charset=utf-8', 'X-Office-Token': KEY, 'X-Office-Cid': cid }, body: text })
      if (!r.ok) {
        p.status = 'failed'
        p.why = r.status === 429 ? 'Not sent: too many at once. Try again in a minute.' : `Not sent (${r.status}).`
        box.value = box.value || text
      }
    } catch (e) {
      p.status = 'failed'
      p.why = 'Not sent: the bridge is not answering.'
      box.value = box.value || text
    }
    saveDraft()
    grow()
    render()
    poll()
    retryReload()
  }

  // -- the desk in and out: closed, it is a bell on the office's edge with a count of Claude's unread replies; open,
  // it swings out. Clicking Claude at the front desk opens it too.
  const bell = $('fd-bell')
  const badge = $('fd-badge')
  const closeBtn = $('fd-close')
  const body = document.body
  const STILL = window.matchMedia('(prefers-reduced-motion: reduce)')
  const deskClosed = () => body.classList.contains('desk-closed')
  let unreadN = 0
  let animT = 0
  function remember(v) { try { localStorage.setItem('ao-desk', v) } catch (e) { /* private window */ } }
  function unread(n) {
    unreadN += n
    badge.textContent = unreadN > 9 ? '9+' : String(unreadN)
    badge.hidden = unreadN === 0
    bell.setAttribute('aria-label', unreadN ? `Open the front desk, ${unreadN} new from Claude` : 'Open the front desk')
    bell.classList.remove('ring')
    void bell.offsetWidth
    bell.classList.add('ring')
  }
  function setDesk(open, animate) {
    clearTimeout(animT)
    body.classList.remove('desk-in', 'desk-out')
    const still = !animate || STILL.matches
    if (open) {
      body.classList.remove('desk-closed')
      if (!still) {
        body.classList.add('desk-in')
        animT = setTimeout(() => body.classList.remove('desk-in'), 420)
      }
      bell.hidden = true
      unreadN = 0
      badge.hidden = true
      if (!form.hidden) setTimeout(() => box.focus({ preventScroll: true }), still ? 0 : 120)
    } else {
      const done = () => {
        body.classList.remove('desk-out')
        body.classList.add('desk-closed')
        bell.hidden = false
      }
      if (still) done()
      else {
        body.classList.add('desk-out')
        animT = setTimeout(done, 300)
      }
    }
    bell.setAttribute('aria-expanded', open ? 'true' : 'false')
    remember(open ? 'open' : 'closed')
  }
  window.__aoDesk = { set: setDesk, closed: deskClosed }
  closeBtn.hidden = false
  closeBtn.addEventListener('click', () => setDesk(false, true))
  bell.addEventListener('click', () => {
    setDesk(true, true)
    bell.blur()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !deskClosed()) setDesk(false, true)
  })
  document.addEventListener('click', e => {           // Claude at the front desk, in the scene
    const svg = e.target.closest && e.target.closest('#nr')
    const CFG = window.__aoCfg
    if (!svg || !CFG || !CFG.lobby || !deskClosed()) return
    const vb = svg.viewBox.baseVal
    const r = svg.getBoundingClientRect()
    const ax = (vb.x + (e.clientX - r.left) / r.width * vb.width) / 2
    const ay = (vb.y + (e.clientY - r.top) / r.height * vb.height) / 2
    const [cx, cy] = CFG.lobby.claude
    if (Math.abs(ax - cx) <= 8 && ay >= cy - 2 && ay <= cy + 22) {
      e.stopImmediatePropagation()
      setDesk(true, true)
    }
  }, true)
  let saved = ''
  try { saved = localStorage.getItem('ao-desk') || '' } catch (e) { /* private window */ }
  setDesk(saved !== 'closed', false)

  render()
  status()
  grow()
  poll()
  // a safety read now and then (a version missed); from a file the list carries no version, so it reads every second
  // and a half (local, free)
  let lastSafety = Date.now()
  setInterval(() => {
    const every = !LIVE ? 1500 : deskClosed() ? 60000 : 20000
    if (Date.now() - lastSafety >= every) {
      lastSafety = Date.now()
      poll()
    }
  }, 1500)
  setInterval(status, 30000)
  setInterval(() => { if (reloadGo) reloadNow(reloadGo) }, 5000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll() })
})()
