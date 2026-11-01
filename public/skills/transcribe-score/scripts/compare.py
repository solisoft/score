#!/usr/bin/env python3
"""Second read of the pitches: the filled heads written in a LilyPond source
against the heads staff.py measured on the photo.

    python compare.py source.ly heads.txt [-v]

The source uses absolute pitches and is split by `% system N` comments, N
being the staff number staff.py gave. Half and whole notes are left out:
staff.py does not measure hollow heads.

The two sequences are aligned in order (an edit-distance alignment):
  - a head staff.py was sure of must carry the written pitch;
  - a head it marked "check" agrees with any written pitch (it is only
    evidence that a head is there);
  - a measured blob left over is noise as a rule (the clef, the key and time
    signatures, rests, flags, letters, slurs): counted, listed with -v;
  - a written note left over is suspect.

For every system it prints:
  DIFFERENT  #k written X, measured Y at x N   -> settle it on the photo
  WRONG RUN  #a-#b: several notes in a row differ  -> a run written from the
             wrong note (C B A G … for E D C B …); settle it on the photo
  NOT SEEN   #k written X, no head measured there  -> look at it
With -v also every note that agrees and every leftover blob, with its x.
"""
import re
import sys

MISMATCH = 1.0       # a sure head with another pitch
WRITTEN_GAP = 2.0    # a written note with no head: rare, so expensive
MEASURED_GAP = 0.6   # a blob with no written note: common (clef, rests…)
UNSURE_MATCH = 0.2   # a "check" head taken as the written note


def measured_heads(text):
    """staff number -> [(x, name, sure)]"""
    staves = {}
    for block in re.split(r"^staff\s+", text, flags=re.M)[1:]:
        number = int(block.split()[0])
        staves[number] = [
            (int(m.group(1)), m.group(2), "check" not in m.group(0))
            for m in re.finditer(r"x\s+(\d+)\s+([A-G]\d)[^\n]*", block)
        ]
    return staves


def written_heads(body, duration):
    """Filled heads of one system as natural names (E5), and the duration
    still running at its end (LilyPond carries it from note to note)."""
    body = re.sub(r"%[^\n]*", " ", body)
    body = re.sub(r"\\key\s+[a-g](?:is|es)?\s+\\[a-z]+", " ", body)
    body = re.sub(r"[\^_-]?\"[^\"]*\"", " ", body)
    body = re.sub(r"\\[a-zA-Z]+", " ", body)
    heads = []
    for m in re.finditer(r"(?<![a-zA-Z])([a-grR])(?:is|es)?('*)(,*)(\d+)?(\.*)", body):
        letter, up, down, digits = m.group(1), len(m.group(2)), len(m.group(3)), m.group(4)
        if digits:
            duration = int(digits)
        if letter in "rR" or duration <= 2:
            continue
        heads.append(f"{letter.upper()}{3 + up - down}")
    return heads, duration


def align(written, measured):
    """Pairs (i, j) of an optimal alignment; i or j is None for a gap."""
    n, m = len(written), len(measured)
    cost = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        cost[i][0] = i * WRITTEN_GAP
    for j in range(1, m + 1):
        cost[0][j] = j * MEASURED_GAP
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            _, name, sure = measured[j - 1]
            pair = (0.0 if name == written[i - 1] else MISMATCH) if sure else UNSURE_MATCH
            cost[i][j] = min(cost[i - 1][j - 1] + pair, cost[i - 1][j] + WRITTEN_GAP, cost[i][j - 1] + MEASURED_GAP)
    pairs, i, j = [], n, m
    while i or j:
        if i and j:
            _, name, sure = measured[j - 1]
            pair = (0.0 if name == written[i - 1] else MISMATCH) if sure else UNSURE_MATCH
            if abs(cost[i][j] - (cost[i - 1][j - 1] + pair)) < 1e-9:
                pairs.append((i - 1, j - 1))
                i, j = i - 1, j - 1
                continue
        if i and abs(cost[i][j] - (cost[i - 1][j] + WRITTEN_GAP)) < 1e-9:
            pairs.append((i - 1, None))
            i -= 1
        else:
            pairs.append((None, j - 1))
            j -= 1
    return pairs[::-1]


def main():
    args = [a for a in sys.argv[1:] if a != "-v"]
    verbose = "-v" in sys.argv
    if len(args) != 2:
        sys.exit(__doc__)
    source, heads = open(args[0]).read(), open(args[1]).read()
    staves = measured_heads(heads)
    parts = re.split(r"%\s*system\s+(\d+)[^\n]*\n", source)
    if len(parts) < 3:
        sys.exit("no `% system N` comment in the source: split it by system first")
    duration = 4
    flags = 0
    for k in range(1, len(parts), 2):
        number = int(parts[k])
        written, duration = written_heads(parts[k + 1], duration)
        measured = staves.get(number, [])
        pairs = align(written, measured)
        different, not_seen, leftovers, agree = [], [], [], 0
        for i, j in pairs:
            if i is None:
                leftovers.append(measured[j])
            elif j is None:
                not_seen.append(i)
            else:
                x, name, sure = measured[j]
                if sure and name != written[i]:
                    different.append((i, name, x))
                else:
                    agree += 1
                    if verbose:
                        print(f"    #{i + 1:>3} {written[i]:<3} x {x}{'' if sure else ' (check)'}")
        print(f"system {number}: {len(written)} filled heads written, {agree} agree with the photo")
        # Consecutive differences: a run written from the wrong note.
        runs, run = [], []
        for d in different:
            if run and d[0] != run[-1][0] + 1:
                runs.append(run)
                run = []
            run.append(d)
        if run:
            runs.append(run)
        for run in runs:
            flags += 1
            if len(run) >= 2:
                print(f"  WRONG RUN #{run[0][0] + 1}-#{run[-1][0] + 1}: written "
                      f"{[written[i] for i, _, _ in run]}, measured {[n for _, n, _ in run]} "
                      f"at x {[x for _, _, x in run]}")
            else:
                i, name, x = run[0]
                print(f"  DIFFERENT #{i + 1} written {written[i]}, measured {name} at x {x}")
        for i in not_seen:
            flags += 1
            print(f"  NOT SEEN #{i + 1} written {written[i]}: no head measured there")
        if verbose and leftovers:
            print("  leftover blobs (clef, rests, flags, letters…): "
                  + ", ".join(f"{n}@{x}{'' if s else '?'}" for x, n, s in leftovers))
        elif leftovers:
            print(f"  ({len(leftovers)} leftover blobs: clef, rests, flags, letters… -v lists them)")
    print(f"\n{flags} place(s) to settle on the photo")


if __name__ == "__main__":
    main()
