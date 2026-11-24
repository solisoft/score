"""A SoundFont writer: SF2 (16-bit samples) or SF3 (each sample an Ogg Vorbis
stream, as MuseScore's sf3convert writes them and SpessaSynth reads them).

    bank = Bank("Violin section", comment="…", copyright="CC0 1.0")
    k = bank.sample("VlnA3 L", ogg=bytes_, rate=44100, root=57, loop=(88200, 264600))
    bank.preset("Sustain", program=0, zones=[Zone(sample=k, keys=(55, 58), vels=(0, 127), pan=-500, loop=True)],
                release=0.35)
    open("violin-section.sf3", "wb").write(bank.write())

A preset has one instrument, an instrument its zones: what a sampled
articulation needs, and no more. No dependency but the standard library.
"""

import math
import struct
from dataclasses import dataclass, field

# Generators (SoundFont 2.04, §8.1.2).
PAN = 17
ATTACK = 34
RELEASE = 38
INSTRUMENT = 41
KEY_RANGE = 43
VEL_RANGE = 44
FINE_TUNE = 52
SAMPLE_ID = 53
SAMPLE_MODES = 54
ROOT_KEY = 58

MONO, RIGHT, LEFT = 1, 2, 4
COMPRESSED = 0x10


def timecents(seconds):
    """Seconds as the envelope generators count them."""
    return max(-12000, min(8000, round(1200 * math.log2(max(seconds, 0.001)))))


@dataclass
class Zone:
    sample: int
    keys: tuple = (0, 127)
    vels: tuple = (0, 127)
    pan: int = 0  # -500 (left) … 500 (right)
    loop: bool = False
    root: int = None  # the sample's own when None
    tune: int = 0  # cents
    release: float = None  # the preset's when None


@dataclass
class _Sample:
    name: str
    data: bytes
    frames: int
    rate: int
    root: int
    loop: tuple
    kind: int
    link: int = 0
    compressed: bool = False


@dataclass
class _Preset:
    name: str
    program: int
    bank: int
    zones: list
    release: float
    attack: float


@dataclass
class Bank:
    name: str
    comment: str = ""
    copyright: str = ""
    software: str = "score/scripts/sounds"
    samples: list = field(default_factory=list)
    presets: list = field(default_factory=list)

    def sample(self, name, *, rate, root, ogg=None, pcm=None, frames=None, loop=None, kind=MONO):
        """Adds a sample — `ogg` (a Vorbis stream of `frames` frames) or `pcm` (16-bit little-endian) — and
        answers its index. `loop` is (start, end) in frames from its start."""
        if ogg is not None:
            self.samples.append(_Sample(name, ogg, frames, rate, root, loop or (0, 0), kind, compressed=True))
        else:
            self.samples.append(_Sample(name, pcm, len(pcm) // 2, rate, root, loop or (0, 0), kind))
        return len(self.samples) - 1

    def link(self, left, right):
        """Makes two samples the halves of a stereo pair."""
        self.samples[left].kind, self.samples[left].link = LEFT, right
        self.samples[right].kind, self.samples[right].link = RIGHT, left

    def preset(self, name, *, program, zones, bank=0, release=0.3, attack=0.001):
        self.presets.append(_Preset(name, program, bank, zones, release, attack))

    def write(self):
        compressed = any(s.compressed for s in self.samples)
        if compressed and not all(s.compressed for s in self.samples):
            raise ValueError("a bank is all Vorbis or all PCM")
        smpl = bytearray()
        shdr = bytearray()
        for s in self.samples:
            start = len(smpl) if compressed else len(smpl) // 2
            smpl += s.data
            if compressed:
                end = len(smpl)
                # A stream ends on an even offset: the chunk is read in 16-bit words.
                if len(smpl) & 1:
                    smpl += b"\0"
                loop = s.loop  # from the sample's own start, in frames
            else:
                end = len(smpl) // 2
                smpl += b"\0" * 92  # 46 silent frames after each sample (§7.10)
                loop = (start + s.loop[0], start + s.loop[1])
            kind = s.kind | (COMPRESSED if compressed else 0)
            shdr += struct.pack("<20sIIIIIBbHH", _name(s.name), start, end, loop[0], loop[1], s.rate, s.root, 0, s.link, kind)
        shdr += struct.pack("<20sIIIIIBbHH", b"EOS", 0, 0, 0, 0, 0, 0, 0, 0, 0)

        phdr, pbag, pgen, inst, ibag, igen = (bytearray() for _ in range(6))
        gens_p = gens_i = 0
        for k, p in enumerate(sorted(self.presets, key=lambda p: (p.bank, p.program))):
            phdr += struct.pack("<20sHHHIII", _name(p.name), p.program, p.bank, k, 0, 0, 0)
            pbag += struct.pack("<HH", gens_p, 0)
            pgen += struct.pack("<HH", INSTRUMENT, k)
            gens_p += 1
            inst += struct.pack("<20sH", _name(p.name), len(ibag) // 4)
            # The instrument's global zone: what every zone shares.
            ibag += struct.pack("<HH", gens_i, 0)
            for oper, amount in ((ATTACK, timecents(p.attack)), (RELEASE, timecents(p.release))):
                igen += struct.pack("<Hh", oper, amount)
                gens_i += 1
            for z in p.zones:
                s = self.samples[z.sample]
                ibag += struct.pack("<HH", gens_i, 0)
                # Key range first, velocity range next, the sample last (§8.1.2).
                listed = [(KEY_RANGE, None, z.keys), (VEL_RANGE, None, z.vels)]
                if z.pan:
                    listed.append((PAN, z.pan, None))
                if z.release is not None:
                    listed.append((RELEASE, timecents(z.release), None))
                if z.tune:
                    listed.append((FINE_TUNE, z.tune, None))
                listed.append((SAMPLE_MODES, 1 if z.loop else 0, None))
                listed.append((ROOT_KEY, s.root if z.root is None else z.root, None))
                listed.append((SAMPLE_ID, z.sample, None))
                for oper, amount, span in listed:
                    igen += struct.pack("<HBB", oper, span[0], span[1]) if span else struct.pack("<Hh", oper, amount)
                    gens_i += 1
        phdr += struct.pack("<20sHHHIII", b"EOP", 0, 0, len(self.presets), 0, 0, 0)
        pbag += struct.pack("<HH", gens_p, 0)
        pgen += struct.pack("<HH", 0, 0)
        inst += struct.pack("<20sH", b"EOI", len(ibag) // 4)
        ibag += struct.pack("<HH", gens_i, 0)
        igen += struct.pack("<HH", 0, 0)
        mod = b"\0" * 10

        info = [
            _chunk(b"ifil", struct.pack("<HH", 3 if compressed else 2, 1)),
            _chunk(b"isng", _text("EMU8000")),
            _chunk(b"INAM", _text(self.name)),
        ]
        if self.copyright:
            info.append(_chunk(b"ICOP", _text(self.copyright)))
        if self.comment:
            info.append(_chunk(b"ICMT", _text(self.comment)))
        info.append(_chunk(b"ISFT", _text(self.software)))
        body = b"sfbk" + _list(b"INFO", info) + _list(b"sdta", [_chunk(b"smpl", bytes(smpl))])
        body += _list(b"pdta", [
            _chunk(b"phdr", bytes(phdr)), _chunk(b"pbag", bytes(pbag)), _chunk(b"pmod", mod), _chunk(b"pgen", bytes(pgen)),
            _chunk(b"inst", bytes(inst)), _chunk(b"ibag", bytes(ibag)), _chunk(b"imod", mod), _chunk(b"igen", bytes(igen)),
            _chunk(b"shdr", bytes(shdr)),
        ])
        return b"RIFF" + struct.pack("<I", len(body)) + body


def _name(text):
    return text.encode("ascii", "replace")[:19]


def _text(text):
    raw = text.encode("ascii", "replace")[:255] + b"\0"
    return raw + (b"\0" if len(raw) & 1 else b"")


def _chunk(tag, body):
    return tag + struct.pack("<I", len(body)) + body + (b"\0" if len(body) & 1 else b"")


def _list(kind, chunks):
    return _chunk(b"LIST", kind + b"".join(chunks))
