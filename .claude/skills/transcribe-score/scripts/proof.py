#!/usr/bin/env python3
"""Proof page: each original system above the LilyPond written for it.

    proof.py STAVES_JSON SOURCE.ly OUT.html

STAVES_JSON comes from `staff.py detect`; the source marks each system with a
`% system N` comment line. The page is self-contained (images inlined).
"""
import base64
import html
import io
import json
import os
import re
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from staff import _spacing, _top  # noqa: E402


def system_snippets(source):
    snippets, current = {}, None
    for line in source.splitlines():
        found = re.match(r"\s*%\s*system\s+(\d+)", line)
        if found:
            current = int(found.group(1))
            snippets[current] = [line.strip()]
        elif current is not None:
            snippets[current].append(line.rstrip())
    return {n: "\n".join(lines).strip() for n, lines in snippets.items()}


def strip_image(image, staff):
    spacing = _spacing(staff, (staff["x0"] + staff["x1"]) / 2)
    tops = [_top(staff, x) for x in (staff["x0"], staff["x1"])]
    y0 = max(0, int(min(tops) - 5 * spacing))
    y1 = min(image.height, int(max(tops) + 9 * spacing))
    x0 = max(0, int(staff["x0"] - 3 * spacing))
    crop = image.crop((x0, y0, min(image.width, int(staff["x1"] + spacing)), y1))
    crop.thumbnail((1600, 400))
    buffer = io.BytesIO()
    crop.convert("RGB").save(buffer, "JPEG", quality=80)
    return base64.b64encode(buffer.getvalue()).decode()


def main(argv):
    if len(argv) != 3:
        sys.exit(__doc__)
    data = json.load(open(argv[0]))
    source = open(argv[1]).read()
    image = Image.open(data["photo"])
    snippets = system_snippets(source)
    title = re.search(r'title\s*=\s*"([^"]*)"', source)
    title = title.group(1) if title else "Transcription"

    parts = []
    for staff in data["staves"]:
        number = staff["number"]
        code = snippets.get(number, f"(no `% system {number}` comment in the source)")
        parts.append(
            f'<section><h2>System {number}</h2>'
            f'<img alt="Original, system {number}" src="data:image/jpeg;base64,{strip_image(image, staff)}">'
            f'<pre>{html.escape(code)}</pre></section>'
        )
    page = f"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} — épreuve</title>
<style>
:root {{ --bg: #faf9f6; --fg: #1d1d1b; --muted: #6b6a66; --line: #dddbd4; --code: #f0eee8; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg: #1b1b1a; --fg: #eceae4; --muted: #a09e97; --line: #3a3936; --code: #262624; }} }}
:root[data-theme="dark"] {{ --bg: #1b1b1a; --fg: #eceae4; --muted: #a09e97; --line: #3a3936; --code: #262624; }}
body {{ background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 24px 16px; }}
h1 {{ font-size: 1.5rem; margin: 0 0 4px; }}
p.lead {{ color: var(--muted); margin: 0 0 24px; }}
section {{ border-top: 1px solid var(--line); padding: 16px 0; }}
h2 {{ font-size: 1rem; margin: 0 0 8px; color: var(--muted); }}
img {{ width: 100%; height: auto; background: #fff; border-radius: 4px; }}
pre {{ background: var(--code); padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 13px; white-space: pre-wrap; }}
</style></head><body>
<h1>{html.escape(title)}</h1>
<p class="lead">Chaque ligne de l'original, avec dessous ce qui a été transcrit pour elle. À comparer mesure par mesure.</p>
{''.join(parts)}
</body></html>"""
    open(argv[2], "w").write(page)
    print(f"proof: {argv[2]} ({len(data['staves'])} systems)")


if __name__ == "__main__":
    main(sys.argv[1:])
