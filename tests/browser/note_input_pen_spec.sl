# Note input's pen and ghost note (#398), in a real browser (soli test
# --browser): in note input, the pointer over the staves is a pen and a pale
# note follows it, on the staff's line or space under it; a click writes that
# note there, one step to undo; off the staves, or out of note input, neither
# is shown, and the mode's button wears the same pen.

const PEN_SOURCE = "\\header { title = \"Pen\" }\n{ \\clef treble \\time 4/4 c'4 d'4 e'4 f'4 | r1 }"

# The playground opened on PEN_SOURCE, the score focused.
def pen_open
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(PEN_SOURCE)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
  evaluate("document.querySelector('.studio-sheet').focus()")
end

def pen_text
  evaluate("document.querySelector('[data-source]').value")
end

# In the page: `st` the studio's state, and `page(x, y)` a point of the drawing as a point of the page.
const PEN_FRAME = "const st = document.getElementById('studio').studio;"
+ " const box = document.querySelector('.studio-svg svg').getBoundingClientRect();"
+ " const scale = box.width / st.view.width;"
+ " const page = (x, y) => JSON.stringify({ x: box.left + x * scale, y: box.top + (y - (st.view.y0 ?? 0)) * scale });"

# The page's point over bar `bar`, `along` of its width, at staff position `step` (0 the bottom line).
def pen_point(bar, along, step)
  JSON.parse(evaluate("(() => { #{PEN_FRAME}"
  + " const b = st.view.bars.find((x) => x.bar === #{bar}); const space = 8 * st.zoom;"
  + " return page(b.box[0] + #{along} * (b.box[2] - b.box[0]), b.staves[0] + 4 * space - #{step} * space / 2); })()"))
end

# A pointer event of `kind` on the score at a page point; `shift` (or `alt`) held or not.
def pen_pointer(kind, point, shift = false, alt = false)
  evaluate("document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent(#{JSON.stringify(kind)},"
  + " { clientX: #{point["x"]}, clientY: #{point["y"]}, shiftKey: #{shift}, altKey: #{alt},"
  + " pointerId: 1, bubbles: true, button: 0 }))")
  sleep(0.25)
end

# The ghost's pitch, or nil while it is hidden.
def pen_ghost
  evaluate("(() => { const g = document.querySelector('.studio-ghost');"
  + " return g && !g.hidden ? g.dataset.pitch : null; })()")
end

def pen_on?
  evaluate("document.querySelector('.studio-sheet').classList.contains('studio-pen')")
end

def pen_cursor
  evaluate("getComputedStyle(document.querySelector('.studio-sheet')).cursor")
end

describe("Note input's pen and ghost note, in a browser") do
  before_each() do
    pen_open()
  end

  test("the mode's button wears the pen, and says whether note input is on") do
    button = ".studio-toolbox [data-act='mode-input']"
    assert_selector("#{button} svg.pen-icon")
    assert_selector(".studio-dropdown-items [data-act='mode-input'] svg.pen-icon")
    assert_eq(evaluate("document.querySelector(\"#{button}\").textContent.trim()"), "Note input")
    assert_eq(evaluate("document.querySelector(\"#{button}\").getAttribute('aria-pressed')"), "false")
    press("n")
    sleep(0.3)
    assert_eq(evaluate("document.querySelector(\"#{button}\").getAttribute('aria-pressed')"), "true")
    assert_eq(
      evaluate("document.querySelector(\".studio-toolbox [data-act='mode-select']\").getAttribute('aria-pressed')"),
      "false"
    )
    press("Escape")
    sleep(0.3)
    assert_eq(evaluate("document.querySelector(\"#{button}\").getAttribute('aria-pressed')"), "false")
  end

  test("out of note input, the pointer over a staff is no pen and shows no ghost") do
    pen_pointer("pointermove", pen_point(1, 0.2, 4))
    assert_not(pen_on?())
    assert_null(pen_ghost())
    assert_not(pen_cursor().includes?("url("))
  end

  test("in note input, the pointer over a staff is a pen, and the ghost takes the line or space under it") do
    press("n")
    sleep(0.3)
    pen_pointer("pointermove", pen_point(1, 0.2, 4))
    assert(pen_on?())
    assert(pen_cursor().includes?("url("), "the pen: #{pen_cursor}")
    assert_eq(pen_ghost(), "B4")
    assert_eq(evaluate("document.querySelector('.studio-ghost').dataset.t"), "80640")
    pen_pointer("pointermove", pen_point(1, 0.2, 1))
    assert_eq(pen_ghost(), "F4")
    # Below the staff, on a ledger line: middle C, and its ledger line drawn.
    pen_pointer("pointermove", pen_point(1, 0.2, -2))
    assert_eq(pen_ghost(), "C4")
    assert_eq(evaluate("document.querySelectorAll('.studio-ghost svg line').length"), 2)
    # Further along the empty bar: its third beat.
    pen_pointer("pointermove", pen_point(1, 0.6, 4))
    assert_eq(evaluate("document.querySelector('.studio-ghost').dataset.t"), "120960")
    # Far off the staves: no ghost, no pen.
    pen_pointer("pointermove", pen_point(1, 0.2, 40))
    assert_null(pen_ghost())
    assert_not(pen_on?())
    # Back over it, then out of the sheet.
    pen_pointer("pointermove", pen_point(1, 0.2, 4))
    assert_eq(pen_ghost(), "B4")
    evaluate("document.querySelector('.studio-sheet')"
    + ".dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1 }))")
    sleep(0.25)
    assert_null(pen_ghost())
    assert_not(pen_on?())
    assert_no_page_errors()
  end

  test("a click writes the ghost's note there, one step to undo") do
    press("n")
    sleep(0.3)
    steps_before = evaluate("document.getElementById('studio').studio.past.length")
    spot = pen_point(1, 0.2, 6)
    pen_pointer("pointermove", spot)
    assert_eq(pen_ghost(), "D5")
    pen_pointer("pointerdown", spot)
    pen_pointer("pointerup", spot)
    assert_contains(pen_text(), "f'4 | d''4 r2. ")
    assert_eq(evaluate("document.getElementById('studio').studio.past.length"), steps_before + 1)
    # The cursor goes on after it, as typing a letter does.
    assert_eq(evaluate("document.getElementById('studio').studio.input.t"), 100800)
    # Another, along the dotted half rest left, with the half selected: a half, on the third beat.
    evaluate("document.querySelector(\".studio-toolbox [data-act='duration'][data-base='2']\").click()")
    sleep(0.3)
    third = pen_point(1, 0.75, 2)
    pen_pointer("pointermove", third)
    assert_eq(pen_ghost(), "G4")
    assert_eq(evaluate("document.querySelector('.studio-ghost').dataset.t"), "120960")
    pen_pointer("pointerdown", third)
    assert_contains(pen_text(), "d''4 r4 g'2")
    press("Ctrl+z")
    sleep(0.4)
    assert_contains(pen_text(), "f'4 | d''4 r2. ")
    assert_no_page_errors()
  end

  test("Shift+click moves the cursor to a note, writing nothing; off the staves a click writes nothing") do
    press("n")
    sleep(0.3)
    before = pen_text()
    # The third note's head.
    head = JSON.parse(evaluate("(() => { #{PEN_FRAME} const h = st.view.items[2].heads[0].box;"
    + " return page((h[0] + h[2]) / 2, (h[1] + h[3]) / 2); })()"))
    pen_pointer("pointermove", head, true)
    assert_null(pen_ghost())
    pen_pointer("pointerdown", head, true)
    pen_pointer("pointerup", head, true)
    assert_eq(pen_text(), before)
    assert_eq(evaluate("document.getElementById('studio').studio.input.t"), 40320)
    off = pen_point(1, 0.2, 40)
    pen_pointer("pointerdown", off)
    pen_pointer("pointerup", off)
    assert_eq(pen_text(), before)
  end

  test("Escape or N leaves note input: the pen and the ghost go") do
    press("n")
    sleep(0.3)
    spot = pen_point(1, 0.2, 4)
    pen_pointer("pointermove", spot)
    assert(pen_on?())
    assert_eq(pen_ghost(), "B4")
    press("Escape")
    sleep(0.3)
    assert_not(pen_on?())
    assert_null(pen_ghost())
    assert_not(pen_cursor().includes?("url("))
    # In again, then N: out the same way.
    press("n")
    sleep(0.3)
    pen_pointer("pointermove", spot)
    assert_eq(pen_ghost(), "B4")
    press("n")
    sleep(0.3)
    assert_not(pen_on?())
    assert_null(pen_ghost())
    # A click out of note input writes nothing.
    before = pen_text()
    pen_pointer("pointerdown", spot)
    pen_pointer("pointerup", spot)
    assert_eq(pen_text(), before)
  end

  test("with Add to the chord ticked, a click on a note adds its pitch to it; on a rest it writes a note (#422)") do
    press("n")
    sleep(0.3)
    evaluate("document.querySelector('[data-chord-mode]').click()")
    # Over the first note, on the second line: G4 joins C4.
    first = pen_point(0, 0.12, 2)
    pen_pointer("pointermove", first)
    pen_pointer("pointerdown", first)
    pen_pointer("pointerup", first)
    assert_contains(pen_text(), "<c' g'>4 d'4")
    # Again, higher: a third note to the same chord, one step to undo each.
    higher = pen_point(0, 0.12, 6)
    pen_pointer("pointerdown", higher)
    pen_pointer("pointerup", higher)
    assert_contains(pen_text(), "<c' g' d''>4 d'4")
    # On the rest of bar 2 there is nothing to add to: the note is written there.
    on_rest = pen_point(1, 0.2, 6)
    pen_pointer("pointerdown", on_rest)
    pen_pointer("pointerup", on_rest)
    assert_contains(pen_text(), "f'4 | d''4 r2.")
    press("Ctrl+z")
    sleep(0.4)
    assert_contains(pen_text(), "f'4 | r1")
    evaluate("document.querySelector('[data-chord-mode]').click()")
    assert_no_page_errors()
  end

  test("a click adds to a chord, on a pitch it has changes nothing, Alt+click writes over (#702)") do
    press("n")
    sleep(0.3)
    first = pen_point(0, 0.12, 2)
    # Box unticked: G joins C all the same.
    pen_pointer("pointermove", first)
    pen_pointer("pointerdown", first)
    pen_pointer("pointerup", first)
    assert_contains(pen_text(), "<c' g'>4 d'4")
    # On the note again (G is there already): nothing changes.
    before = pen_text()
    pen_pointer("pointerdown", first)
    pen_pointer("pointerup", first)
    assert_eq(pen_text(), before)
    # On C itself, the chord's other note: nothing changes either.
    on_c = pen_point(0, 0.12, -2)
    pen_pointer("pointerdown", on_c)
    pen_pointer("pointerup", on_c)
    assert_eq(pen_text(), before)
    # Alt+click writes over the chord: one note, the clicked pitch.
    higher = pen_point(0, 0.12, 6)
    pen_pointer("pointerdown", higher, false, true)
    pen_pointer("pointerup", higher, false, true)
    assert_contains(pen_text(), "d''4 d'4")
    assert_not(pen_text().includes?("<c' g'>"), "written over: #{pen_text}")
    assert_no_page_errors()
  end

  test("in another voice, a click on a pitch the first voice has writes that voice's note (#702)") do
    press("n")
    sleep(0.3)
    evaluate("document.querySelector(\"[data-act='voice'][data-voice='2']\").click()")
    sleep(0.4)
    # C4 is voice 1's; voice 2 has nothing there: the click writes C4 in voice 2.
    on_c = pen_point(0, 0.12, -2)
    pen_pointer("pointermove", on_c)
    pen_pointer("pointerdown", on_c)
    pen_pointer("pointerup", on_c)
    text = pen_text()
    assert_contains(text, "<< { c'4 d'4 e'4 f'4 } \\\\ { c'4 r2. } >>", "the source: #{text}")
    assert_no_page_errors()
  end

  test("with Add to the chord ticked, the letter buttons add to the note at the cursor, never over it (#422, #702)") do
    press("n")
    sleep(0.3)
    evaluate("document.querySelector('[data-chord-mode]').click()")
    ["4", "6", "1"].each do |step|
      evaluate("document.querySelector(\".studio-toolbox [data-act='letter'][data-step='#{step}']\").click()")
      sleep(0.3)
    end
    # The cursor is on C: G, B and D join it, C stays (#702; it was written over before).
    assert_contains(pen_text(), "<c' g' b' d''>4 d'4")
    evaluate("document.querySelector('[data-chord-mode]').click()")
    assert_no_page_errors()
  end

  test("with Add to the chord ticked, a letter typed on a note moved to adds to it; on a rest it writes (#702)") do
    press("n")
    sleep(0.3)
    evaluate("document.querySelector('[data-chord-mode]').click()")
    # The cursor is on C, nothing written yet: G joins C instead of replacing it.
    press("g")
    sleep(0.4)
    assert_contains(pen_text(), "<c' g'>4 d'4")
    # Moved onto D with the arrow: A joins D, C's chord stays.
    press("ArrowRight")
    sleep(0.3)
    press("a")
    sleep(0.4)
    assert_contains(pen_text(), "<c' g'>4 <d' a'>4")
    evaluate("document.querySelector('[data-chord-mode]').click()")
    assert_no_page_errors()
  end

  test("R writes a rest in note input, as 0 does, out of it none; I turns note input on and off (#423)") do
    press("n")
    sleep(0.3)
    press("r")
    sleep(0.4)
    assert_contains(pen_text(), "r4 d'4 e'4 f'4")
    assert_contains(evaluate("document.querySelector('[data-state]').textContent"), "0 or R rest")
    # Out of note input, R is the recording's: no rest is written.
    press("Escape")
    sleep(0.3)
    before = pen_text()
    press("r")
    sleep(0.4)
    assert_eq(pen_text(), before)
    # I turns note input on, and off again, as N does.
    press("i")
    sleep(0.3)
    assert(evaluate("document.getElementById('studio').studio.input.on"), "I starts note input")
    press("i")
    sleep(0.3)
    assert_not(evaluate("document.getElementById('studio').studio.input.on"), "I ends note input")
    assert_no_page_errors()
  end

  test("in note input, ← and → sound the note the cursor comes to, not the one selected before (#426)") do
    # A MIDI device to hear through: what is sent to it is kept.
    evaluate("(() => { window.sent = []; const out = { id: 'fake-out', name: 'Fake synth', state: 'connected',"
    + " send: (bytes) => window.sent.push(Array.from(bytes)) };"
    + " const access = { inputs: new Map(), outputs: new Map([['fake-out', out]]) };"
    + " Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access }); })()")
    evaluate("(() => { const box = document.querySelector('[data-play=\"output\"]'); box.value = 'find';"
    + " box.dispatchEvent(new Event('change', { bubbles: true })); })()")
    sleep(0.5)
    assert_eq(evaluate("document.querySelector('[data-play=\"output\"]').value"), "fake-out")
    heard = "window.sent.filter((m) => (m[0] & 0xf0) === 0x90 && m[2] > 0).map((m) => m[1])"
    press("n")
    sleep(0.3)
    evaluate("window.sent = []")
    # c' d' e' f': → to D4, → to E4, ← back to D4.
    ["ArrowRight", "ArrowRight", "ArrowLeft"].each do |arrow|
      press(arrow)
      sleep(0.3)
    end
    assert_eq(evaluate(heard), [
      62,
      64,
      62
    ])
    assert_no_page_errors()
  end

  test("Insert › A staff in note input adds it, says so, and the writing goes on in it (#429)") do
    press("n")
    sleep(0.3)
    evaluate("(() => { const b = document.querySelector('.studio-dropdown [data-act=\"add-staff\"]');"
    + " b.closest('details').open = true; b.click(); })()")
    sleep(0.5)
    assert_eq(evaluate("document.getElementById('studio').studio.score.staves.length"), 2)
    assert_contains(evaluate("document.querySelector('[data-status]').textContent"), "staff added")
    assert_eq(evaluate("document.getElementById('studio').studio.input.staff"), 1)
    # A letter now writes in the new staff, at its start; the first staff is as it was.
    press("g")
    sleep(0.4)
    staves = evaluate("document.getElementById('studio').studio.score.staves.map((it) => it.events[0].rest)")
    assert_eq(staves, [false, false])
    assert_contains(pen_text(), "c'4 d'4 e'4 f'4")
    assert_no_page_errors()
  end

  test("in note input, a mark goes on the note the cursor was moved to, not one selected before (#429)") do
    # A note selected first (the last of bar 1), then note input from the start.
    evaluate("(() => { const st = document.getElementById('studio').studio;"
    + " st.sel = { staff: 0, t0: 2880, t1: 2880, head: -1 }; })()")
    press("n")
    sleep(0.3)
    evaluate("(() => { const st = document.getElementById('studio').studio; st.input.t = 0; st.input.last = null; })()")
    press("ArrowRight")
    sleep(0.3)
    evaluate("document.querySelector(\".studio-toolbox [data-act='art'][data-name='staccato']\").click()")
    sleep(0.4)
    # The staccato on d', the note the cursor came to; f' as it was.
    assert_contains(pen_text(), "c'4 d'4-. e'4 f'4")
    assert_no_page_errors()
  end
end
