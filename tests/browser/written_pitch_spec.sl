# Writing at written pitch (#1023), in a real browser: with View ▸ Written
# pitch on, a B♭ clarinet's notes are typed, clicked and changed as its
# player reads them — the letter D writes the C it sounds, the ghost note
# shows the written line, a sharp is the written one — and the text keeps
# them as they sound. Concert pitch again, the same letter writes itself.

const WP_SOURCE = "\\header { title = \"Clarinet\" }\n"
+ "\\new Staff \\with { instrumentName = \"Clarinet in B♭\" midiInstrument = \"clarinet\" }"
+ " { \\clef treble \\time 4/4 c''4 r2. | r1 }"

# The playground opened on WP_SOURCE, the score focused.
def wp_open
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(WP_SOURCE)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
  evaluate("document.querySelector('.studio-sheet').focus()")
end

def wp_text
  evaluate("document.querySelector('[data-source]').value")
end

# View ▸ Written pitch, as the menu's item does.
def wp_written
  evaluate("document.querySelector('.studio-dropdown-items [data-act=\"written\"]').click()")
  sleep(0.4)
  evaluate("document.querySelector('.studio-sheet').focus()")
end

def wp_status
  evaluate("document.querySelector('[data-status]')?.textContent ?? ''")
end

# The page's point over bar `bar`, `along` of its width, at staff position `step` (0 the bottom line).
def wp_point(bar, along, step)
  JSON.parse(evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " const box = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = box.width / st.view.width;"
  + " const b = st.view.bars.find((x) => x.bar === #{bar}); const space = 8 * st.zoom;"
  + " const x = b.box[0] + #{along} * (b.box[2] - b.box[0]); const y = b.staves[0] + 4 * space - #{step} * space / 2;"
  + " return JSON.stringify({ x: box.left + x * scale, y: box.top + (y - (st.view.y0 ?? 0)) * scale }); })()"))
end

def wp_pointer(kind, point)
  evaluate("document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent(#{JSON.stringify(kind)},"
  + " { clientX: #{point["x"]}, clientY: #{point["y"]}, pointerId: 1, bubbles: true, button: 0 }))")
  sleep(0.25)
end

def wp_ghost
  evaluate("(() => { const g = document.querySelector('.studio-ghost');"
  + " return g && !g.hidden ? g.dataset.pitch : null; })()")
end

describe("Writing at written pitch, in a browser") do
  before_each() do
    wp_open()
  end

  test("a letter typed at written pitch is stored as it sounds, one step to undo") do
    wp_written()
    assert_not(wp_status().includes?("For reading"), wp_status())
    steps_before = evaluate("document.getElementById('studio').studio.past.length")
    press("n")
    sleep(0.3)
    # The cursor on the second bar: written D sounds C.
    evaluate("(() => { const st = document.getElementById('studio').studio; st.input.t = 161280; })()")
    press("d")
    sleep(0.4)
    assert_contains(wp_text(), "| c''4 r2.")
    assert_eq(evaluate("document.getElementById('studio').studio.past.length"), steps_before + 1)
    # The drawing is at written pitch still: a D on the staff.
    assert(evaluate("document.getElementById('studio').studio.written"))
    press("Ctrl+z")
    sleep(0.4)
    assert_contains(wp_text(), "| r1")
    assert_no_page_errors()
  end

  test("the ghost note shows the written line, and a click writes the note it sounds") do
    wp_written()
    press("n")
    sleep(0.3)
    # The middle line: written B4, sounding A4.
    spot = wp_point(1, 0.2, 4)
    wp_pointer("pointermove", spot)
    assert_eq(wp_ghost(), "B4")
    wp_pointer("pointerdown", spot)
    wp_pointer("pointerup", spot)
    assert_contains(wp_text(), "| a'4 r2.")
    assert_no_page_errors()
  end

  test("a sharp set at written pitch, and concert pitch again writes as it sounds") do
    wp_written()
    # The first note, written D5: made sharp, it is written D♯5 — C♯5 as it sounds.
    evaluate("document.getElementById('studio').studio.sel = { staff: 0, t0: 0, t1: 0, head: -1 }")
    evaluate("document.querySelector('[data-act=\"alter\"][data-alter=\"1\"]').click()")
    sleep(0.4)
    assert_contains(wp_text(), "cis''4 r2.")
    # Concert pitch: the letter is the sound.
    wp_written()
    press("n")
    sleep(0.3)
    evaluate("(() => { const st = document.getElementById('studio').studio; st.input.t = 161280; })()")
    press("d")
    sleep(0.4)
    assert_contains(wp_text(), "| d''4 r2.")
    assert_no_page_errors()
  end
end
