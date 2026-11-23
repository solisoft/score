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
end
