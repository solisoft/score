#!/usr/bin/env python3
"""Makes the built-in orchestra (#1040): one SF3 bank an instrument, from the
sample libraries scripts/sounds/fetch.sh puts in ~/.cache/score-sounds, and
the manifest the players read, public/soundfonts/orchestra.json.

    scripts/sounds/fetch.sh                      # the libraries and this script's Python, once
    scripts/sounds/build.py                      # every instrument (a few minutes)
    scripts/sounds/build.py --only flute,oboe    # these, the manifest's other entries kept
    scripts/sounds/build.py --fixture tests/fixtures/sounds   # the specs' tiny instrument

The banks go to ~/.cache/score-sounds/dist (never to git: .gitignore), under
names that carry a digest of their bytes — `flute.3f2a….sf3` — so a file is
served immutable and a changed one is another address. scripts/sounds/link.sh
puts them where the dev server serves them; deploy/sounds-upload.sh on the
server.

What is done to a sample, in order:

1. the silence before its attack goes (a note starts on time);
2. a held sound (bowed, blown, the organ, a roll) gets a loop: in its steady
   part, where the level at the loop's start matches its end, the start
   moved onto the waveform's phase, and the two ends crossfaded into the
   sample — then the sample stops at the loop's end, its release left to
   the synthesizer. A sound that dies away by itself is cut where it is
   60 dB down, or at its `cap`, and faded;
3. its pitch is measured (the first harmonics of its steady part) and
   brought to its key's when it is 4 to 40 cents off — not the piano's, which
   is stretched, nor a kettledrum's or a bell's, which have no harmonics;
4. its level is brought to the instrument's (two thirds of the way: a
   register that is louder stays a little louder), every dynamic layer to the
   same level — the synthesizer makes a soft note soft, the layer gives it
   its colour;
5. each channel is written as an Ogg Vorbis stream (SF3).

Of an SFZ file: sample, lokey, hikey, pitch_keycenter, lovel, hivel, tune and
the first of its round robins; the keys no region covers go to the nearest
one. scripts/sounds/catalog.py says which file makes which articulation.
"""

import argparse
import hashlib
import io
import json
import math
import os
import re
import sys
from multiprocessing import Pool

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sf2  # noqa: E402
from catalog import ARTICULATIONS, CATALOG, SOURCES  # noqa: E402

VERSION = 1
# Vorbis quality, 0 (smallest) to 1: 0.5 is oggenc's -q 5, about 80 kbit/s a channel.
QUALITY = 0.5
# What a held sample's loop is brought to (RMS), and a struck one's loudest quarter second; dBFS. Set so that
# a note sounds about as loud as MuseScore_General's of the same instrument: a score that mixes the two
# stays balanced. An instrument's `gain` (catalog.py, dB) is added.
HELD_LEVEL = -18.0
STRUCK_LEVEL = -20.0
PEAK = 10 ** (-1.0 / 20)
# How much of a sample's distance from its articulation's median level is taken away.
EVEN = 2 / 3
LOOP_WITHIN = 6.5  # seconds: a loop ends no later, so no held sample is longer


def db(x):
    return 20 * math.log10(max(x, 1e-9))


# ---- SFZ ------------------------------------------------------------------------------------


def read_sfz(path):
    """The regions of an SFZ file, each with what its <global> and <group> give it: [{opcode: value}]."""
    text = re.sub(r"//[^\n]*", "", open(path, encoding="utf-8", errors="replace").read())
    default_path = ""
    scope = {"global": {}, "group": {}}
    regions = []
    kind = None
    current = None
    for m in re.finditer(r"<(\w+)>|(\w+)=((?:(?!\s+\w+=|\s*<\w+>).)*)", text, re.S):
        if m.group(1):
            kind = m.group(1)
            if kind == "global":
                scope = {"global": {}, "group": {}}
            elif kind == "group":
                scope["group"] = {}
            elif kind == "region":
                current = {}
                regions.append(({**scope["global"]}, {**scope["group"]}, current))
            continue
        key, value = m.group(2), m.group(3).strip()
        if kind == "control" and key == "default_path":
            default_path = value
        elif kind in ("global", "group"):
            scope[kind][key] = value
        elif kind == "region":
            current[key] = value
    out = []
    for g, group, region in regions:
        r = {**g, **group, **region}
        r["sample"] = (default_path + r["sample"]).replace("\\", "/")
        out.append(r)
    return out


def first_round(regions):
    """The regions of the first round robin: a SoundFont plays one sample a key."""
    return [r for r in regions if int(r.get("seq_position", 1)) == 1 and float(r.get("lorand", 0)) == 0]


def keyboard(regions, keys=None):
    """`regions` ([{lokey, hikey, lovel, hivel, …}]) laid over the keys `keys` (lo, hi; all of them when None):
    a key no region covers takes the nearest key's, and each key's velocities are made to cover 0–127.
    Answers zones: [{region, keys: (lo, hi), vels: (lo, hi)}]."""
    lo, hi = keys or (0, 127)
    covered = {}
    for k in range(128):
        here = [r for r in regions if int(r["lokey"]) <= k <= int(r["hikey"])]
        if here:
            covered[k] = here
    if not covered:
        return []
    per_key = {}
    for k in range(lo, hi + 1):
        nearest = min(covered, key=lambda c: (abs(c - k), c))
        layers = sorted(covered[nearest], key=lambda r: (int(r.get("lovel", 0)), int(r.get("hivel", 127))))
        spans = []
        for n, r in enumerate(layers):
            low = 0 if n == 0 else spans[-1][2] + 1
            high = 127 if n == len(layers) - 1 else max(low, int(r.get("hivel", 127)))
            if low > 127:
                break
            spans.append((id(r), low, min(127, high), r))
        per_key[k] = spans
    zones = []
    open_zones = {}
    for k in range(lo, hi + 1):
        now = {}
        for rid, low, high, r in per_key[k]:
            sig = (rid, low, high)
            zone = open_zones.get(sig)
            if zone:
                zone["keys"] = (zone["keys"][0], k)
            else:
                zone = {"region": r, "keys": (k, k), "vels": (low, high)}
                zones.append(zone)
            now[sig] = zone
        open_zones = now
    return zones


# ---- Samples --------------------------------------------------------------------------------


def read_audio(path):
    data, rate = sf.read(path, dtype="float32", always_2d=True)
    if data.shape[1] > 2:
        data = data[:, :2]
    return data, rate


def trim_start(x, rate, over=0.02, before=0.008):
    """Without the silence before the attack: `before` seconds are kept before the first sample over `over` of
    the peak — a fiftieth for a struck sound; a twelfth for a held one, whose breath or bow noise before the
    tone would make the note late."""
    mono = np.abs(x).max(axis=1)
    peak = float(mono.max())
    if peak <= 0:
        return x
    first = int(np.argmax(mono > over * peak))
    start = max(0, first - int(before * rate))
    if start == 0:
        return x
    x = x[start:].copy()
    ramp = min(len(x), int(before * rate / 2))
    x[:ramp] *= np.linspace(0, 1, ramp, dtype=np.float32)[:, None]
    return x


def envelope(mono, rate, window=0.1, hop=0.02):
    """The RMS of `mono` over `window` seconds, every `hop`: (centres in frames, levels)."""
    w = max(2, int(window * rate))
    h = max(1, int(hop * rate))
    if len(mono) <= w:
        return np.array([len(mono) // 2]), np.array([float(np.sqrt(np.mean(mono.astype(np.float64) ** 2) + 1e-20))])
    total = np.concatenate([[0.0], np.cumsum(mono.astype(np.float64) ** 2)])
    centres = np.arange(w // 2, len(mono) - w // 2, h)
    return centres, np.sqrt((total[centres + w // 2] - total[centres - w // 2]) / w + 1e-20)


def rms(x):
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2) + 1e-20))


def looped(x, rate, lead=0.5, least=1.2):
    """`x` with a loop in its held part, cut at the loop's end: (samples, (start, end)), or None when the
    sound is not held long enough to loop — `lead` seconds after its attack, for `least` seconds at least."""
    mono = x.mean(axis=1)
    centres, env = envelope(mono, rate)
    level = np.percentile(env, 80)
    held = np.nonzero(env >= 0.6 * level)[0]
    if not len(held):
        return None
    first, last = int(centres[held[0]]), int(centres[held[-1]])
    end = min(last - int(0.15 * rate), int(LOOP_WITHIN * rate))
    earliest = first + int(lead * rate)
    if end - earliest < int(least * rate):
        return None
    # Where the loop starts: as loud as where it ends, and early (a long loop repeats less).
    window = int(0.3 * rate)
    at_end = rms(mono[end - window:end])
    latest = max(earliest, end - max(int(min(1.5, least) * rate), (end - earliest) // 2))
    start, best = earliest, None
    for s in range(earliest, latest + 1, int(0.05 * rate)):
        cost = abs(db(rms(mono[max(0, s - window):s])) - db(at_end)) + 0.3 * (s - earliest) / rate
        if best is None or cost < best:
            start, best = s, cost
    # Onto the waveform's phase at the end: the lag, within a period of the lowest note, that matches best.
    w = 8192
    reach = int(rate / 27)  # a period of the lowest A
    match = 0.0
    if start - reach - w > 0 and end - w > 0:
        ref = mono[end - w:end].astype(np.float64)
        seg = mono[start - reach - w:start + reach].astype(np.float64)
        dots = np.correlate(seg, ref, "valid")
        power = np.concatenate([[0.0], np.cumsum(seg ** 2)])
        norms = np.sqrt((power[w:] - power[:-w]) * float(np.dot(ref, ref))) + 1e-12
        scores = dots / norms[: len(dots)]
        lag = int(np.argmax(scores))
        match = float(scores[lag])
        start = start - reach + lag
    fade = min(int(0.5 * rate), (end - start) // 2, start)
    if fade < int(0.02 * rate):
        return None
    # Alike (one player's steady tone): a straight crossfade; unalike (a section): an equal-power one.
    power = 0.5 + 0.5 * min(1.0, max(0.0, match))
    t = np.linspace(0, 1, fade, endpoint=False, dtype=np.float64)[:, None]
    y = x[:end].astype(np.float64)
    y[end - fade:end] = x[end - fade:end] * (1 - t) ** power + x[start - fade:start] * t ** power
    # What follows the loop's end is what follows its start: the synthesizer reads a little past the end.
    y = np.concatenate([y, x[start:start + 64]])
    return y.astype(np.float32), (start, end)


def struck(x, rate, cap):
    """`x` cut where it is 60 dB under its loudest, or at `cap` seconds, and faded out."""
    mono = x.mean(axis=1)
    centres, env = envelope(mono, rate, window=0.05, hop=0.01)
    alive = np.nonzero(env >= env.max() * 10 ** (-60 / 20))[0]
    natural = min(len(x), int(centres[alive[-1]]) + int(0.05 * rate)) if len(alive) else len(x)
    n = min(natural, int(cap * rate))
    y = x[:n].copy()
    fade = min(n, int((0.25 * cap if n < natural else 0.05) * rate))
    if fade > 1:
        y[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)[:, None] ** 2
    return y


def loudest(x, rate, window=0.25):
    """The loudest `window` seconds of `x`, as RMS over its channels."""
    return max(envelope(x[:, c], rate, window=window, hop=0.02)[1].max() for c in range(x.shape[1])).item()


def power(x):
    """The RMS of `x` over its channels: the two sides of a stereo pair may cancel in their sum."""
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2) + 1e-20))


def off_pitch(x, rate, key):
    """How far `x` is from the pitch of `key`, in cents, or None when it cannot be told: where the power of
    each of its first three harmonics lies within 70 cents of its place (its centre, so a vibrato counts for
    what it is around), the harmonics weighed by their power."""
    seg = x[:, 0].astype(np.float64)
    if len(seg) < rate // 4:
        return None
    size = 1 << 19
    spectrum = np.abs(np.fft.rfft(seg[:size] * np.hanning(min(len(seg), size)), size)) ** 2
    freqs = np.fft.rfftfreq(size, 1 / rate)
    f0 = 440 * 2 ** ((key - 69) / 12)
    found = []
    for harmonic in (1, 2, 3):
        near = np.nonzero((freqs >= f0 * harmonic * 2 ** (-70 / 1200)) & (freqs <= f0 * harmonic * 2 ** (70 / 1200)))[0]
        if len(near) < 3:
            continue
        weight = spectrum[near]
        found.append((float(weight.sum()), 1200 * float((weight * np.log2(freqs[near] / (f0 * harmonic))).sum() / weight.sum())))
    if not found:
        return None
    strongest = max(found)[0]
    kept = [(w, c) for w, c in found if w >= 0.1 * strongest]
    return sum(w * c for w, c in kept) / sum(w for w, _ in kept)


def prepared(path, how, key=None):
    """A sample as it goes in a bank: { data, rate, loop, level, peak, cents } — `cents`, how far it is from
    the pitch of `key` (0 when it is not looked at, or cannot be told)."""
    x, rate = read_audio(path)
    # `over`: a tongued note's breath comes before its tone (catalog.py).
    x = trim_start(x, rate, how.get("over", 0.08), 0.012) if how.get("loop") or "over" in how else trim_start(x, rate)
    # A note that is not held for long (a loud tuba's) gets a shorter loop, sooner.
    made = (looped(x, rate) or looped(x, rate, lead=0.25, least=0.5)) if how.get("loop") else None
    if made:
        y, loop = made
        level = power(y[loop[0]:loop[1]])
        steady = y[loop[0]:loop[1]]
    else:
        y, loop = struck(x, rate, how.get("cap", 9.0)), None
        level = loudest(y, rate)
        steady = y[int(0.05 * rate):int(1.5 * rate)]
    cents = off_pitch(steady, rate, key) if key is not None and how.get("tune", True) else None
    return {"data": y, "rate": rate, "loop": loop, "level": level, "peak": float(np.abs(y).max()), "cents": cents or 0.0}


_CRC = []
for _n in range(256):
    _r = _n << 24
    for _ in range(8):
        _r = ((_r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if _r & 0x80000000 else (_r << 1) & 0xFFFFFFFF
    _CRC.append(_r)


def same_serial(stream):
    """An Ogg stream with its serial number, which the encoder draws at random, set to 1 and each page's
    checksum made again: the same samples make the same file, and so the same address."""
    out = bytearray(stream)
    at = 0
    while at + 27 <= len(out) and out[at:at + 4] == b"OggS":
        size = 27 + out[at + 26] + sum(out[at + 27:at + 27 + out[at + 26]])
        out[at + 14:at + 18] = (1).to_bytes(4, "little")
        out[at + 22:at + 26] = b"\0\0\0\0"
        crc = 0
        for byte in out[at:at + size]:
            crc = ((crc << 8) & 0xFFFFFFFF) ^ _CRC[(crc >> 24) ^ byte]
        out[at + 22:at + 26] = crc.to_bytes(4, "little")
        at += size
    return bytes(out)


def ogg(channel, rate):
    out = io.BytesIO()
    sf.write(out, channel, rate, format="OGG", subtype="VORBIS", compression_level=1 - QUALITY)
    return same_serial(out.getvalue())


def add_sample(bank, name, data, rate, root, loop, fmt):
    """`data` (frames × channels) put in `bank`: the indices of its channels' samples, [mono] or [left, right]."""
    stereo = data.shape[1] == 2 and float(np.abs(data[:, 0] - data[:, 1]).max()) > 1e-4
    channels = [data[:, 0], data[:, 1]] if stereo else [data.mean(axis=1)]
    out = []
    for k, channel in enumerate(channels):
        label = f"{name[:17]} {'LR'[k]}" if stereo else name
        if fmt == "sf3":
            out.append(bank.sample(label, ogg=ogg(channel, rate), frames=len(channel), rate=rate, root=root, loop=loop))
        else:
            pcm = (np.clip(channel, -1, 1) * 32767).astype("<i2").tobytes()
            out.append(bank.sample(label, pcm=pcm, rate=rate, root=root, loop=loop))
    if stereo:
        bank.link(out[0], out[1])
    return out


# ---- An instrument --------------------------------------------------------------------------


def salamander_zones(root, spec):
    """The piano's zones: a sample every minor third, three of its sixteen dynamic layers."""
    names = ["C", "D#", "F#", "A"]
    zones = []
    for key in range(21, 109, 3):
        note = f"{names[(key % 12) // 3]}{key // 12 - 1}"
        for layer, low, high in spec["layers"]:
            release = spec["undamped_release"] if key >= spec["undamped"] else None
            zones.append({
                "region": {"sample": f"Samples/{note}v{layer}.flac", "pitch_keycenter": key, "release": release},
                "keys": (0 if key == 21 else key - 1, 127 if key == 108 else key + 1),
                "vels": (low, high),
            })
    return zones


def build(entry, src, fmt="sf3"):
    """The bank of catalogue entry `entry`: (bytes, { articulations, keys, seconds, samples })."""
    source = SOURCES[entry["source"]]
    root = os.path.join(src, source["dir"])
    bank = sf2.Bank(entry["name"], comment=f"{source['name']} {source['version'][:12]}, {source['credit']}. Made for Score (#1040).",
                    copyright=f"{source['license']}, {source['credit']}")
    arts = {}
    if "salamander" in entry:
        spec = entry["salamander"]
        # The piano keeps its own tuning: a grand is stretched, sharp at the top and flat at the bottom.
        arts["sustain"] = [(None, {"zones": salamander_zones(root, spec), "loop": False, "cap": spec["cap"], "release": spec["release"], "tune": False})]
    else:
        for name, parts in entry["arts"].items():
            arts[name] = [(first_round(read_sfz(os.path.join(root, p["sfz"]))), p) for p in parts]
    report = {"articulations": [], "seconds": 0.0, "samples": 0, "keys": None}
    for name in ARTICULATIONS:
        if name not in arts:
            continue
        zones_out = []
        release = arts[name][0][1]["release"]
        for regions, how in arts[name]:
            # Each sample once, however many zones play it — and only those a zone plays.
            made = {}
            unlooped = set()
            while True:
                zones = how["zones"] if regions is None else keyboard([r for r in regions if r["sample"] not in unlooped], how.get("keys"))
                for z in zones:
                    r = z["region"]
                    if r["sample"] not in made:
                        made[r["sample"]] = prepared(os.path.join(root, r["sample"]), how, int(r["pitch_keycenter"]) + 12 * how.get("octave", 0))
                used = {z["region"]["sample"] for z in zones}
                # A held sound too short to loop would stop under a long note: its keys go to its neighbours.
                short = {path for path in used if how.get("loop") and made[path]["loop"] is None}
                if regions is None or not short or short == used:
                    break
                unlooped |= short
            made = {path: m for path, m in made.items() if path in used}
            keys = {z["region"]["sample"]: int(z["region"]["pitch_keycenter"]) + 12 * how.get("octave", 0) for z in zones}
            levels = [db(m["level"]) for m in made.values()]
            median = float(np.median(levels))
            target = (HELD_LEVEL if how.get("loop") else STRUCK_LEVEL) + entry.get("gain", 0)
            index = {}
            for path, m in made.items():
                gain = 10 ** ((target - median - EVEN * (db(m["level"]) - median)) / 20)
                gain = min(gain, PEAK / max(m["peak"], 1e-9))
                label = os.path.splitext(os.path.basename(path))[0]
                index[path] = add_sample(bank, label, m["data"] * gain, m["rate"], keys[path], m["loop"], fmt)
                report["seconds"] += len(m["data"]) / m["rate"]
                report["samples"] += len(index[path])
            for z in zones:
                r = z["region"]
                ids = index[r["sample"]]
                loop = made[r["sample"]]["loop"] is not None
                for k, sample in enumerate(ids):
                    zones_out.append(sf2.Zone(
                        sample=sample, keys=z["keys"], vels=z["vels"], loop=loop,
                        pan=(-500, 500)[k] if len(ids) == 2 else 0,
                        root=int(r["pitch_keycenter"]) + 12 * how.get("octave", 0),
                        # Brought to pitch: what the SFZ says, less what the sample is off by (4 to 40 cents).
                        tune=int(float(r.get("tune", 0))) - (round(cents) if 4 <= abs(cents := made[r["sample"]]["cents"]) <= 40 else 0),
                        # A held sample too short to loop is let ring as it was recorded.
                        release=r.get("release") or (None if loop or not how.get("loop") else 0.8),
                    ))
            if name == "sustain":
                roots = [int(z["region"]["pitch_keycenter"]) + 12 * how.get("octave", 0) for z in zones]
                lo, hi = min(roots), max(roots)
                report["keys"] = [min(lo, report["keys"][0]), max(hi, report["keys"][1])] if report["keys"] else [lo, hi]
        bank.preset(f"{entry['name'][:10]} {name}", program=ARTICULATIONS.index(name), zones=zones_out, release=release)
        report["articulations"].append(name)
    return bank.write(), report


def make(args):
    entry, src, out = args
    try:
        data, report = build(entry, src)
    except StopIteration as error:  # it would end the pool's loop without a word
        raise RuntimeError(f"{entry['id']}: {error!r}") from error
    digest = hashlib.sha256(data).hexdigest()
    name = f"{entry['id']}.{digest[:16]}.sf3"
    for old in os.listdir(out):
        if old.startswith(entry["id"] + ".") and old.endswith(".sf3") and old != name and old.split(".")[0] == entry["id"]:
            os.remove(os.path.join(out, old))
    with open(os.path.join(out, name), "wb") as f:
        f.write(data)
    source = SOURCES[entry["source"]]
    return {
        "id": entry["id"], "name": entry["name"], "source": entry["source"], "file": name, "sha256": digest, "size": len(data),
        "sounds": entry["sounds"], "articulations": report["articulations"], "keys": report["keys"],
        "seconds": round(report["seconds"]), "samples": report["samples"], "license": source["license"],
    }


def manifest(instruments):
    sources = {k: {f: v[f] for f in ("name", "version", "url", "sha256", "home", "license", "credit")} for k, v in SOURCES.items()}
    return {
        "version": VERSION,
        "base": "/soundfonts/orchestra/",
        "made": {"by": "scripts/sounds/build.py", "quality": QUALITY, "numpy": np.__version__, "libsndfile": sf.__libsndfile_version__},
        "articulations": ARTICULATIONS,
        "sources": sources,
        "instruments": instruments,
    }


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=1, ensure_ascii=False)
        f.write("\n")


def fixture(directory):
    """The specs' instrument: a sine that holds (its sustain) and one that dies away (its staccato), a few kB."""
    os.makedirs(directory, exist_ok=True)
    rate = 22050
    t = np.arange(int(0.5 * rate)) / rate
    # A whole number of periods in the loop: A4, 440 Hz, 0.1 s to 0.4 s.
    held = (0.5 * np.sin(2 * np.pi * 440 * t) * np.minimum(1, t / 0.01)).astype(np.float32)
    short = (0.5 * np.sin(2 * np.pi * 440 * t[: rate // 4]) * np.exp(-t[: rate // 4] * 30)).astype(np.float32)
    bank = sf2.Bank("Test tone", comment="A sine, for Score's specs (#1040).", copyright="CC0-1.0")
    a = bank.sample("held", ogg=ogg(held, rate), frames=len(held), rate=rate, root=69, loop=(int(0.1 * rate), int(0.4 * rate)))
    b = bank.sample("short", ogg=ogg(short, rate), frames=len(short), rate=rate, root=69)
    bank.preset("Test tone sustain", program=0, zones=[sf2.Zone(sample=a, loop=True)], release=0.05)
    bank.preset("Test tone staccato", program=1, zones=[sf2.Zone(sample=b)], release=0.3)
    data = bank.write()
    digest = hashlib.sha256(data).hexdigest()
    name = f"test-tone.{digest[:16]}.sf3"
    for old in os.listdir(directory):
        if old.endswith(".sf3"):
            os.remove(os.path.join(directory, old))
    with open(os.path.join(directory, name), "wb") as f:
        f.write(data)
    made = manifest([{
        "id": "test-tone", "name": "Test tone", "source": "vsco2ce", "file": name, "sha256": digest, "size": len(data),
        "sounds": {"acoustic grand": "sustain", "violin": "sustain"}, "articulations": ["sustain", "staccato"], "keys": [21, 108],
        "seconds": 1, "samples": 2, "license": "CC0-1.0",
    }])
    write_json(os.path.join(directory, "orchestra.json"), made)
    print(f"{name}: {len(data)} bytes")


def main():
    cache = os.path.join(os.path.expanduser("~"), ".cache", "score-sounds")
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--src", default=os.environ.get("SCORE_SOUNDS_SRC", cache), help="where fetch.sh put the libraries")
    parser.add_argument("--out", default=os.environ.get("SCORE_SOUNDS_DIR", os.path.join(cache, "dist")), help="where the banks go")
    parser.add_argument("--manifest", default=os.path.join(HERE, "..", "..", "public", "soundfonts", "orchestra.json"))
    parser.add_argument("--only", default="", help="instrument ids, comma-separated")
    parser.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 1))
    parser.add_argument("--fixture", default="", help="write the specs' instrument and its manifest into this directory, and stop")
    args = parser.parse_args()
    if args.fixture:
        return fixture(args.fixture)
    os.makedirs(args.out, exist_ok=True)
    only = [x for x in args.only.split(",") if x]
    unknown = set(only) - {e["id"] for e in CATALOG}
    if unknown:
        sys.exit(f"no such instrument: {', '.join(sorted(unknown))}")
    entries = [e for e in CATALOG if not only or e["id"] in only]
    with Pool(args.jobs) as pool:
        made = {}
        for row in pool.imap_unordered(make, [(e, args.src, args.out) for e in entries]):
            made[row["id"]] = row
            print(f"{row['file']}: {row['size'] / 1e6:.1f} MB, {row['samples']} samples, {row['seconds']} s, {'/'.join(row['articulations'])}", flush=True)
    kept = {}
    if only and os.path.exists(args.manifest):
        kept = {i["id"]: i for i in json.load(open(args.manifest, encoding="utf-8"))["instruments"]}
    kept.update(made)
    missing = [e["id"] for e in entries if e["id"] not in made]
    if missing:
        sys.exit(f"not made: {', '.join(missing)}")
    instruments = [kept[e["id"]] for e in CATALOG if e["id"] in kept]
    write_json(args.manifest, manifest(instruments))
    total = sum(i["size"] for i in instruments)
    print(f"{len(instruments)} instruments, {total / 1e6:.1f} MB — manifest: {os.path.relpath(args.manifest)}")


if __name__ == "__main__":
    main()
