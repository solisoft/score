# The metre wherever it is written (#408), in a real browser (soli test
# --browser): a \time inside a bar and a metre drawn beside another (its
# notes scaled) open on the score; a note typed over keeps them, the bars
# drawn as before; what would change a scaled note's length is refused.

const MT_MIDBAR = "\\header { title = \"Mid-bar time\" }\n"
+ "{ \\time 4/4 c'4 d'4 \\time 3/4 e'4 | f'4 g'4 a'4 | b'2. }\n"

const MT_POLY = "\\header { title = \"Polymetre\" }\n" + "<< \\new Staff { \\time 3/4 c'4 d' e' | f'2. }\n"
+ "\\new Staff { \\set Staff.timeSignatureFraction = 4/4 \\scaleDurations 3/4 { c4 d e f | g1 } } >>\n"

# The playground opened on `source`, the score focused.
def mt_open(source)
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

def mt_text
  evaluate("document.querySelector('[data-source]').value")
end

def mt_bars
  evaluate("new Set(document.getElementById('studio').studio.view.bars.map((b) => b.bar)).size")
end

# A click on the head (pitch `d`, 7 = c') of lane `lane`'s event `index`.
def mt_click(lane, index, d)
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

describe("The metre wherever it is written, on the score") do
  test("a \\time inside a bar: opens editable, a note typed over keeps it where it is, Undo") do
    mt_open(MT_MIDBAR)
    assert(evaluate("Boolean(document.getElementById('studio').studio.score)"), "the score is the model's")
    assert_contains(mt_text(), "c'4 d'4 \\time 3/4 e'4 | f'4 g'4 a'4 | b'2.")
    assert_eq(mt_bars(), 3)
    mt_click(0, 1, 8)
    assert_eq(JSON.parse(evaluate("JSON.stringify(document.getElementById('studio').studio.sel)"))["t0"], 20160)
    press("g")
    sleep(0.5)
    assert_contains(mt_text(), "c'4 g'4 \\time 3/4 e'4 | f'4 g'4 a'4 | b'2.")
    assert_eq(mt_bars(), 3)
    press("Ctrl+z")
    sleep(0.5)
    assert_contains(mt_text(), "c'4 d'4 \\time 3/4 e'4 |")
    assert_no_page_errors()
  end

  test("4/4 drawn beside 3/4: a scaled note typed over stays scaled; note input there is refused, said") do
    mt_open(MT_POLY)
    assert(evaluate("Boolean(document.getElementById('studio').studio.score)"), "the score is the model's")
    assert_contains(mt_text(), "\\set Staff.timeSignatureFraction = 4/4")
    mt_click(1, 0, 0)
    press("e")
    sleep(0.5)
    after = mt_text()
    assert_contains(after, "\\scaleDurations 3/4 { e4 d4 e4 f4 } | \\scaleDurations 3/4 { g1 }")
    assert_eq(mt_bars(), 2)
    # Note input writes notes of their own length: refused on this staff, nothing changes.
    # Every line the status shows from here (the sounds loading may come after the refusal).
    evaluate("(() => { const s = document.querySelector('[data-status]'); window.mtSaid = [];"
    + " new MutationObserver(() => window.mtSaid.push(s.textContent))"
    + ".observe(s, { childList: true, subtree: true, characterData: true }); })()")
    press("n")
    sleep(0.3)
    press("a")
    sleep(0.5)
    assert_eq(mt_text(), after)
    assert(
      evaluate("window.mtSaid.some((line) => line.includes('scaled (\\\\scaleDurations'))"),
      "the refusal is said"
    )
    press("Escape")
    assert_no_page_errors()
  end
end
