# The editor's tools on many notes at once (#1024), in a real browser (soli
# test --browser), with pointer events as a mouse sends them: a selection
# Shift+clicked and Shift+dragged across staves, acted on by Delete and by
# the arrows, one Undo each.

const TOOLS_TRIO = "\\header { title = \"Trio\" }\n" + "<<\n" + "  \\new Staff { \\time 4/4 c''1 | d''1 | e''1 }\n"
+ "  \\new Staff { e'1 | f'1 | g'1 }\n"
+ "  \\new Staff { \\clef bass c1 | d1 | e1 }\n"
+ ">>\n"

# The playground opened on `source`, the score focused.
def tools_open(source)
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(source)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
  evaluate("document.querySelector('.studio-sheet').focus()")
end

def tools_text
  evaluate("document.querySelector('[data-source]').value")
end

def tools_sel
  JSON.parse(evaluate("JSON.stringify(document.getElementById('studio').studio.sel)"))
end

def tools_steps
  evaluate("document.getElementById('studio').studio.past.length")
end

# Where the empty end of bar `bar` is on staff `n` (0 the top), in the page's pixels.
def tools_bar_point(bar, n)
  JSON.parse(evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const b = st.view.bars.find((x) => x.bar === #{bar});"
  + " return JSON.stringify({ x: svg.left + (b.box[2] - 6) * scale,"
  + " y: svg.top + (b.staves[#{n}] + 16 - (st.view.y0 ?? 0)) * scale }); })()"))
end

# A press (and its release) on the sheet at `point`, Shift held or not.
def tools_press(kind, point, shift)
  evaluate("document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent(#{JSON.stringify(kind)},"
  + " { clientX: #{point["x"]}, clientY: #{point["y"]}, pointerId: 1, bubbles: true, button: 0, shiftKey: #{shift} }))")
  sleep(0.2)
end

# Where the head of lane `lane`'s event `index` is drawn, in the page's pixels.
def tools_note_point(lane, index)
  JSON.parse(evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const k = st.items.findIndex((it) => it.staff === #{lane} && it.index === #{index});"
  + " const h = st.view.items.find((it) => it.item === k).heads[0].box;"
  + " return JSON.stringify({ x: svg.left + (h[0] + h[2]) / 2 * scale,"
  + " y: svg.top + ((h[1] + h[3]) / 2 - (st.view.y0 ?? 0)) * scale }); })()"))
end

def tools_click(point, shift)
  tools_press("pointerdown", point, shift)
  tools_press("pointerup", point, shift)
end

describe("The tools on many notes at once (#1024)") do
  test("Shift+click on another staff selects the bars of every staff between; Delete empties them, one Undo back") do
    tools_open(TOOLS_TRIO)
    tools_click(tools_bar_point(0, 0), false)
    assert_eq(tools_sel()["bars"], [0, 0])
    tools_click(tools_bar_point(1, 2), true)
    sel = tools_sel()
    assert_eq(sel["bars"], [0, 1])
    assert_eq(sel["lanes"], [
      0,
      1,
      2
    ])
    # Every staff's notes in those bars are lit.
    lit = evaluate("document.querySelectorAll('.studio-bar-selected').length")
    assert_eq(lit, 2)
    steps = tools_steps()
    press("Delete")
    sleep(0.5)
    text = tools_text()
    assert_eq(tools_steps(), steps + 1)
    assert_not(text.includes?("c''1"), text)
    assert_not(text.includes?("f'1"), text)
    assert_not(text.includes?("d1"), text)
    # Bar 3 untouched on every staff.
    assert_contains(text, "e''1")
    assert_contains(text, "g'1")
    press("Ctrl+z")
    sleep(0.5)
    assert_contains(tools_text(), "c''1 | d''1 | e''1")
    assert_no_page_errors()
  end

  test("a Shift+drag down across staves selects them; ↑ moves every staff's notes a step") do
    tools_open(TOOLS_TRIO)
    from = tools_bar_point(2, 0)
    to = tools_bar_point(2, 1)
    tools_press("pointerdown", from, true)
    tools_press("pointermove", to, true)
    tools_press("pointerup", to, true)
    sel = tools_sel()
    assert_eq(sel["lanes"], [0, 1])
    assert_eq(sel["bars"], [2, 2])
    press("ArrowUp")
    sleep(0.5)
    text = tools_text()
    assert_contains(text, "f''1")
    assert_contains(text, "a'1")
    # The bass staff was not selected: as it was.
    assert_contains(text, "e1")
    assert_no_page_errors()
  end

  test("a plain drag on one staff still selects that staff's bars only") do
    tools_open(TOOLS_TRIO)
    from = tools_bar_point(0, 1)
    to = tools_bar_point(1, 1)
    tools_press("pointerdown", from, false)
    tools_press("pointermove", to, false)
    tools_press("pointerup", to, false)
    sel = tools_sel()
    assert_eq(sel["staff"], 1)
    assert_eq(sel["bars"], [0, 1])
    assert(sel["lanes"].nil?, "one staff")
    assert_no_page_errors()
  end

  test("Alt+Shift+↓ moves the selected staff under the next one, the selection with it; one Undo puts it back") do
    tools_open(TOOLS_TRIO)
    tools_click(tools_bar_point(0, 0), false)
    steps = tools_steps()
    press("Alt+Shift+ArrowDown")
    sleep(0.5)
    text = tools_text()
    assert_eq(tools_steps(), steps + 1)
    assert(text.index_of("e'1 | f'1") < text.index_of("c''1 | d''1"), text)
    assert_eq(tools_sel()["staff"], 1)
    # The menu's item does the same, back up.
    evaluate("document.querySelector('[data-act=\"move-staff\"][data-by=\"-1\"]').click()")
    sleep(0.5)
    assert(tools_text().index_of("c''1 | d''1") < tools_text().index_of("e'1 | f'1"))
    press("Alt+Shift+ArrowUp")
    sleep(0.3)
    assert_contains(evaluate("document.querySelector('[data-status]').textContent"), "first already")
    press("Ctrl+z")
    sleep(0.5)
    assert(tools_text().index_of("e'1 | f'1") < tools_text().index_of("c''1 | d''1"))
    assert_no_page_errors()
  end

  test("Transpose to a key: the score to D major, its key signature with it; in the key, a selection a third up") do
    tools_open(TOOLS_TRIO)
    evaluate("(() => { const mode = document.querySelector('[data-transpose-mode]'); mode.value = 'key';"
    + " mode.dispatchEvent(new Event('change', { bubbles: true }));"
    + " document.querySelector('[data-transpose-key]').value = '2'; })()")
    assert(evaluate("document.querySelector('[data-transpose-interval]').hidden"), "the interval menu steps aside")
    assert_eq(evaluate("document.querySelector('[data-transpose-way]').value"), "0")
    steps = tools_steps()
    evaluate("document.querySelector('[data-act=transpose][data-scope=score]').click()")
    sleep(0.5)
    text = tools_text()
    assert_eq(tools_steps(), steps + 1)
    assert_contains(text, "\\key d \\major")
    assert_contains(text, "d''1 | e''1 | fis''1")
    # In the key, by degrees: the top staff's first bar, a third up (D major: d'' to fis'').
    evaluate("(() => { const mode = document.querySelector('[data-transpose-mode]'); mode.value = 'degrees';"
    + " mode.dispatchEvent(new Event('change', { bubbles: true }));"
    + " document.querySelector('[data-transpose-degrees]').value = '2';"
    + " document.querySelector('[data-transpose-way]').value = '1'; })()")
    tools_click(tools_bar_point(0, 0), false)
    evaluate("document.querySelector('[data-act=transpose][data-scope=selection]').click()")
    sleep(0.5)
    assert_contains(tools_text(), "fis''1 | e''1 | fis''1")
    assert_no_page_errors()
  end

  test("Edit ▸ Halve the durations, then Double them, over two staves: one Undo each") do
    tools_open(TOOLS_TRIO)
    tools_click(tools_bar_point(0, 0), false)
    tools_click(tools_bar_point(0, 1), true)
    steps = tools_steps()
    evaluate("document.querySelectorAll('[data-act=durations]')[1].click()")
    sleep(0.5)
    text = tools_text()
    assert_eq(tools_steps(), steps + 1)
    assert_contains(text, "c''2 r2 | d''1")
    assert_contains(text, "e'2 r2 | f'1")
    # The bass staff was not selected.
    assert_contains(text, "c1 | d1")
    evaluate("document.querySelectorAll('[data-act=durations]')[0].click()")
    sleep(0.5)
    assert_contains(tools_text(), "c''1 | d''1")
    assert_eq(tools_steps(), steps + 2)
    # A whole note doubled writes over the next bar, tied across the bar line.
    tools_click(tools_bar_point(0, 2), false)
    evaluate("document.querySelectorAll('[data-act=durations]')[0].click()")
    sleep(0.5)
    assert_contains(tools_text(), "c1~ | c1 | e1")
    assert_no_page_errors()
  end

  test("Edit ▸ Retrograde turns the clicked notes round; Inversion mirrors them around the first") do
    tools_open("\\header { title = \"Line\" }\n{ c''4 d''4 e''4 g''4 | c''1 }\n")
    tools_click(tools_note_point(0, 0), false)
    tools_click(tools_note_point(0, 3), true)
    assert(tools_sel()["t1"] > 0, "the four notes selected")
    steps = tools_steps()
    evaluate("document.querySelector('[data-act=retrograde]').click()")
    sleep(0.5)
    assert_contains(tools_text(), "g''4 e''4 d''4 c''4 | c''1")
    assert_eq(tools_steps(), steps + 1)
    evaluate("document.querySelector('[data-act=invert]').click()")
    sleep(0.5)
    # Around g'': e'' (down a third) to b'' (up a third), in C major.
    assert_contains(tools_text(), "g''4 b''4 c'''4 d'''4 | c''1")
    press("Ctrl+z")
    sleep(0.5)
    assert_contains(tools_text(), "g''4 e''4 d''4 c''4")
    assert_no_page_errors()
  end

  test("Ctrl+Alt+Shift+V opens Paste special; the marks only go onto the notes there") do
    tools_open("\\header { title = \"Marks\" }\n{ c''4\\f-> d''4( e''4) f''4 | g''4 a''4 b''4 c'''4 }\n")
    tools_click(tools_note_point(0, 0), false)
    tools_click(tools_note_point(0, 3), true)
    press("Ctrl+c")
    sleep(0.3)
    tools_click(tools_note_point(0, 4), false)
    press("Ctrl+Alt+Shift+V")
    sleep(0.3)
    assert(evaluate("document.querySelector('[data-paste-special]').open"), "the dialog is open")
    steps = tools_steps()
    click("[data-paste-special] [data-filter=marks]")
    sleep(0.6)
    assert_not(evaluate("document.querySelector('[data-paste-special]').open"))
    assert_eq(tools_steps(), steps + 1)
    assert_contains(tools_text(), "g''4\\f-> a''4( b''4) c'''4")
    # The notes only, over the same bar: the marks of the paste are not there.
    press("Ctrl+z")
    sleep(0.5)
    tools_click(tools_note_point(0, 4), false)
    evaluate("document.querySelector('[data-act=paste-special]').click()")
    sleep(0.3)
    click("[data-paste-special] [data-filter=notes]")
    sleep(0.6)
    assert_contains(tools_text(), "f''4 | c''4 d''4 e''4 f''4")
    assert_no_page_errors()
  end
end
