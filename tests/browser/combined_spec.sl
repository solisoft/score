# \partCombine and \autoChange edited on the score (#413), in a real browser
# (soli test --browser): a click on a note drawn once for both parts selects
# part I's, Ctrl+Alt+2 part II's, a letter typed rewrites that part only;
# a click on a note of either staff of an \autoChange selects the voice's
# note, and a letter typed rewrites the music inside \autoChange.

const PC_HORNS = "\\header { title = \"Horns\" }\n" + "\\new Staff \\with { instrumentName = \"Horns\" } {\n"
+ "  \\clef treble \\key f \\major \\time 3/4\n"
+ "  \\partCombine { c''4 d'' e''8 f'' | f''2. | g''2 r4 } { a'4 d'' c'' | r2. | r2 a'4 }\n"
+ "}\n"

const PC_PIANO = "\\header { title = \"Piano\" }\n"
+ "\\new PianoStaff \\with { instrumentName = \"Piano\" } \\autoChange { c'4 g r a, | b' <c' e>2. }\n"

# The playground opened on `source`, the score focused.
def pc_open(source)
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

def pc_text
  evaluate("document.querySelector('[data-source]').value")
end

def pc_selected
  JSON.parse(evaluate("JSON.stringify(document.getElementById('studio').studio.sel)"))
end

# A click on the head (pitch `d`, 7 = c') of the drawn item standing for lane `lane`'s event `index`.
def pc_click(lane, index, d)
  point = JSON.parse(evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const k = st.items.findIndex((it) => it.staff === #{lane} && it.index === #{index});"
  + " const item = st.view.items.find((it) => it.item === k);"
  + " const h = item.heads.find((x) => x.d === #{d}).box;"
  + " return JSON.stringify({ x: svg.left + (h[0] + h[2]) / 2 * scale,"
  + " y: svg.top + ((h[1] + h[3]) / 2 - (st.view.y0 ?? 0)) * scale }); })()"))
  for kind in ["pointerdown", "pointerup"]
    evaluate("document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent(#{JSON.stringify(kind)},"
    + " { clientX: #{point["x"]}, clientY: #{point["y"]}, pointerId: 1, bubbles: true, button: 0 }))")
    sleep(0.2)
  end
end

# Ctrl+Alt+`n`: voice (or part) `n` of the selection's staff.
def pc_voice(n)
  evaluate("document.querySelector('.studio-sheet').dispatchEvent(new KeyboardEvent('keydown',"
  + " { key: '#{n}', code: 'Digit#{n}', ctrlKey: true, altKey: true, bubbles: true }))")
  sleep(0.4)
end

describe("\\partCombine and \\autoChange, edited on the score") do
  test("\\partCombine: a click on a chord selects part I's note, Ctrl+Alt+2 part II's, each typed over alone") do
    pc_open(PC_HORNS)
    assert(evaluate("Boolean(document.getElementById('studio').studio.score)"), "the score is the model's")
    assert_contains(pc_text(), "\\partCombine { c''4 d''4 e''8 f''8 | f''2. | g''2 r4 }")
    # Beat 1 is drawn as one chord, c'' over a': its lower head is part II's pitch, its note part I's.
    pc_click(0, 0, 12)
    sel = pc_selected()
    assert_eq(sel["staff"], 0)
    assert_eq(sel["t0"], 0)
    press("e")
    sleep(0.5)
    after = pc_text()
    assert_contains(after, "\\partCombine { e''4 d''4")
    assert_contains(after, "{ a'4 d''4 c''4 | r2. | r2 a'4 }")
    # Part II's note under it, reached by the voice keys, typed over: part I stays.
    pc_voice(2)
    sel = pc_selected()
    assert_eq(sel["staff"], 1)
    assert_eq(sel["t0"], 0)
    assert_contains(evaluate("document.querySelector('[data-status]').textContent"), "Part II")
    assert(
      evaluate("document.querySelector('[data-state]').textContent").starts_with?("Part II · Note A4"),
      "the place line names the part"
    )
    press("g")
    sleep(0.5)
    after = pc_text()
    assert_contains(after, "\\partCombine { e''4 d''4")
    assert_contains(after, "{ g'4 d''4 c''4 | r2. | r2 a'4 }")
    # A third voice is refused, said; nothing changes.
    pc_voice(3)
    assert_eq(pc_text(), after)
    assert_contains(evaluate("document.querySelector('[data-status]').textContent"), "two parts, part I and part II")
    press("Ctrl+z")
    sleep(0.5)
    assert_contains(pc_text(), "{ a'4 d''4 c''4 | r2. | r2 a'4 }")
    assert_no_page_errors()
  end

  test("\\autoChange: a click on the lower staff selects the voice's note; typed over, the voice is rewritten") do
    pc_open(PC_PIANO)
    assert(evaluate("Boolean(document.getElementById('studio').studio.score)"), "the score is the model's")
    assert_contains(pc_text(), "\\new PianoStaff \\with { instrumentName = \"Piano\" } \\autoChange {")
    # g, under middle C, is drawn on the lower staff.
    pc_click(0, 1, 4)
    sel = pc_selected()
    assert_eq(sel["staff"], 0)
    assert_eq(sel["t0"], 20160)
    press("e")
    sleep(0.5)
    after = pc_text()
    assert_contains(after, "\\autoChange {\n  \\key c \\major \\time 4/4\n  c'4 e4 r4 a,4 | b'4 <c' e>2.")
    # b' on the upper staff typed over: f', still above middle C — and still one voice.
    pc_click(0, 4, 13)
    press("f")
    sleep(0.5)
    assert_contains(pc_text(), "c'4 e4 r4 a,4 | f'4 <c' e>2.")
    assert_eq(evaluate("document.getElementById('studio').studio.score.staves.length"), 1)
    assert_no_page_errors()
  end
end
