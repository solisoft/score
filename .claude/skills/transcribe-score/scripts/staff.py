#!/usr/bin/env python3
"""Measure the staves of a photographed score and cut labelled zooms of them.

    staff.py detect PHOTO OUTDIR [--clef 1=bass,3=bass] [--segments 4]
    staff.py pitch OUTDIR/staves.json STAFF X Y

`detect` finds every 5-line staff (following tilt and page curl strip by
strip), writes OUTDIR/staves.json, OUTDIR/overview.jpg (staves numbered) and,
per staff, zoomed crops OUTDIR/sNN_kK.jpg on which every line and space from
6 steps below the staff to 6 steps above carries its note name (natural
pitch, scientific octave: C4 = middle C = LilyPond c'). A note head is read
against those guides, never guessed.

`pitch` answers the natural pitch at a point of the ORIGINAL photo.
Needs Pillow and numpy (install them in a throwaway venv).
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

LETTERS = "CDEFGAB"
# Diatonic index of the bottom staff line: letter index + 7 * octave.
BOTTOM_LINE = {"treble": 2 + 7 * 4, "bass": 4 + 7 * 2, "alto": 3 + 7 * 3, "tenor": 1 + 7 * 3}


def name_of(diatonic):
    return f"{LETTERS[diatonic % 7]}{diatonic // 7}"


def lily_of(diatonic):
    letter = LETTERS[diatonic % 7].lower()
    octave = diatonic // 7 - 3
    return letter + ("'" * octave if octave > 0 else "," * -octave)


def dark_mask(gray):
    # Paper is the bright majority; ink is well below it.
    paper = np.percentile(gray, 70)
    return gray < paper * 0.62


def line_rows(profile, max_thickness):
    """Centres of runs of rows dense enough to be a staff line."""
    rows = np.where(profile > 0.45)[0]
    centres = []
    if rows.size == 0:
        return centres
    start = prev = rows[0]
    for r in list(rows[1:]) + [None]:
        if r is not None and r == prev + 1:
            prev = r
            continue
        if prev - start + 1 <= max_thickness:
            centres.append((start + prev) / 2.0)
        if r is not None:
            start = prev = r
    return centres


def five_line_groups(centres):
    """Non-overlapping 5-line staves among line centres -> [(top, spacing)].

    A staff is accepted with 4 of its 5 lines (a beam or a note head often
    hides one in a narrow strip); top and spacing are a least-squares fit of
    the lines found.
    """
    n = len(centres)
    candidates = []
    for i in range(n):
        for j in range(i + 1, n):
            for steps in range(1, 5):
                spacing = (centres[j] - centres[i]) / steps
                if not 6 <= spacing <= 80:
                    continue
                for first in range(0, 5 - steps):
                    top = centres[i] - first * spacing
                    matched = []
                    for k in range(5):
                        want = top + k * spacing
                        m = min(range(n), key=lambda q: abs(centres[q] - want))
                        if abs(centres[m] - want) <= 0.2 * spacing:
                            matched.append((k, m))
                    if len(matched) < 4:
                        continue
                    ks = np.array([k for k, _ in matched], dtype=float)
                    ys = np.array([centres[m] for _, m in matched])
                    fit_sp, fit_top = np.polyfit(ks, ys, 1)
                    residual = float(np.abs(ys - (fit_top + fit_sp * ks)).mean())
                    candidates.append((-len(matched), residual, fit_top, fit_sp, {m for _, m in matched}))
    candidates.sort(key=lambda c: (c[0], c[1]))
    groups, taken = [], []
    for _, _, top, spacing, members in candidates:
        if any(abs(top - t) < 4.5 * s for t, s in taken):
            continue
        taken.append((top, spacing))
        groups.append((float(top), float(spacing)))
    return sorted(groups)


def detect(photo, outdir, clefs, segments):
    os.makedirs(outdir, exist_ok=True)
    image = Image.open(photo).convert("RGB")
    gray = np.asarray(image.convert("L"), dtype=np.float32)
    height, width = gray.shape
    ink = dark_mask(gray)

    strips = 64
    strip_w = width // strips
    detections = []  # (x_centre, top, spacing)
    for s in range(strips):
        x0, x1 = s * strip_w, (s + 1) * strip_w
        block = ink[:, x0:x1]
        if block.mean() > 0.35:  # table edge, shadow: not paper
            continue
        profile = block.mean(axis=1)
        for top, spacing in five_line_groups(line_rows(profile, max_thickness=14)):
            detections.append(((x0 + x1) / 2.0, top, spacing))
    if not detections:
        sys.exit("no staff found: is the photo sharp, lit and roughly straight?")

    spacing_all = float(np.median([d[2] for d in detections]))
    # Track staves strip by strip, from the strip with the most staves outward.
    by_strip = {}
    for x, top, sp in detections:
        if abs(sp - spacing_all) <= 0.25 * spacing_all:
            by_strip.setdefault(x, []).append((top, sp))
    # Chain detections left to right: a staff drifts by tilt, never by a
    # whole staff gap, so the nearest chain end within 1.5 spacings is it.
    chains = []
    for x in sorted(by_strip):
        for top, sp in by_strip[x]:
            best, gap = None, None
            for chain in chains:
                last = chain[-1]
                if last[0] >= x:
                    continue
                slope = (chain[-1][1] - chain[0][1]) / (chain[-1][0] - chain[0][0]) if len(chain) > 1 else 0.0
                d = abs(last[1] + slope * (x - last[0]) - top)
                if d < 1.5 * spacing_all and (gap is None or d < gap):
                    best, gap = chain, d
            if best is None:
                chains.append([(x, top, sp)])
            else:
                best.append((x, top, sp))
    # Rejoin chains of one staff split by a gap (a long rest, a title).
    chains.sort(key=lambda c: c[0][0])
    staves = []
    for chain in chains:
        home = None
        for staff in staves:
            if staff[-1][0] < chain[0][0] and abs(staff[-1][1] - chain[0][1]) < 1.5 * spacing_all:
                home = staff
                break
        if home is None:
            staves.append(list(chain))
        else:
            home.extend(chain)

    # A false staff (4 lines borrowed from a real one plus a beam) overlaps a
    # real one: keep, of two overlapping staves, the one seen in more strips.
    staves = [st for st in staves if len(st) >= 3]
    staves.sort(key=len, reverse=True)
    kept = []
    for staff in staves:
        mid = np.median([p[1] for p in staff])
        if all(abs(mid - np.median([p[1] for p in other])) > 5 * spacing_all for other in kept):
            kept.append(staff)
    page_x0 = min(min(p[0] for p in st) for st in kept) - strip_w / 2
    page_x1 = max(max(p[0] for p in st) for st in kept) + strip_w / 2

    result = []
    for staff in sorted(kept, key=lambda st: np.median([p[1] for p in st])):
        staff.sort()
        pts = np.array(staff, dtype=float)  # x, top, spacing per strip
        # Drop strips whose top is off the local trend (a group shifted by a
        # beam), then follow the measured points; no global curve, so a
        # bend at one end does not tilt the other.
        keep = np.ones(len(pts), dtype=bool)
        for i in range(len(pts)):
            near = [j for j in range(max(0, i - 3), min(len(pts), i + 4)) if j != i]
            if len(near) >= 2:
                local = np.median([pts[j][1] + (pts[i][0] - pts[j][0]) * _slope(pts, j) for j in near])
                keep[i] = abs(pts[i][1] - local) < 0.35 * spacing_all
        pts = pts[keep]
        result.append({
            "x0": float(page_x0), "x1": float(page_x1),
            "seen_x0": float(pts[0][0]), "seen_x1": float(pts[-1][0]), "strips_seen": int(len(pts)),
            "pts": pts.round(2).tolist(),
        })
    for number, staff in enumerate(result, 1):
        staff["number"] = number
        staff["clef"] = clefs.get(number, "treble")

    with open(os.path.join(outdir, "staves.json"), "w") as f:
        json.dump({"photo": os.path.abspath(photo), "width": width, "height": height,
                   "staves": result}, f, indent=1)

    font = _font(max(14, int(spacing_all * 0.55)))
    overview = image.copy()
    draw = ImageDraw.Draw(overview)
    for staff in result:
        y = _top(staff, staff["x0"])
        draw.text((max(0, staff["x0"] - 3 * spacing_all), y), str(staff["number"]), fill=(220, 0, 0), font=_font(int(spacing_all * 2)))
        for x in np.linspace(staff["x0"], staff["x1"], 60):
            for k in range(5):
                yy = _top(staff, x) + k * _spacing(staff, x)
                draw.point((x, yy), fill=(255, 0, 0))
    overview.thumbnail((1800, 1800))
    overview.save(os.path.join(outdir, "overview.jpg"), quality=85)

    lines = []
    for staff in result:
        staff["heads"] = find_heads(ink, staff)
        _crops(image, staff, segments, outdir, font)
        lines.append(f"staff {staff['number']} ({staff['clef']}):")
        for head in staff["heads"]:
            doubt = "  <- between two positions, check" if head["off"] > 0.3 else ""
            lines.append(f"  x {head['x']:5.0f}  {head['name']:4s} ({head['lily']}){doubt}")
    with open(os.path.join(outdir, "staves.json"), "w") as f:
        json.dump({"photo": os.path.abspath(photo), "width": width, "height": height,
                   "staves": result}, f, indent=1)
    with open(os.path.join(outdir, "heads.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{len(result)} staves, line spacing ~{spacing_all:.1f}px -> {outdir}")
    for staff in result:
        print(f"  staff {staff['number']:2d} ({staff['clef']}): x {staff['x0']:.0f}-{staff['x1']:.0f}, "
              f"top y ~{_top(staff, (staff['x0'] + staff['x1']) / 2):.0f}, {len(staff['heads'])} filled heads")


def _slope(pts, j):
    """Local slope of the staff top around point j (global trend if alone)."""
    lo, hi = max(0, j - 2), min(len(pts) - 1, j + 2)
    if hi == lo:
        return 0.0
    return float(np.polyfit(pts[lo:hi + 1, 0], pts[lo:hi + 1, 1], 1)[0])


def _follow(staff, x, column):
    """Value of a measured column (1 = top, 2 = spacing) at x: interpolated
    between strips, extended straight from the last few strips beyond them."""
    pts = np.asarray(staff["pts"])
    xs, vs = pts[:, 0], pts[:, column]
    if len(xs) == 1:
        return float(vs[0])
    if x < xs[0] or x > xs[-1]:
        end = pts[:4] if x < xs[0] else pts[-4:]
        slope, intercept = np.polyfit(end[:, 0], end[:, column], 1)
        return float(slope * x + intercept)
    return float(np.interp(x, xs, vs))


def _top(staff, x):
    return _follow(staff, x, 1)


def _spacing(staff, x):
    return _follow(staff, x, 2)


def _font(size):
    for path in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                 "/System/Library/Fonts/Helvetica.ttc",
                 "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _y_of_step(staff, x, step):
    """y of diatonic step `step` above the bottom line (0 = bottom line)."""
    return _top(staff, x) + (4 - step / 2.0) * _spacing(staff, x)


def _disk_offsets(radius):
    r = int(radius)
    return [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if dy * dy + dx * dx <= radius * radius]


def _morph(mask, offsets, erode):
    r = max(max(abs(dy), abs(dx)) for dy, dx in offsets)
    padded = np.pad(mask, r, constant_values=False)
    h, w = mask.shape
    out = np.ones_like(mask) if erode else np.zeros_like(mask)
    for dy, dx in offsets:
        window = padded[r + dy:r + dy + h, r + dx:r + dx + w]
        out = (out & window) if erode else (out | window)
    return out


def _components(mask):
    """Connected components of a boolean mask -> list of (ys, xs) arrays."""
    seen = np.zeros_like(mask)
    found = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        stack, ys, xs = [(y0, x0)], [], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            ys.append(y)
            xs.append(x)
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        found.append((np.array(ys), np.array(xs)))
    return found


def find_heads(ink, staff):
    """Filled note heads of a staff, measured: [{x, y, step, name, lily, off}].

    An opening by a disk of ~0.6 line spacing keeps solid blobs (filled
    heads) and removes staff lines, stems, beams and thin text. Hollow heads
    (half and whole notes) are NOT found: read those against the guides.
    `off` is how far the centre sits from the named position, in steps
    (0 = dead on, 0.5 = exactly between two): above 0.3, check by eye.
    """
    sp = _spacing(staff, (staff["x0"] + staff["x1"]) / 2)
    x0, x1 = int(staff["x0"]), int(staff["x1"])
    tops = [_top(staff, x) for x in (x0, x1)]
    y0 = max(0, int(min(tops) - 3.5 * sp))
    y1 = min(ink.shape[0], int(max(tops) + 7.5 * sp))
    region = ink[y0:y1, x0:x1]
    opened = _morph(_morph(region, _disk_offsets(0.3 * sp), True), _disk_offsets(0.3 * sp), False)
    heads = []
    bottom = BOTTOM_LINE[staff["clef"]]
    for ys, xs in _components(opened):
        h = ys.max() - ys.min() + 1
        w = xs.max() - xs.min() + 1
        if not (0.6 * sp <= h <= 1.5 * sp and 0.8 * sp <= w <= 2.2 * sp):
            continue
        if ys.size < 0.45 * h * w:  # not solid: a letter, a clef curl
            continue
        cx, cy = x0 + xs.mean(), y0 + ys.mean()
        raw = (_top(staff, cx) + 4 * _spacing(staff, cx) - cy) / (_spacing(staff, cx) / 2)
        step = int(round(raw))
        if not -7 <= step <= 15:
            continue
        diatonic = bottom + step
        heads.append({"x": float(cx), "y": float(cy), "step": step, "name": name_of(diatonic),
                      "lily": lily_of(diatonic), "off": round(abs(raw - step), 2)})
    heads.sort(key=lambda hd: hd["x"])
    return heads


def _crops(image, staff, segments, outdir, font):
    width = image.width
    x0 = max(0, staff["x0"] - 0.6 * _spacing(staff, staff["x0"]) * 4)
    x1 = min(width, staff["x1"] + 4)
    span = (x1 - x0) / segments
    bottom = BOTTOM_LINE[staff["clef"]]
    for k in range(segments):
        cx0 = int(max(0, x0 + k * span - 0.08 * span))
        cx1 = int(min(width, x0 + (k + 1) * span + 0.08 * span))
        sp = _spacing(staff, (cx0 + cx1) / 2)
        top = min(_y_of_step(staff, cx0, 12), _y_of_step(staff, cx1, 12)) - 2.5 * sp
        low = max(_y_of_step(staff, cx0, -12), _y_of_step(staff, cx1, -12)) + 2.5 * sp
        crop = image.crop((cx0, int(max(0, top)), cx1, int(min(image.height, low)))).convert("RGBA")
        scale = 1500 / crop.width
        crop = crop.resize((1500, int(crop.height * scale)), Image.LANCZOS)
        layer = Image.new("RGBA", crop.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        oy = int(max(0, top))
        for step in range(-12, 13):
            is_line = step % 2 == 0
            on_staff = 0 <= step <= 8
            colour = (230, 0, 0, 110) if is_line else (0, 90, 230, 90)
            if not on_staff and is_line:
                colour = (230, 120, 0, 110)  # ledger-line positions
            pts = []
            for x in np.linspace(cx0, cx1, 40):
                pts.append(((x - cx0) * scale, (_y_of_step(staff, x, step) - oy) * scale))
            draw.line(pts, fill=colour, width=1)
            label = name_of(bottom + step)
            for lx in (2, crop.width - 34):
                ly = pts[0][1] if lx == 2 else pts[-1][1]
                draw.text((lx, ly - 8), label, fill=colour[:3] + (255,), font=font)
        # x ruler in ORIGINAL photo pixels, for `pitch` and for talking about positions.
        for x in range((cx0 // 50 + 1) * 50, cx1, 50):
            sx = (x - cx0) * scale
            draw.line([(sx, 0), (sx, 10 if x % 100 else 22)], fill=(0, 150, 0, 255), width=2)
            if x % 100 == 0:
                draw.text((sx + 3, 4), str(x), fill=(0, 130, 0, 255), font=font)
        # Measured filled heads: a ring on the head, its pitch beside it.
        for head in staff.get("heads", []):
            if not cx0 <= head["x"] <= cx1:
                continue
            hx, hy = (head["x"] - cx0) * scale, (head["y"] - oy) * scale
            ring = 0.6 * sp * scale
            doubt = head["off"] > 0.3
            colour = (255, 0, 200, 255) if doubt else (0, 160, 60, 255)
            draw.ellipse([hx - ring, hy - ring, hx + ring, hy + ring], outline=colour, width=2)
            draw.text((hx - ring, hy + ring + 1), head["name"] + ("?" if doubt else ""), fill=colour, font=font)
        out = Image.alpha_composite(crop, layer).convert("RGB")
        out.save(os.path.join(outdir, f"s{staff['number']:02d}_k{k + 1}.jpg"), quality=88)


def pitch(json_path, number, x, y):
    data = json.load(open(json_path))
    staff = next(s for s in data["staves"] if s["number"] == number)
    sp = _spacing(staff, x)
    step = round((_top(staff, x) + 4 * sp - y) / (sp / 2))
    diatonic = BOTTOM_LINE[staff["clef"]] + step
    print(f"{name_of(diatonic)}  (lilypond {lily_of(diatonic)}, step {step} above bottom line)")


def main(argv):
    if len(argv) >= 3 and argv[0] == "detect":
        clefs, segments = {}, 4
        rest = argv[3:]
        for i, arg in enumerate(rest):
            if arg == "--clef":
                for pair in rest[i + 1].split(","):
                    n, c = pair.split("=")
                    clefs[int(n)] = c
            if arg == "--segments":
                segments = int(rest[i + 1])
        detect(argv[1], argv[2], clefs, segments)
    elif len(argv) == 5 and argv[0] == "pitch":
        pitch(argv[1], int(argv[2]), float(argv[3]), float(argv[4]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
