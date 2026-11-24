"""The built-in orchestra (#1040): which instrument is made from which
samples, and which of Score's sounds (LilyPond's midiInstrument names,
score-model.js PROGRAMS) each one plays.

Two libraries, both free to redistribute, commercially too:

- VSCO 2 Community Edition 1.1.0, Versilian Studios (Sam Gossner) — CC0 1.0;
- Salamander Grand Piano V3, Alexander Holm — CC BY 3.0 (credit required).

An articulation is a list of parts: an SFZ file of the library and, for an
instrument put together from several (the string ensemble), the keys it
takes. `sounds` maps a sound of Score's to the articulation a staff with
that sound starts in: "pizzicato strings" is the strings, plucked.
"""

SOURCES = {
    "vsco2ce": {
        "name": "VSCO 2 Community Edition",
        "version": "1.1.0",
        "url": "https://github.com/sgossner/VSCO-2-CE/archive/refs/tags/1.1.0.tar.gz",
        "sha256": "ac577fd3bc9171560087c8182ef6072f11ae0b63b3c3af9a5f752b91e26d3b96",
        "home": "https://vis.versilstudios.com/vsco-community.html",
        "license": "CC0-1.0",
        "credit": "Versilian Studios (Sam Gossner)",
        "dir": "vsco",
    },
    "salamander": {
        "name": "Salamander Grand Piano V3",
        "version": "3382bf9496bba2486f5ab0de55a264d1dfc38404",
        "url": "https://github.com/sfzinstruments/SalamanderGrandPiano/archive/3382bf9496bba2486f5ab0de55a264d1dfc38404.tar.gz",
        "sha256": "f36bef84632067387909ba03064daee6e81afdea3f93526c4ee56a22e12613ba",
        "home": "https://github.com/sfzinstruments/SalamanderGrandPiano",
        "license": "CC-BY-3.0",
        "credit": "Alexander Holm",
        "dir": "salamander",
    },
}

# The articulations a bank may hold, each at its program: a manifest says which are there.
ARTICULATIONS = ["sustain", "staccato", "pizzicato", "tremolo"]

# `gain` (dB): an instrument made louder or softer than the level every instrument is brought to, where
# its notes would not sit with the General MIDI ones otherwise.
#
# `over`: how loud, against its peak, a sample is where it is taken to begin — a tongued staccato's breath
# before the tone would make the note late (a fiftieth for a struck sound, a twelfth for a held one).
#
# `octave`: the VSCO files give the glockenspiel and the xylophone the key an octave under what is heard;
# a key here is the pitch heard, as General MIDI's is. `tune` False: a sound with no harmonics to tune by.
#
# How a kind of sample is cut and played: `loop` finds a loop in the held
# part and stops the sample there; `release` is the fade once the key is let
# go; `cap` the longest a sample that is not looped is kept, in seconds.
HELD = {"loop": True, "release": 0.3}
SHORT = {"loop": False, "release": 0.9, "cap": 3.0}
RUNG = {"loop": False, "release": 2.5, "cap": 9.0}


def part(sfz, keys=None, **how):
    return {"sfz": sfz, "keys": keys, **how}


def bowed(prefix, sustain, release=0.35):
    return {
        "sustain": [part(f"{prefix}{sustain}.sfz", **{**HELD, "release": release})],
        "staccato": [part(f"{prefix}Spic.sfz", **SHORT)],
        "pizzicato": [part(f"{prefix}Pizz.sfz", **{**SHORT, "release": 1.5, "cap": 4.0})],
        "tremolo": [part(f"{prefix}Trem.sfz", **{**HELD, "release": release})],
    }


def ensemble():
    """The four sections on one keyboard: basses under the cellos' C, violins from the G above middle C."""
    split = [("Contrabass", "SusVB", (0, 35)), ("CelloEns", "SusVib", (36, 55)), ("ViolaEns", "SusVib", (56, 66)), ("ViolinEns", "SusVib", (67, 127))]
    out = {}
    for prefix, sustain, keys in split:
        for name, parts in bowed(prefix, sustain).items():
            out.setdefault(name, []).append({**parts[0], "keys": keys})
    return out


def blown(prefix, sustain="Sus", release=0.2):
    return {
        "sustain": [part(f"{prefix}{sustain}.sfz", **{**HELD, "release": release})],
        "staccato": [part(f"{prefix}Stac.sfz", **{**SHORT, "release": 0.6, "over": 0.15})],
    }


def struck(sfz, release, cap=9.0, **how):
    return {"sustain": [part(sfz, **{**RUNG, "release": release, "cap": cap, **how})]}


CATALOG = [
    {"id": "piano", "name": "Grand piano", "source": "salamander", "sounds": {"acoustic grand": "sustain", "bright acoustic": "sustain"},
     "salamander": {"layers": [(4, 0, 50), (9, 51, 95), (14, 96, 127)], "cap": 10.0, "release": 0.45, "undamped": 89, "undamped_release": 3.0}},
    {"id": "violin", "name": "Solo violin", "source": "vsco2ce", "sounds": {"violin": "sustain"}, "arts": bowed("SViolin", "Vib")},
    {"id": "violin-section", "name": "Violin section", "source": "vsco2ce", "sounds": {"violin": "sustain"}, "arts": bowed("ViolinEns", "SusVib")},
    {"id": "viola-section", "gain": -2, "name": "Viola section", "source": "vsco2ce", "sounds": {"viola": "sustain"}, "arts": bowed("ViolaEns", "SusVib")},
    {"id": "cello-section", "name": "Cello section", "source": "vsco2ce", "sounds": {"cello": "sustain"}, "arts": bowed("CelloEns", "SusVib")},
    {"id": "contrabass", "gain": -3, "name": "Double bass", "source": "vsco2ce", "sounds": {"contrabass": "sustain"}, "arts": bowed("Contrabass", "SusVB")},
    {"id": "strings", "name": "String orchestra", "source": "vsco2ce",
     "sounds": {"string ensemble 1": "sustain", "string ensemble 2": "sustain", "tremolo strings": "tremolo", "pizzicato strings": "pizzicato"},
     "arts": ensemble()},
    {"id": "harp", "name": "Harp", "source": "vsco2ce", "sounds": {"orchestral harp": "sustain"}, "arts": struck("Harp.sfz", 2.5, cap=8.0)},
    {"id": "piccolo", "gain": 2, "name": "Piccolo", "source": "vsco2ce", "sounds": {"piccolo": "sustain"}, "arts": blown("Piccolo")},
    {"id": "flute", "gain": 2, "name": "Flute", "source": "vsco2ce", "sounds": {"flute": "sustain"}, "arts": blown("Flute", "SusVib")},
    {"id": "oboe", "gain": 2, "name": "Oboe", "source": "vsco2ce", "sounds": {"oboe": "sustain"}, "arts": blown("Oboe", "SusVib")},
    {"id": "clarinet", "name": "Clarinet", "source": "vsco2ce", "sounds": {"clarinet": "sustain"}, "arts": blown("Clarinet")},
    {"id": "bassoon", "gain": 3, "name": "Bassoon", "source": "vsco2ce", "sounds": {"bassoon": "sustain"}, "arts": blown("Bassoon")},
    {"id": "horn", "name": "French horn", "source": "vsco2ce", "sounds": {"french horn": "sustain"}, "arts": blown("FHorn", release=0.25)},
    {"id": "trumpet", "name": "Trumpet", "source": "vsco2ce", "sounds": {"trumpet": "sustain"}, "arts": blown("Trumpet")},
    {"id": "trumpet-muted", "name": "Muted trumpet", "source": "vsco2ce", "sounds": {"muted trumpet": "sustain"},
     "arts": {"sustain": [part("TrumpetStraightMuteSus.sfz", **{**HELD, "release": 0.2})]}},
    {"id": "trombone", "gain": 2, "name": "Trombone", "source": "vsco2ce", "sounds": {"trombone": "sustain"}, "arts": blown("Trombone", release=0.25)},
    {"id": "tuba", "gain": 3, "name": "Tuba", "source": "vsco2ce", "sounds": {"tuba": "sustain"}, "arts": blown("Tuba", release=0.25)},
    {"id": "timpani", "name": "Timpani", "source": "vsco2ce", "sounds": {"timpani": "sustain"},
     "arts": {**struck("Timpani.sfz", 2.5, cap=7.0, tune=False), "tremolo": [part("TimpaniRolls.sfz", **{**HELD, "release": 1.0, "tune": False})]}},
    {"id": "glockenspiel", "name": "Glockenspiel", "source": "vsco2ce", "sounds": {"glockenspiel": "sustain"}, "arts": struck("Glockenspiel.sfz", 3.0, cap=6.0, octave=1)},
    {"id": "xylophone", "name": "Xylophone", "source": "vsco2ce", "sounds": {"xylophone": "sustain"}, "arts": struck("Xylophone.sfz", 0.8, cap=3.0, octave=1)},
    {"id": "marimba", "name": "Marimba", "source": "vsco2ce", "sounds": {"marimba": "sustain"}, "arts": struck("Marimba.sfz", 1.2, cap=5.0)},
    {"id": "tubular-bells", "name": "Tubular bells", "source": "vsco2ce", "sounds": {"tubular bells": "sustain"}, "arts": struck("TubularBells.sfz", 5.0, cap=10.0, tune=False)},
    {"id": "organ", "name": "Pipe organ", "source": "vsco2ce", "sounds": {"church organ": "sustain"},
     "arts": {"sustain": [part("OrganLoud.sfz", **{**HELD, "release": 0.25})]}},
]
