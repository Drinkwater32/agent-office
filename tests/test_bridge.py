"""The bridge's checks, against a real server on a spare loopback port. Standard library only:
    python -m unittest discover -s tests -p "test_*.py"
"""
import http.client
import io
import json
import os
import re
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bridge'))
import bridge  # noqa: E402


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.TemporaryDirectory(prefix='agent office ')     # a space in the path, on purpose
        root = os.path.join(cls.dir.name, 'run dir')
        os.makedirs(root)
        with open(os.path.join(root, 'office.html'), 'wb') as f:
            f.write(b'<link href="office.css?k=__AOK__">')
        with open(os.path.join(root, 'secret.txt'), 'w') as f:
            f.write('not served')
        cls.token = 'T' * 43
        cls.out = io.StringIO()
        bridge.sys.stdout = cls.out
        cls.srv = bridge.Bridge(root, root, cls.token, 0)
        cls.port = cls.srv.port
        threading.Thread(target=cls.srv.serve_forever, kwargs={'poll_interval': 0.1}, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        bridge.sys.stdout = sys.__stdout__
        cls.dir.cleanup()

    def ask(self, method, path, headers=None, body=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        c.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        h = {'Host': f'127.0.0.1:{self.port}', **(headers or {})}
        if body is not None:
            h['Content-Length'] = str(len(body))
        for k, v in h.items():
            if v is not None:
                c.putheader(k, v)
        c.endheaders(body)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, dict(r.getheaders()), data

    def post(self, body=b'hello', **over):
        h = {'Origin': f'http://127.0.0.1:{self.port}', 'X-Office-Token': self.token, 'Content-Type': 'text/plain'}
        h.update(over)
        return self.ask('POST', '/send', h, body)[0]

    def test_binds_loopback_only(self):
        self.assertEqual(self.srv.server_address[0], '127.0.0.1')

    def test_page_needs_the_token(self):
        self.assertEqual(self.ask('GET', '/office.html')[0], 401)
        self.assertEqual(self.ask('GET', '/office.html?k=' + 'X' * 43)[0], 401)
        st, h, body = self.ask('GET', f'/office.html?k={self.token}')
        self.assertEqual(st, 200)
        self.assertIn(self.token.encode(), body)          # the page's links carry the token that opened it
        self.assertIn("default-src 'none'", h['Content-Security-Policy'])
        self.assertEqual(h['Referrer-Policy'], 'no-referrer')
        self.assertFalse(any(k.lower().startswith('access-control') for k in h))

    def test_exact_host(self):
        for host in ('localhost:%d' % self.port, 'evil.example', '127.0.0.1', '127.0.0.1:1'):
            self.assertEqual(self.ask('GET', f'/office.html?k={self.token}', {'Host': host})[0], 403, host)

    def test_cross_origin_reads_refused(self):
        self.assertEqual(self.ask('GET', f'/office.html?k={self.token}', {'Origin': 'http://evil.example'})[0], 403)
        self.assertEqual(self.ask('GET', f'/office.html?k={self.token}', {'Sec-Fetch-Site': 'cross-site'})[0], 403)

    def test_only_listed_files(self):
        self.assertEqual(self.ask('GET', f'/secret.txt?k={self.token}')[0], 404)
        self.assertEqual(self.ask('GET', f'/../bridge.py?k={self.token}')[0], 404)
        self.assertEqual(self.ask('GET', f'/%2e%2e/bridge.py?k={self.token}')[0], 404)

    def test_post_checks(self):
        self.assertEqual(self.post(Origin=None), 403)
        self.assertEqual(self.post(Origin='http://evil.example'), 403)
        self.assertEqual(self.post(**{'X-Office-Token': None}), 401)
        self.assertEqual(self.post(**{'X-Office-Token': 'X' * 43}), 401)
        self.assertEqual(self.post(**{'Content-Type': 'application/x-www-form-urlencoded'}), 415)
        self.assertEqual(self.post(b'x' * 5000), 413)
        self.assertEqual(self.post(b'   '), 400)
        self.assertEqual(self.ask('OPTIONS', '/send')[0], 405)

    def test_a_message_comes_out_as_one_json_line(self):
        before = self.out.getvalue()
        self.assertEqual(self.post('hi \u00e9\x07 there'.encode(), **{'X-Office-Cid': 'abc123'}), 200)
        line = self.out.getvalue()[len(before):].strip().splitlines()[-1]
        self.assertEqual(json.loads(line), {'msg': 'hi \u00e9 there', 'cid': 'abc123'})

    def emitted_by(self, fn):
        before = self.out.getvalue()
        status = fn()
        return status, [json.loads(ln) for ln in self.out.getvalue()[len(before):].strip().splitlines() if ln]

    def test_an_egg_code_is_answered_and_never_passed_on(self):
        for code in (b'/confetti', b'  /CONFETTI ', b'/confetti\n'):
            status, out = self.emitted_by(lambda: self.post(code))
            self.assertEqual(status, 200)
            self.assertEqual(out, [], code)
        status, out = self.emitted_by(lambda: self.post(b'please /confetti'))
        self.assertEqual(out, [{'msg': 'please /confetti', 'cid': ''}])

    def test_the_egg_patterns_match_the_hooks(self):
        # hooks/eggs.ts and bridge.py hold the same codes: a code the page somehow sends is dropped here too
        src = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'hooks', 'eggs.ts')
        with open(src, encoding='utf-8') as f:
            ts = re.findall(r"^\s+\w+: '(.*)',$", f.read(), re.M)
        self.assertEqual([p.replace('\\\\', '\\') for p in ts], [p.pattern for p in bridge.EGG_CODES])

    def test_call_a_meeting(self):
        h = {'Origin': f'http://127.0.0.1:{self.port}', 'X-Office-Token': self.token, 'Content-Type': 'text/plain'}
        status, out = self.emitted_by(lambda: self.ask('POST', '/meeting', h, json.dumps({'topic': 'Plan the week'}).encode())[0])
        self.assertEqual((status, out), (200, [{'call': {'topic': 'Plan the week'}}]))
        self.assertEqual(self.ask('POST', '/meeting', h, b'not json')[0], 400)
        self.assertEqual(self.ask('POST', '/meeting', h, json.dumps({'topic': 'x' * 201}).encode())[0], 400)
        self.assertEqual(self.ask('POST', '/meeting', h, json.dumps({'topic': 5}).encode())[0], 400)
        self.assertEqual(self.ask('POST', '/meeting', {**h, 'X-Office-Token': 'X' * 43}, b'{}')[0], 401)
        self.assertEqual(self.ask('POST', '/meeting', {**h, 'Origin': 'http://evil.example'}, b'{}')[0], 403)

    def test_say_in_meeting_marks_the_message(self):
        status, out = self.emitted_by(lambda: self.post(b'I agree', **{'X-Office-Mode': 'meeting'}))
        self.assertEqual(out, [{'msg': 'I agree', 'cid': '', 'meet': True}])
        status, out = self.emitted_by(lambda: self.post(b'plain', **{'X-Office-Mode': 'other'}))
        self.assertEqual(out, [{'msg': 'plain', 'cid': ''}])

    def test_the_soundtrack_is_a_listed_static_file(self):
        self.assertEqual(bridge.FILES['lofi.wav'], ('audio/wav', 'static'))
        self.assertEqual(bridge.FILES['lofi.js'][1], 'static')
        self.assertNotIn('media-src', bridge.CSP)            # fetched and decoded: connect-src 'self' covers it
        self.assertIn("connect-src 'self'", bridge.CSP)
        here = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'popout', 'lofi.wav')
        with open(here, 'rb') as f:
            self.assertEqual(f.read(4), b'RIFF')

    def test_the_new_files_are_listed(self):
        for name in ('meeting.js', 'conference.js', 'extras.js'):
            self.assertIn(name, bridge.FILES)
        self.assertIn('meeting.js', bridge.RUN_FILES)

    def test_settings_from_stdin(self):
        s = bridge.settings(['--stdin'], io.StringIO(json.dumps({'root': 'C:/a b/c', 'port': True, 'prune': 1}) + '\n'))
        self.assertEqual(s['root'], 'C:/a b/c')
        self.assertEqual(s['port'], bridge.DEFAULT_PORT)     # a bool is not a port
        self.assertFalse(s['prune'])                          # 1 is not a bool


if __name__ == '__main__':
    unittest.main()
