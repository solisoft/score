#!/usr/bin/env python3
"""Close-ups of note heads side by side, to settle a pitch on the photo.

    python tiles.py photo.jpg Y0 Y1 out.png [--width W] [--refs N] X [X ...]

Y0..Y1 is a band of the photo holding the staff (its top line from
heads.txt / staves.json, minus ~30 px, to its bottom line plus ~30 px); each X
is a head's x on the photo (heads.txt, the green ruler). Every head gets a
tile W px wide (default 80; widen it when a head sits off-centre, merged with
its stem), enlarged 3 times, its x printed under it. The first N tiles
(--refs, default 1) are labelled REF.

Put first one or two heads whose pitch is certain, in the same system (a
`d''` that starts a run, the note after a clear accidental): on a curved page
the guides of the zooms drift, and a head is named by comparing it with its
neighbour on the same lines, not with a guide.
"""
import sys

from PIL import Image, ImageDraw


def main():
    args = sys.argv[1:]
    width, refs = 80, 1
    for flag in ("--width", "--refs"):
        if flag in args:
            k = args.index(flag)
            value = int(args[k + 1])
            del args[k:k + 2]
            if flag == "--width":
                width = value
            else:
                refs = value
    if len(args) < 5:
        sys.exit(__doc__)
    photo = Image.open(args[0])
    top, bottom = int(args[1]), int(args[2])
    xs = [int(v) for v in args[4:]]
    height, tile_w = (bottom - top) * 3, width * 3
    out = Image.new("RGB", (len(xs) * tile_w, height + 30), "white")
    draw = ImageDraw.Draw(out)
    for i, x in enumerate(xs):
        tile = photo.crop((x - width // 2, top, x + width // 2, bottom)).resize((tile_w, height))
        out.paste(tile, (i * tile_w, 0))
        draw.line([(i * tile_w, 0), (i * tile_w, height)], fill="red")
        label = f"REF {x}" if i < refs else str(x)
        draw.text((i * tile_w + 10, height + 8), label, fill="blue" if i < refs else "red")
    out.save(args[3])
    print(args[3])


if __name__ == "__main__":
    main()
