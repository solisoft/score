#!/usr/bin/env python3
"""Count the markings a LilyPond source carries, system by system, to check
them against the inventory read on the original.

    python marks.py source.ly [inventory.txt]

The source is split by `% system N` comments. For each system it counts:
  dyn    dynamics (\\p \\f \\fp \\sfz ...)     <  crescendo hairpins (\\<)
  >      diminuendo hairpins (\\>)           (  slurs
  ~      ties                               acc stacc ten marc  accents, staccatos,
  ferm   fermatas                                   tenutos, marcatos
  txt    text over/under the staff (^"D.C.", ^"Trio", ^"al Coda", _"dolce")

With an inventory, each line `N: dyn=2 <=1 >=1 (=2 ...` (the counts read on
system N of the original, written BEFORE looking at the source), every count
that differs is printed: re-read that system on the photo. Keys left out of a
line are not compared.
"""
import re
import sys

DYNAMICS = r"\\(?:ppp|pp|p|mp|mf|f|ff|fff|fp|sf|sfz|sff|sfp|fz|rfz|rf)(?![a-zA-Z])"
KINDS = {
    "dyn": DYNAMICS,
    "<": r"\\<",
    ">": r"\\>",
    "(": r"(?<!\\)\(",
    "~": r"~",
    "acc": r"->|-\\accent",
    "stacc": r"-\.|-\\staccato",
    "ten": r"--|-\\tenuto",
    "marc": r"-\^|-\\marcato",
    "ferm": r"\\fermata",
    "txt": r"[\^_]\"",
}


def counts(body):
    body = re.sub(r"%[^\n]*", " ", body)
    return {kind: len(re.findall(rx, body)) for kind, rx in KINDS.items()}


def main():
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    source = open(sys.argv[1]).read()
    parts = re.split(r"%\s*system\s+(\d+)[^\n]*\n", source)
    if len(parts) < 3:
        sys.exit("no `% system N` comment in the source: split it by system first")
    table = {int(parts[i]): counts(parts[i + 1]) for i in range(1, len(parts), 2)}
    print("system " + " ".join(f"{k:>5}" for k in KINDS))
    for n, c in table.items():
        print(f"{n:>6} " + " ".join(f"{c[k]:>5}" for k in KINDS))
    if len(sys.argv) == 3:
        mismatches = 0
        for line in open(sys.argv[2]):
            m = re.match(r"\s*(\d+)\s*:(.*)", line)
            if not m:
                continue
            n = int(m.group(1))
            for key, value in re.findall(r"(\S+?)=(\d+)", m.group(2)):
                have = table.get(n, {}).get(key)
                if have is None:
                    print(f"system {n}: unknown key {key!r}")
                elif have != int(value):
                    mismatches += 1
                    print(f"system {n}: {key} read {value} on the original, {have} in the source")
        print(f"\n{mismatches} count(s) differ" if mismatches else "\nevery count matches the inventory")


if __name__ == "__main__":
    main()
