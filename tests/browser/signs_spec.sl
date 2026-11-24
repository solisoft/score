# The signs the engraver draws, put from the palette (#1039), in a real
# browser: a chord clicked, then an arpeggio's bracket, a long fermata, a
# tremolo between two notes, the sostenuto pedal — each written in the
# text; shape notes chosen for the staff; a tremolo refused where it
# cannot be written, with nothing changed; a text holding what the editor
# does not keep says so at its first rewrite, instead of losing it; and
# what it did not keep before — a tuned tablature, a grace note before a
# rest — opens whole and is edited.

const SG_SOURCE = "\\header { title = \"Signs\" }\n"
+ "\\new Staff { \\time 4/4 <c' e' g'>4 d''4 f''4 r4 | c''2 e''2 }"

# A tempo written after the last note: the engraver reads it, the editor's model has no bar to keep it on.
const SG_NOT_KEPT = "{ \\time 4/4 c''4 d''4 e''4 f''4 \\tempo \"Fin\" 4 = 60 }"

# What the editor left to the text or said it did not keep, before #1039: a piano's name on its brace, a
# tablature tuned by its \with, a grace note before a rest, one note drawn as a cross.
const SG_KEPT = "\\new PianoStaff \\with { instrumentName = \"Bass\" } << \\new Staff { \\clef \"bass_8\" \\time 4/4"
+ " \\grace e,8 r4 \\deadNote a,4 d4 g4 }"
+ " \\new TabStaff \\with { stringTunings = #bass-tuning } { r4 a,4 d4 g4 } >>"

def sg_open(source)
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  # The page scrolls smoothly (application.css): a click would land where its button no longer is (#1033).
  evaluate("document.documentElement.style.scrollBehavior = 'auto'")
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(source)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('.studio-sheet').focus()")
end

# …and the text box left: typed LilyPond is then rewritten as the editor writes it.
def sg_open_and_leave(source)
  sg_open(source)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
end

def sg_text
  evaluate("document.querySelector('[data-source]').value")
end

def sg_status
  evaluate("document.querySelector('[data-status]').textContent")
end

# A real click on the first head of the drawn item standing for lane `lane`'s event `index`.
def sg_click(lane, index)
  point = JSON.parse(evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const k = st.items.findIndex((it) => it.staff === #{lane} && it.index === #{index});"
  + " const item = st.view.items.find((it) => it.item === k);"
  + " const h = (item.heads[0] ?? item).box;"
  + " return JSON.stringify({ x: svg.left + (h[0] + h[2]) / 2 * scale,"
  + " y: svg.top + ((h[1] + h[3]) / 2 - (st.view.y0 ?? 0)) * scale }); })()"))
  for kind in ["pointerdown", "pointerup"]
    evaluate("document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent(#{JSON.stringify(kind)},"
    + " { clientX: #{point["x"]}, clientY: #{point["y"]}, pointerId: 1, bubbles: true, button: 0 }))")
    sleep(0.2)
  end
end

# A section of the palette opened, and one of its buttons clicked where it is.
def sg_tool(section, selector)
  evaluate("document.querySelector('.studio-toolbox [data-section=\"#{section}\"]').open = true")
  sleep(0.2)
  click(".studio-toolbox [data-section=\"#{section}\"] #{selector}")
  sleep(0.4)
end

# The staff's note heads chosen in This staff, as a person picks an option.
def sg_choose(value)
  evaluate("(() => { const field = document.querySelector('[data-field=\"staff-heads\"]');"
  + " field.value = #{JSON.stringify(value)};"
  + " field.dispatchEvent(new Event('change', { bubbles: true })); })()")
end

# …on the first staff.
def sg_click_note(index)
  sg_click(0, index)
end

describe("The signs of the palette, in a browser") do
  test("an arpeggio's bracket, a long fermata, a tremolo between two notes, the sostenuto pedal") do
    sg_open_and_leave(SG_SOURCE)
    sg_click_note(0)
    sg_tool("ornaments", "[data-act=\"arpeggio\"][data-style=\"bracket\"]")
    assert_contains(sg_text(), "\\arpeggioBracket <c' e' g'>4\\arpeggio \\arpeggioNormal")
    # The arrow in its place: one arpeggio, drawn another way.
    sg_tool("ornaments", "[data-act=\"arpeggio\"][data-style=\"down\"]")
    assert_contains(sg_text(), "\\arpeggioArrowDown <c' e' g'>4\\arpeggio")
    assert_not(sg_text().includes?("arpeggioBracket"))

    sg_click_note(1)
    sg_tool("articulations", "[data-act=\"art\"][data-name=\"longfermata\"]")
    sg_tool("ornaments", "[data-act=\"art\"][data-name=\"prallup\"]")
    assert_contains(sg_text(), "d''4\\longfermata\\prallup")
    sg_tool("fingering", "[data-act=\"pedal\"][data-pedal=\"sostenuto\"][data-how=\"on\"]")
    assert_contains(sg_text(), "d''4\\longfermata\\prallup\\sostenutoOn")

    # The two half notes of the second bar: a tremolo between them, in sixteenths.
    sg_click_note(4)
    sg_tool("ornaments", "[data-act=\"tremolo-pair\"][data-value=\"16\"]")
    assert_contains(sg_text(), "\\repeat tremolo 8 { c''16 e''16 }")
    # The engraver draws all of it: the score is on the page, with no error.
    assert(evaluate("document.querySelectorAll('.studio-svg svg use').length > 10"))
    # One Undo takes the tremolo back.
    press("Ctrl+z")
    sleep(0.4)
    assert_not(sg_text().includes?("\\repeat tremolo"))
    assert_contains(sg_text(), "c''2 e''2")
    assert_no_page_errors()
  end

  test("a tremolo between a note and a rest is refused, and nothing is written") do
    sg_open_and_leave(SG_SOURCE)
    sg_click_note(2)
    before = sg_text()
    sg_tool("ornaments", "[data-act=\"tremolo-pair\"][data-value=\"16\"]")
    assert_contains(sg_status(), "a note after this one")
    assert_eq(sg_text(), before)
    # An arpeggio's bracket on one note alone is refused too.
    sg_tool("ornaments", "[data-act=\"arpeggio\"][data-style=\"bracket\"]")
    assert_contains(sg_status(), "add notes to it first")
    assert_eq(sg_text(), before)
    assert_no_page_errors()
  end

  test("shape notes chosen for the staff, and the usual heads again") do
    sg_open_and_leave(SG_SOURCE)
    sg_click_note(1)
    evaluate("document.querySelector('.studio-toolbox [data-section=\"this-staff\"]').open = true")
    sleep(0.2)
    sg_choose("aikenHeads")
    sleep(0.5)
    assert_contains(sg_text(), "\\aikenHeads <c' e' g'>4")
    assert_eq(evaluate("document.querySelector('[data-field=\"staff-heads\"]').value"), "aikenHeads")
    sg_choose("")
    sleep(0.5)
    assert_not(sg_text().includes?("aikenHeads"))
    assert_no_page_errors()
  end

  test("a text holding what the editor does not keep is left as it is, and says so at its first rewrite") do
    sg_open(SG_NOT_KEPT)
    # Opened, the text is the one that was written: nothing is rewritten behind the reader's back.
    assert_contains(sg_text(), "\\tempo \"Fin\" 4 = 60")
    assert(evaluate("document.querySelector('[data-notice]').hidden"))
    sg_click_note(1)
    sg_tool("articulations", "[data-act=\"art\"][data-name=\"staccato\"]")
    assert_contains(sg_text(), "d''4-.")
    notice = evaluate("document.querySelector('[data-notice]').textContent")
    assert_contains(notice, "rewrote this piece's text without a clef, a key, a metre or a mark")
    assert_contains(notice, "Undo puts the text back as it was")
    press("Ctrl+z")
    sleep(0.4)
    assert_contains(sg_text(), "\\tempo \"Fin\" 4 = 60")
    assert_no_page_errors()
  end

  test("left alone, the text box is rewritten as the editor writes it: what that leaves out is said") do
    sg_open_and_leave(SG_NOT_KEPT)
    assert_not(sg_text().includes?("Fin"))
    assert_contains(
      evaluate("document.querySelector('[data-notice]').textContent"),
      "without a clef, a key, a metre or a mark"
    )
    assert_not(evaluate("document.querySelector('[data-notice]').hidden"))
  end

  test("what the editor said it did not keep opens whole: a tuned tablature, a grace note before a rest") do
    sg_open_and_leave(SG_KEPT)
    # Nothing is said to be left out, and nothing is: the text box is the editor's own text of the same piece.
    assert(evaluate("document.querySelector('[data-notice]').hidden"))
    assert_contains(sg_text(), "\\new PianoStaff \\with { instrumentName = \"Bass\" } <<")
    assert_contains(sg_text(), "\\new TabStaff \\with { stringTunings = #bass-tuning } {")
    assert_contains(sg_text(), "\\grace e,8 r4 \\deadNote a,4")
    # The tablature is edited as a staff is: an accent on its second note.
    sg_click(1, 1)
    sg_tool("articulations", "[data-act=\"art\"][data-name=\"accent\"]")
    assert_contains(sg_text(), "stringTunings = #bass-tuning")
    assert_contains(sg_text(), "a,4->")
    assert(evaluate("document.querySelector('[data-notice]').hidden"))
    assert_no_page_errors()
  end
end
