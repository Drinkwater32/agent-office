"""Makes the office's lo-fi loop (popout/lofi.wav), from nothing but arithmetic: no samples, no recordings, no one
else's music, so the loop is this project's own and ships under its license. Standard library only.

Eight bars at 72 BPM (about 27 seconds) that loop seamlessly: a soft electric-piano chord on each bar (Fmaj7, Em7,
Dm7, Cmaj7, twice), a round sine bass, a muffled kick and snare with a lazy swing, brushed hats, and a little vinyl
crackle and hiss, all through a gentle low-pass. Mono, 16 kHz, 8-bit: small, and lo-fi on purpose.

usage: py -3 tools/make_lofi.py [out.wav]
"""
import math
import os
import random
import sys
import wave

RATE = 16_000
BPM = 72
BEAT = 60 / BPM
BARS = 8
N = int(RATE * BEAT * 4 * BARS)
rnd = random.Random(20261030)          # the same loop every time it's made
mix = [0.0] * N


def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def add(start, length, fn):
    """Adds fn(t) for t seconds from `start` (seconds), wrapping round the end so the loop has no seam."""
    s0 = int(start * RATE)
    for i in range(int(length * RATE)):
        mix[(s0 + i) % N] += fn(i / RATE)


def epiano(freqs, start, length, vel=0.11):
    def f(t):
        env = math.exp(-t * 1.6) * min(1.0, t * 60)
        trem = 1 + 0.08 * math.sin(2 * math.pi * 4.5 * t)
        return vel * env * trem * sum(math.sin(2 * math.pi * fr * t) + 0.25 * math.sin(4 * math.pi * fr * t) for fr in freqs) / len(freqs)
    add(start, length, f)


def bass(fr, start, length):
    add(start, length, lambda t: 0.16 * math.exp(-t * 2.2) * min(1.0, t * 80) * math.sin(2 * math.pi * fr * t))


def kick(start):
    def f(t):
        fr = 50 + 70 * math.exp(-t * 30)
        return 0.32 * math.exp(-t * 14) * math.sin(2 * math.pi * fr * t)
    add(start, 0.35, f)


def snare(start):
    lp = [0.0]

    def f(t):
        lp[0] += 0.35 * (rnd.uniform(-1, 1) - lp[0])
        return 0.13 * math.exp(-t * 22) * lp[0] + 0.04 * math.exp(-t * 30) * math.sin(2 * math.pi * 190 * t)
    add(start, 0.25, f)


def hat(start, vel):
    prev = [0.0]

    def f(t):
        x = rnd.uniform(-1, 1)
        hp = x - prev[0]
        prev[0] = x
        return vel * math.exp(-t * 70) * hp
    add(start, 0.06, f)


# the chords (root in the bass an octave down), one a bar, voiced close and warm
CHORDS = [(53, [57, 60, 64, 65]), (52, [55, 59, 62, 64]), (50, [53, 57, 60, 62]), (48, [52, 55, 59, 60])] * 2
SWING = 0.12 * BEAT
for bar, (root, voice) in enumerate(CHORDS):
    t0 = bar * 4 * BEAT
    epiano([note(m) for m in voice], t0, 3.4)
    epiano([note(m) for m in voice[1:]], t0 + 2.5 * BEAT + SWING, 1.8, 0.06)       # a soft answer on the "and" of 3
    bass(note(root - 12), t0, 1.6 * BEAT)
    bass(note(root - 12), t0 + 2.5 * BEAT + SWING, 1.2 * BEAT)
    kick(t0)
    kick(t0 + 2.5 * BEAT + SWING)
    snare(t0 + BEAT)
    snare(t0 + 3 * BEAT)
    for e in range(8):
        hat(t0 + e * BEAT / 2 + (SWING if e % 2 else 0), 0.05 if e % 2 else 0.035)

# vinyl: a low hiss and a crackle now and then
hiss = 0.0
for i in range(N):
    hiss += 0.05 * (rnd.uniform(-1, 1) - hiss)
    mix[i] += 0.012 * hiss
    if rnd.random() < 0.0009:
        mix[i] += rnd.uniform(-0.12, 0.12)

# a gentle low-pass, run twice round the loop so its start matches its end, then soft limiting
y = 0.0
out = [0.0] * N
for _ in range(2):
    for i in range(N):
        y += 0.42 * (mix[i] - y)
        out[i] = y
peak = max(abs(v) for v in out) or 1.0
frames = bytes(int(128 + 120 * math.tanh(1.4 * v / peak)) for v in out)

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'popout', 'lofi.wav')
with wave.open(path, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(1)
    w.setframerate(RATE)
    w.writeframes(frames)
print(f'wrote {os.path.abspath(path)}: {N / RATE:.1f} s, {len(frames) + 44} bytes')
