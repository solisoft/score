# A rectangle drawn round notes on the score (#1038), in a real browser, with
# pointer events as a mouse sends them: the rectangle shows while the drag
# goes on, the notes whose heads are in it are selected — from the middle of
# a bar to the middle of the next, on one staff or two — and Delete, Copy and
# Paste act on exactly them. Shift adds to the selection, Escape puts back
# what was selected, a click still selects its bar, a finger still scrolls.

const MARQUEE_DUO = "<<\n" + "  \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''4 a'' b'' c''' | d'''4 c''' b'' a'' }\n"
+ "  \\new Staff { e'4 f' g' a' | b'4 c'' d'' e'' | f''4 e'' d'' c'' }\n"
+ ">>\n"

const MARQUEE_WHOLE = "{ \\time 4/4 c''1 | d''1 | e''1 }\n"

# The playground opened on `source`, the score focused.
def marquee_open(source)
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { document.documentElement.style.scrollBehavior = 'auto';"
  + " const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(source)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
  evaluate("document.querySelector('.studio-sheet').scrollIntoView({ block: 'start' })")
  evaluate("document.querySelector('.studio-sheet').focus()")
end

def marquee_sel
  JSON.parse(evaluate("JSON.stringify(document.getElementById('studio').studio.sel)"))
end

def marquee_steps
  evaluate("document.getElementById('studio').studio.past.length")
end

# The pitches of lane `lane`'s events, as the model names them ("E5"), rests as "r".
def marquee_names(lane)
  JSON.parse(evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " return JSON.stringify(st.score.staves[#{lane}].events.map((ev) => ev.rest ? 'r'"
  + " : 'CDEFGAB'[ev.pitches[0].d % 7] + (Math.floor(ev.pitches[0].d / 7) + 3))); })()"))
end

# Where the head of lane `lane`'s event `index` is drawn, in the page's pixels, as a JS expression answering [x, y].
def marquee_head(lane, index)
  "(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const k = st.items.findIndex((it) => it.staff === #{lane} && it.index === #{index});"
  + " const h = st.view.items.find((it) => it.item === k).heads[0].box;"
  + " return [svg.left + (h[0] + h[2]) / 2 * scale, svg.top + ((h[1] + h[3]) / 2 - (st.view.y0 ?? 0)) * scale]; })()"
end

# The point halfway between two heads (JS expressions), moved `down` pixels.
def marquee_between(a, b, down)
  "(() => { const [p, q] = [#{a}, #{b}]; return [(p[0] + q[0]) / 2, Math.max(p[1], q[1]) + #{down}]; })()"
end

# A press at `from`, moved to `to` in steps a frame apart (JS expressions
# answering [x, y]); let go unless `hold`. `more` goes into each event.
def marquee_drag(from, to, more = "", hold = false)
  evaluate("(() => { const sheet = document.querySelector('.studio-sheet');"
  + " const [x, y] = #{from}; const [x1, y1] = #{to}; window.marquee = { x, y, x1, y1 };"
  + " const at = { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse',"
  + " clientX: x, clientY: y, #{more} };"
  + " (document.elementFromPoint(x, y) ?? sheet).dispatchEvent(new PointerEvent('pointerdown', at)); })()")
  sleep(0.15)
  for step in [0.05, 0.3, 0.7, 1]
    evaluate("(() => { const m = window.marquee;"
    + " document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent('pointermove',"
    + " { bubbles: true, cancelable: true, pointerId: 1, buttons: 1, pointerType: 'mouse',"
    + " clientX: m.x + (m.x1 - m.x) * #{step}, clientY: m.y + (m.y1 - m.y) * #{step}, #{more} })); })()")
    sleep(0.12)
  end
  marquee_release(more) unless hold
end

def marquee_release(more = "")
  evaluate("(() => { const m = window.marquee;"
  + " document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent('pointerup',"
  + " { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse',"
  + " clientX: m.x1, clientY: m.y1, #{more} })); })()")
  sleep(0.4)
end

# The rectangle as drawn: { shown, width, height }.
def marquee_band
  JSON.parse(evaluate("(() => { const band = document.querySelector('.studio-marquee');"
  + " const r = band.getBoundingClientRect();"
  + " return JSON.stringify({ shown: !band.hidden && getComputedStyle(band).display !== 'none',"
  + " width: Math.round(r.width), height: Math.round(r.height) }); })()"))
end

# From between d'' and e'' (bar 1), above the top staff.
def marquee_from_top
  marquee_between(marquee_head(0, 1), marquee_head(0, 2), -40)
end

describe("A rectangle drawn round notes (#1038)") do
  test("on one staff: shown while drawn, the notes from mid-bar to mid-bar selected; Delete clears exactly them") do
    marquee_open(MARQUEE_DUO)
    # To between a'' and b'' (bar 2), under the top staff's notes but above the lower staff.
    to = marquee_between(marquee_head(0, 5), marquee_head(0, 6), 22)
    marquee_drag(marquee_from_top(), to, "", true)
    band = marquee_band()
    assert(band["shown"], "the rectangle shows while the pointer is down")
    assert(band["width"] > 40, "as wide as the drag: #{band}")
    assert(band["height"] > 40, "as tall as the drag: #{band}")
    marquee_release()
    assert_not(marquee_band()["shown"], "let go, the rectangle goes")
    sel = marquee_sel()
    assert_eq(sel["staff"], 0)
    assert(sel["bars"].nil?, "notes, not bars")
    assert(sel["lanes"].nil?, "one staff")
    # e'' f'' | g'' a'': from the third beat of bar 1 to the second of bar 2.
    assert_eq(sel["t0"], 40320)
    assert_eq(sel["t1"], 100800)
    steps = marquee_steps()
    press("Delete")
    sleep(0.5)
    assert_eq(marquee_steps(), steps + 1)
    assert_eq(marquee_names(0), [
      "C5",
      "D5",
      "r",
      "r",
      "B5",
      "C6",
      "D6",
      "C6",
      "B5",
      "A5"
    ])
    # The lower staff as it was.
    assert_eq(marquee_names(1).length, 12)
    press("Ctrl+z")
    sleep(0.5)
    assert_eq(marquee_names(0)[2], "E5")
    assert_no_page_errors()
  end

  test("over two staves: the same span on each; Ctrl+C then Ctrl+V on bar 3 writes those notes there, as far apart") do
    marquee_open(MARQUEE_DUO)
    # From above e'' (bar 1, beat 3) to under the lower staff's c'' (bar 2, beat 2).
    to = marquee_between(marquee_head(1, 5), marquee_head(1, 6), 30)
    marquee_drag(marquee_from_top(), to)
    sel = marquee_sel()
    assert_eq(sel["lanes"], [0, 1])
    assert(sel["bars"].nil?, "notes, not bars")
    assert_contains(evaluate("document.querySelector('[data-status]').textContent"), "of 2 staves")
    lit = evaluate("document.querySelectorAll('.studio-bar-selected').length")
    assert_eq(lit, 0)
    press("Ctrl+c")
    sleep(0.4)
    assert_contains(
      evaluate("document.querySelector('[data-status]').textContent"),
      "8 notes and rests of 2 tracks copied"
    )
    # Bar 3's first note selected, and the copy pasted there.
    marquee_drag(marquee_head(0, 8), marquee_head(0, 8))
    steps = marquee_steps()
    press("Ctrl+v")
    sleep(0.6)
    assert_eq(marquee_steps(), steps + 1)
    assert_eq(marquee_names(0).slice(8, 12), [
      "E5",
      "F5",
      "G5",
      "A5"
    ])
    assert_eq(marquee_names(1).slice(8, 12), [
      "G4",
      "A4",
      "B4",
      "C5"
    ])
    # What came before as it was.
    assert_eq(marquee_names(0).slice(0, 8), [
      "C5",
      "D5",
      "E5",
      "F5",
      "G5",
      "A5",
      "B5",
      "C6"
    ])
    assert_no_page_errors()
  end

  test("dragged sideways from a note: the rectangle, not the bars; up from it, the note moves as before") do
    marquee_open(MARQUEE_DUO)
    # From e'' to past f'' at its height: e'' and f'', not bar 1.
    to = "(() => { const [x, y] = #{marquee_head(0, 3)}; return [x + 12, y - 2]; })()"
    marquee_drag(marquee_head(0, 2), to)
    sel = marquee_sel()
    assert(sel["bars"].nil?, "notes, not bars: #{sel}")
    assert_eq(sel["t0"], 40320)
    assert_eq(sel["t1"], 60480)
    # Up from a note: its pitch, one step to undo.
    steps = marquee_steps()
    up = "(() => { const [x, y] = #{marquee_head(0, 0)}; return [x, y - 12]; })()"
    marquee_drag(marquee_head(0, 0), up)
    assert_eq(marquee_steps(), steps + 1)
    assert_not(marquee_names(0)[0] == "C5", "the note moved up")
    assert_no_page_errors()
  end

  test("Shift+drag adds to the selection; Escape during a drag puts back what was selected") do
    marquee_open(MARQUEE_DUO)
    marquee_drag(marquee_head(0, 0), marquee_head(0, 0))
    assert_eq(marquee_sel()["t0"], 0)
    # Shift, a rectangle round g'' a'' (bar 2), drawn upwards from under them
    # (the selected note's palette is over the staff): from c'' to a'' selected.
    from = marquee_between(marquee_head(0, 3), marquee_head(0, 4), 22)
    to = marquee_between(marquee_head(0, 5), marquee_head(0, 6), -40)
    marquee_drag(from, to, "shiftKey: true")
    sel = marquee_sel()
    assert_eq(sel["t0"], 0)
    assert_eq(sel["t1"], 100800)
    # A new rectangle, and Escape before letting go: the selection as it was, no rectangle.
    marquee_drag(marquee_between(marquee_head(0, 6), marquee_head(0, 7), 22), from, "", true)
    assert(marquee_band()["shown"], "drawn")
    press("Escape")
    sleep(0.3)
    assert_not(marquee_band()["shown"], "Escape takes it away")
    marquee_release()
    sel = marquee_sel()
    assert_eq(sel["t0"], 0)
    assert_eq(sel["t1"], 100800)
    assert_no_page_errors()
  end

  test("a click on the empty part of a bar still selects it; a finger's drag draws no rectangle") do
    marquee_open(MARQUEE_WHOLE)
    bar = "(() => { const st = document.getElementById('studio').studio;"
    + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
    + " const scale = svg.width / st.view.width; const b = st.view.bars.find((x) => x.bar === 1);"
    + " return [svg.left + (b.box[2] - 6) * scale, svg.top + (b.staves[0] + 16 - (st.view.y0 ?? 0)) * scale]; })()"
    marquee_drag(bar, bar)
    assert_eq(marquee_sel()["bars"], [1, 1])
    # Clicked again: nothing selected.
    marquee_drag(bar, bar)
    assert(marquee_sel().nil?, "the selection taken away")
    from = "(() => { const [x, y] = #{marquee_head(0, 0)}; return [x - 30, y - 40]; })()"
    to = "(() => { const [x, y] = #{marquee_head(0, 1)}; return [x + 20, y + 30]; })()"
    marquee_drag(from, to, "pointerType: 'touch'", true)
    assert_not(marquee_band()["shown"], "no rectangle under a finger")
    marquee_release("pointerType: 'touch'")
    assert_no_page_errors()
  end
end
