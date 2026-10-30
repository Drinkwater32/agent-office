"""agent-office's local bridge: serves the office page to the browser on this machine and takes the messages typed in
its chat.

Run by the agent-office plugin for the session's life (it dies with the plugin's spawn loop, or on its own once the
plugin stops writing its heartbeat file). Standard library only; Python 3.8 or newer.

Security:
- listens on 127.0.0.1 only, on a fixed port (47321 by default) or, when that is taken, on one the OS picks;
- a random per-session token (256 bits, from `secrets`) is required on every request: `?k=` on a GET, the
  `X-Office-Token` header on a POST; compared in constant time;
- the Host header must be exactly this bridge's own (127.0.0.1:port), so a DNS-rebinding page can't reach it; an
  Origin, when sent, must be the same origin, and a Sec-Fetch-Site, when sent, same-origin; a POST must carry that
  Origin and the token header (a custom header, so no simple cross-site form can send it);
- a POST body is text/plain UTF-8, at most 4 KB, and at most 20 messages a minute (a meeting call counts as one);
- a message that is one of the office's easter-egg codes (the same pattern hooks/eggs.ts holds) is answered and
  dropped, never passed on: the codes are the office's own and never reach Claude;
- only a fixed list of files is served, never a path from the request; no CORS headers, ever; a strict CSP;
- nothing is logged per request (the URL carries the token);
- an idle connection is dropped after 30 seconds.

Files: the page's scripts and icon come from the plugin's own folder (static); the session's live files (the page,
its style sheet, the floor plan, the list, the sprites, the conversation, the meeting) from the session's run
folder (root), outside the plugin. A file answers with an ETag and `no-cache`, so a page that polls gets a bodiless 304 while
nothing changed.

Paths come on stdin (`--stdin`: one JSON line, {"root", "static", "heartbeat", "session", "port", "port_wait",
"prune"}), never on the command line, so a space in a path can't split an argument. The flags below do the same for
a manual run.

Out: one JSON line per event on stdout: {"ready": true, "port": N, "token": "..."} once listening, then
{"msg": "...", "cid": "..."} for each accepted message ("meet": true added when it was sent with "Say in meeting" on),
and {"call": {"topic": "..."}} for "Call a meeting".
"""
import argparse
import errno
import hashlib
import hmac
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

MAX_BODY = 4096
RATE = 20            # messages a minute
DEFAULT_PORT = 47321
JS = 'text/javascript; charset=utf-8'
# name: (content type, which folder): 'static' is the plugin's popout folder, 'run' the session's run folder
FILES = {
    'office.html': ('text/html; charset=utf-8', 'run'),
    'office.css': ('text/css; charset=utf-8', 'run'),
    'layout.js': (JS, 'run'),
    'staff.js': (JS, 'run'),
    'sprites.js': (JS, 'run'),
    'convo.js': (JS, 'run'),
    'meeting.js': (JS, 'run'),
    'engine.js': (JS, 'static'),
    'frontdesk.js': (JS, 'static'),
    'conference.js': (JS, 'static'),
    'extras.js': (JS, 'static'),
    'lofi.js': (JS, 'static'),
    'lofi.wav': ('audio/wav', 'static'),     # the soundtrack's loop, made by tools/make_lofi.py; fetched, so no media-src
    'icon.png': ('image/png', 'static'),
}
RUN_FILES = {n for n, (_, where) in FILES.items() if where == 'run'}
RUN_DIR = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
CID = re.compile(r'^[a-z0-9]{1,24}$')
TOKEN = re.compile(r'^[A-Za-z0-9_-]{43,128}$')
BAD_CHARS = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
# the office's easter-egg codes typed at the front desk (hooks/eggs.ts holds the same): dropped here, never emitted
EGG_CODES = [re.compile(r'^\s*/confetti\s*$', re.I)]
TOPIC_MAX = 200


def is_egg(text):
    return len(text) <= 40 and any(p.match(text) for p in EGG_CODES)
# what a request without the right token gets when it asked for the page: why, and what to do (no data at all)
EXPIRED = (b'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           b'<title>Agent Office</title><h1>This office link no longer works</h1>'
           b'<p>It belongs to an earlier session. Run /office in Claude Code to open a fresh one.</p>')

OUT_LOCK = threading.Lock()


def emit(obj):
    with OUT_LOCK:
        sys.stdout.write(json.dumps(obj) + '\n')
        sys.stdout.flush()


class Bridge(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, root, static, token, port, port_wait=0.0):
        until = time.monotonic() + port_wait
        while True:
            try:
                super().__init__(('127.0.0.1', port), Handler)
                break
            except OSError as e:      # the fixed port is taken (another session's bridge, say): let the OS pick
                if e.errno not in (errno.EADDRINUSE, errno.EACCES, 10048, 10013):
                    raise
                if time.monotonic() < until:      # this session's last bridge may still be letting go of it
                    time.sleep(0.25)
                    continue
                super().__init__(('127.0.0.1', 0), Handler)
                break
        self.root = root
        self.static = static
        self.token = token
        self.port = self.server_address[1]
        self.host = f'127.0.0.1:{self.port}'
        self.origin = f'http://{self.host}'
        self.sent = []
        self.sent_lock = threading.Lock()

    def handle_error(self, request, client_address):   # a client hanging up mid-answer: nothing to print or log
        pass

    def server_bind(self):
        # on Windows, no other program may bind this port alongside us (without it, a more specific bind could)
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    server_version = 'agent-office'
    sys_version = ''
    protocol_version = 'HTTP/1.1'
    timeout = 30                    # an idle or stalled connection lets its thread go

    def log_message(self, *args):   # never log: the URL carries the token
        pass

    # -- answers
    def answer(self, code, body=b'', ctype='text/plain; charset=utf-8', etag=None):
        self.send_response(code)
        if code != 304:
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
        if etag:                        # a file: the browser may keep it, but asks every time (a 304 when unchanged)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', 'private, no-cache')
        else:
            self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', CSP)
        self.end_headers()
        if self.command != 'HEAD' and code != 304:
            self.wfile.write(body)

    def deny(self, code, why, body=None, ctype='text/plain; charset=utf-8'):
        self.close_connection = True
        self.drain()
        self.answer(code, body if body is not None else why.encode(), ctype)

    def drain(self):
        # a POST refused before its body was read: read a small body first, so closing the connection doesn't reset it
        # before the client has the answer (Windows does). A body over the cap is left alone.
        if self.command != 'POST' or getattr(self, 'body_read', False):
            return
        self.body_read = True
        try:
            n = int(self.headers.get('Content-Length', ''))
        except ValueError:
            return
        if 0 < n <= MAX_BODY:
            try:
                self.rfile.read(n)
            except OSError:
                pass

    # -- checks shared by every method: the Host, the Origin, the fetch site
    def same_origin(self):
        if self.headers.get('Host', '') != self.server.host:
            return False
        origin = self.headers.get('Origin')
        if origin is not None and origin != self.server.origin:
            return False
        site = self.headers.get('Sec-Fetch-Site')
        if site is not None and site not in ('same-origin', 'none'):
            return False
        return True

    def token_ok(self, given):
        return bool(given) and hmac.compare_digest(given.encode(), self.server.token.encode())

    def do_GET(self):
        if not self.same_origin():
            return self.deny(403, 'forbidden')
        parts = urlsplit(self.path)
        q = parse_qs(parts.query, max_num_fields=8)
        name = parts.path.lstrip('/') or 'office.html'
        given = (q.get('k') or [''])[0]
        if not self.token_ok(given):
            if name == 'office.html':
                return self.deny(401, '', EXPIRED, 'text/html; charset=utf-8')
            return self.deny(401, 'token required')
        spec = FILES.get(name)
        if not spec:
            return self.deny(404, 'not found')
        ctype, where = spec
        try:
            with open(os.path.join(self.server.root if where == 'run' else self.server.static, name), 'rb') as f:
                body = f.read()
        except OSError:
            return self.deny(404, 'not found')
        if name == 'office.html':     # the page's own links carry the token that opened it
            body = body.replace(b'__AOK__', given.encode())
        etag = '"' + hashlib.blake2b(body, digest_size=12).hexdigest() + '"'
        if etag in [t.strip() for t in self.headers.get('If-None-Match', '').split(',')]:
            return self.answer(304, etag=etag)
        self.answer(200, body, ctype, etag)

    do_HEAD = do_GET

    def do_POST(self):
        s = self.server
        if not self.same_origin() or self.headers.get('Origin') != s.origin:
            return self.deny(403, 'forbidden')
        if not self.token_ok(self.headers.get('X-Office-Token', '')):
            return self.deny(401, 'token required')
        path = urlsplit(self.path).path
        if path not in ('/send', '/meeting'):
            return self.deny(404, 'not found')
        ctype = self.headers.get('Content-Type', '').split(';')[0].strip().lower()
        if ctype != 'text/plain':
            return self.deny(415, 'text/plain only')
        try:
            n = int(self.headers.get('Content-Length', ''))
        except ValueError:
            return self.deny(411, 'length required')
        if n < 0 or n > MAX_BODY:
            return self.deny(413, 'too long')
        raw = self.rfile.read(n)
        self.body_read = True
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            return self.deny(400, 'utf-8 only')
        text = BAD_CHARS.sub('', text.replace('\r\n', '\n')).strip()
        if not text:
            return self.deny(400, 'empty')
        call = None
        if path == '/meeting':          # "Call a meeting" in the office: {"topic": "..."} (the topic is optional)
            try:
                got = json.loads(text)
            except ValueError:
                return self.deny(400, 'json only')
            topic = got.get('topic', '') if isinstance(got, dict) else None
            if not isinstance(topic, str) or len(topic) > TOPIC_MAX:
                return self.deny(400, 'a topic of 200 characters at most')
            call = {'topic': topic}
        elif is_egg(text):              # an easter egg's code: the office's own, never passed on to Claude
            return self.answer(200, b'{"ok":true,"egg":true}', 'application/json')
        meet = self.headers.get('X-Office-Mode', '') == 'meeting'
        cid = self.headers.get('X-Office-Cid', '')
        if not CID.match(cid):
            cid = ''
        now = time.monotonic()
        with s.sent_lock:
            s.sent = [t for t in s.sent if now - t < 60]
            if len(s.sent) >= RATE:
                return self.deny(429, 'slow down')
            s.sent.append(now)
        if call is not None:
            emit({'call': call})
        else:
            emit({'msg': text, 'cid': cid, 'meet': True} if meet else {'msg': text, 'cid': cid})
        self.answer(200, b'{"ok":true}', 'application/json')

    def do_OPTIONS(self):
        self.deny(405, 'no')

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS


def heartbeat(path, stale):
    """Exits once the plugin stops writing its heartbeat file: the plugin is gone and nothing else would end us."""
    while True:
        time.sleep(10)
        try:
            age = time.time() - os.path.getmtime(path)
        except OSError:
            age = stale + 1
        if age > stale:
            os._exit(0)


def prune(root, days=3.0):
    """Clears the run folders of sessions long gone, beside this one: only the files the plugin writes there, then the
    folder itself if that left it empty. Anything else in a folder keeps it."""
    parent = os.path.dirname(root)
    try:
        names = os.listdir(parent)
    except OSError:
        return
    for name in names:
        path = os.path.join(parent, name)
        if path == root or not RUN_DIR.match(name) or not os.path.isdir(path) or os.path.islink(path):
            continue
        try:
            newest = max([os.path.getmtime(os.path.join(path, f)) for f in os.listdir(path)] or [os.path.getmtime(path)])
            if time.time() - newest < days * 86400:
                continue
            for f in RUN_FILES:
                fp = os.path.join(path, f)
                if os.path.isfile(fp) and not os.path.islink(fp):
                    os.remove(fp)
            os.rmdir(path)
        except OSError:
            continue


def settings(argv=None, stdin=None):
    """The bridge's settings: the flags, with what came on stdin (when --stdin) over them, each checked."""
    ap = argparse.ArgumentParser()
    ap.add_argument('--stdin', action='store_true', help='read the settings below as one JSON line on stdin')
    ap.add_argument('--root', default='', help="the session's run folder: the page and its live files")
    ap.add_argument('--static', default='', help="the plugin's popout folder: the scripts and the icon")
    ap.add_argument('--heartbeat', default='')
    ap.add_argument('--stale', type=float, default=90)
    ap.add_argument('--port', type=int, default=DEFAULT_PORT)
    ap.add_argument('--port-wait', type=float, default=0, help='seconds to wait for the fixed port before another')
    ap.add_argument('--prune', action='store_true', help="clear long-gone sessions' run folders beside --root")
    a = ap.parse_args(argv)
    got = {}
    if a.stdin:
        try:
            got = json.loads((stdin or sys.stdin).readline() or '{}')
        except ValueError:
            got = {}
        if not isinstance(got, dict):
            got = {}

    def pick(key, default, kinds):
        v = got.get(key, default)
        if isinstance(v, bool) != (kinds is bool):
            return default
        return v if isinstance(v, kinds) else default

    root = pick('root', a.root, str)
    out = {
        'root': root,
        'static': pick('static', a.static, str) or root,
        'heartbeat': pick('heartbeat', a.heartbeat, str),
        'stale': a.stale,
        'port': pick('port', a.port, int),
        'port_wait': max(0.0, min(float(pick('port_wait', a.port_wait, (int, float))), 10.0)),
        'prune': pick('prune', a.prune, bool),
        'session': pick('session', '', str),
    }
    return out


def main():
    s = settings()
    if not s['root']:
        sys.exit('no run folder')
    if not 0 <= s['port'] < 65536:
        sys.exit('bad port')
    root = os.path.abspath(s['root'])
    token = s['session'] if TOKEN.match(s['session']) else secrets.token_urlsafe(32)
    srv = Bridge(root, os.path.abspath(s['static']), token, s['port'], s['port_wait'])
    if s['heartbeat']:
        threading.Thread(target=heartbeat, args=(s['heartbeat'], s['stale']), daemon=True).start()
    if s['prune']:
        threading.Thread(target=prune, args=(root,), daemon=True).start()
    emit({'ready': True, 'port': srv.port, 'token': srv.token})
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
