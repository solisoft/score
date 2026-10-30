# The words drawn on the score, opened where they are drawn (#434): a double
# click on a chord diagram, an expression, a staff text or a syllable opens its
# box with its value; a chord diagram's grid puts fingers on its strings.

const WORDS_SOURCE = "{ \\time 4/4 c''4^\\markup \\fret-diagram \"6-x;5-3;4-2;3-o;2-1;1-o;\""
+ " d''4_\\markup \\italic \"dolce\""
+ " e''4^\"solo\" f''4\\sustainOn | g''1\\sustainOff }\n\\addlyrics { la li lo lu sol }"

# Replaces the source box's text as typing does, then leaves it.
def words_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
end

# Two presses at a point of the sheet, as a mouse double-clicks: each press
# draws the score again, as a real one does.
def press_twice(x_expr, y_expr)
  evaluate("(() => { const sheet = document.querySelector('.studio-sheet');"
  + " const at = { bubbles: true, cancelable: true,"
  + " pointerId: 1, button: 0, clientX: #{x_expr}, clientY: #{y_expr} };"
  + " for (const n of [1, 2]) { (document.elementFromPoint(at.clientX, at.clientY) ?? sheet)"
  + ".dispatchEvent(new PointerEvent('pointerdown', at));"
  + " sheet.dispatchEvent(new PointerEvent('pointerup', at)); } })()")
  sleep(0.4)
end

# A double click at the middle of the `nth` word of kind `kind` ("text", "lyric") drawn on the score.
def double_click_word(kind, nth)
  where = "(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const word = st.view.words.filter((w) => w.kind === #{JSON.stringify(kind)})[#{nth}];"
  + " return [svg.left + (word.box[0] + word.box[2]) / 2 * scale,"
  + " svg.top + ((word.box[1] + word.box[3]) / 2 - (st.view.y0 ?? 0)) * scale]; })()"
  press_twice("#{where}[0]", "#{where}[1]")
end

# A double click on the empty sheet, far from any word.
def double_click_nowhere
  press_twice(
    "document.querySelector('.studio-svg svg').getBoundingClientRect().right - 4",
    "document.querySelector('.studio-svg svg').getBoundingClientRect().bottom - 2"
  )
end

# The open words box: its kind and value, or nil.
def open_words
  JSON.parse(evaluate("(() => { const box = document.querySelector('.studio-words');"
  + " const kind = box && [...box.classList].find((c) => c.startsWith('studio-words-'));"
  + " return JSON.stringify(box ? { kind, value: box.value } : null); })()"))
end

# Presses `key` in the open words box.
def words_key(key)
  evaluate("document.querySelector('.studio-words')"
  + ".dispatchEvent(new KeyboardEvent('keydown', { key: #{JSON.stringify(key)}, bubbles: true }))")
  sleep(0.5)
end

def words_text
  evaluate("document.querySelector('[data-source]').value")
end

describe("Words opened where they are drawn") do
  before_each() do
    viewport(1280, 800)
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    words_source(WORDS_SOURCE)
  end

  test("a double click opens a chord diagram, an expression, a staff text or a syllable with its value") do
    double_click_word("text", 0)
    assert_eq(
      open_words(),
      {"kind": "studio-words-fret", "value": "x32010"}
    )
    words_key("Escape")
    double_click_word("text", 1)
    assert_eq(
      open_words(),
      {"kind": "studio-words-expression", "value": "dolce"}
    )
    words_key("Escape")
    double_click_word("text", 2)
    assert_eq(
      open_words(),
      {"kind": "studio-words-text", "value": "solo"}
    )
    words_key("Escape")
    double_click_word("lyric", 2)
    assert_eq(
      open_words(),
      {"kind": "studio-words-lyric", "value": "lo"}
    )
    words_key("Escape")
    assert_null(open_words())
    assert_no_page_errors()
  end

  test("a changed word is written back, an emptied one taken away, Escape changes nothing") do
    double_click_word("text", 1)
    evaluate("document.querySelector('.studio-words').value = 'espressivo'")
    words_key("Enter")
    assert_contains(words_text(), "\\markup \\italic \"espressivo\"")
    assert_not(words_text().includes?("dolce"))
    double_click_word("text", 2)
    evaluate("document.querySelector('.studio-words').value = 'tutti'")
    words_key("Escape")
    assert_contains(words_text(), "\"solo\"")
    assert_not(words_text().includes?("tutti"))
    double_click_word("text", 2)
    evaluate("document.querySelector('.studio-words').value = ''")
    words_key("Enter")
    assert_not(words_text().includes?("solo"))
    assert_no_page_errors()
  end

  test("nothing opens off the words, nor on a pedal mark, nor in note input") do
    double_click_nowhere()
    assert_null(open_words())
    # The pedal's "Ped." is drawn as words, but it is a sign.
    pedal = evaluate("(() => { const st = document.getElementById('studio').studio;"
    + " return st.view.words.filter((w) => w.kind === 'text').length; })()")
    double_click_word("text", pedal - 1)
    assert_null(open_words())
    evaluate("document.querySelector('.studio-toolbox [data-act=\"mode-input\"]').click()")
    sleep(0.3)
    double_click_word("text", 1)
    assert_null(open_words())
  end

  test("the chord diagram's grid puts a finger on a string, opens or mutes it, and writes it") do
    double_click_word("text", 0)
    assert(evaluate("Boolean(document.querySelector('.studio-fret-grid'))"), "the grid is open")
    # The high E string's first fret: a finger there.
    evaluate("document.querySelector('.studio-fret-grid button[data-string=\"5\"][data-fret=\"1\"]').click()")
    assert_eq(open_words()["value"], "x32011")
    # Again: taken away, the string open.
    evaluate("document.querySelector('.studio-fret-grid button[data-string=\"5\"][data-fret=\"1\"]').click()")
    assert_eq(open_words()["value"], "x32010")
    # Over the nut, the low E goes from not played to open.
    evaluate("document.querySelector('.studio-fret-grid button[data-string=\"0\"][data-fret=\"nut\"]').click()")
    assert_eq(open_words()["value"], "032010")
    pressed = evaluate("[...document.querySelectorAll('.studio-fret-grid [aria-pressed=\"true\"]')]"
    + ".map((b) => b.dataset.string + ':' + b.dataset.fret).join(' ')")
    assert_eq(pressed, "4:1 2:2 1:3")
    # The box keeps the focus while the grid is clicked, and Enter writes the shape.
    assert(evaluate("document.activeElement.classList.contains('studio-words')"))
    words_key("Enter")
    assert_contains(words_text(), "\\fret-diagram \"6-o;5-3;4-2;3-o;2-1;1-o;\"")
    assert_not(evaluate("Boolean(document.querySelector('.studio-fret-grid'))"), "closed with its box")
    assert_no_page_errors()
  end
end

# A single click on the middle of the `nth` chord diagram drawn on the score.
def click_diagram(nth)
  evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const b = st.view.words.filter((w) => (w.words?.text ?? '').startsWith('\\u0001fret:'))[#{nth}].box;"
  + " const at = { clientX: svg.left + (b[0] + b[2]) / 2 * scale,"
  + " clientY: svg.top + ((b[1] + b[3]) / 2 - (st.view.y0 ?? 0)) * scale, pointerId: 1, bubbles: true, button: 0 };"
  + " const sheet = document.querySelector('.studio-sheet');"
  + " sheet.dispatchEvent(new PointerEvent('pointerdown', at));"
  + " sheet.dispatchEvent(new PointerEvent('pointerup', at)); })()")
  sleep(0.5)
end

# A fret of the open grid pressed and clicked as a mouse does. What has the
# focus once pressed: the box keeps it, or its blur writes and closes it (#438).
def press_fret(string, fret)
  focused = evaluate("(() => { const b = document.querySelector('.studio-fret-grid"
  + " button[data-string=\"#{string}\"][data-fret=\"#{fret}\"]');"
  + " const r = b.getBoundingClientRect();"
  + " const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,"
  + " pointerId: 1, bubbles: true, cancelable: true, button: 0 };"
  + " if (b.dispatchEvent(new PointerEvent('pointerdown', at))) b.focus();"
  + " const focused = document.activeElement.className;"
  + " b.dispatchEvent(new PointerEvent('pointerup', at)); b.click(); return focused; })()")
  sleep(0.3)
  focused
end

# The grid's frets with a finger, "string:fret" in the order drawn.
def fingers_shown
  evaluate("[...document.querySelectorAll('.studio-fret-grid [aria-pressed=\"true\"]')]"
  + ".map((b) => b.dataset.string + ':' + b.dataset.fret).join(' ')")
end

describe("A chord diagram clicked on the score") do
  before_each() do
    viewport(1280, 800)
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    words_source(WORDS_SOURCE)
  end

  test("a single click opens it large, its grid to click on, and changes nothing until it is written (#436)") do
    click_diagram(0)
    assert_eq(
      open_words(),
      {"kind": "studio-words-fret", "value": "x32010"}
    )
    assert_eq(fingers_shown(), "4:1 2:2 1:3")
    cell = evaluate("document.querySelector('.studio-fret-grid button[data-fret=\"1\"]').getBoundingClientRect().width")
    assert(cell >= 30, "cells large enough to click on: #{cell}")
    assert_contains(words_text(), "\\fret-diagram \"6-x;5-3;4-2;3-o;2-1;1-o;\"")
    evaluate("document.querySelector('.studio-fret-grid button[data-string=\"5\"][data-fret=\"3\"]').click()")
    assert_eq(open_words()["value"], "x32013")
    words_key("Enter")
    assert_contains(words_text(), "\\fret-diagram \"6-x;5-3;4-2;3-o;2-1;1-3;\"")
    assert_no_page_errors()
  end

  test("a shape up the neck shows its first fret and the frets after it") do
    words_source("{ c''1^\\markup \\fret-diagram \"6-x;5-5;4-7;3-7;2-6;1-5;\" }")
    click_diagram(0)
    assert_eq(open_words()["value"], "x57765")
    assert_eq(evaluate("document.querySelector('.studio-fret-first').textContent"), "5fr")
    assert_eq(fingers_shown(), "1:5 5:5 4:6 2:7 3:7")
    # Typed lower, the grid comes back to the first fret.
    evaluate("(() => { const box = document.querySelector('.studio-words'); box.value = 'x32010';"
    + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
    assert_eq(evaluate("document.querySelector('.studio-fret-first').textContent"), "")
    assert_eq(fingers_shown(), "4:1 2:2 1:3")
  end

  test("its grid stays open under the mouse: a click on a fret puts a finger there, again takes it away (#438)") do
    click_diagram(0)
    assert_eq(press_fret(5, 3), "studio-words studio-words-fret")
    assert_eq(
      open_words(),
      {"kind": "studio-words-fret", "value": "x32013"}
    )
    assert_eq(press_fret(5, 3), "studio-words studio-words-fret")
    assert_eq(
      open_words(),
      {"kind": "studio-words-fret", "value": "x32010"}
    )
    assert(evaluate("document.activeElement.classList.contains('studio-words')"), "the box keeps the focus")
    assert_no_page_errors()
  end

  test("in note input a click on a diagram opens nothing") do
    evaluate("document.querySelector('.studio-toolbox [data-act=\"mode-input\"]').click()")
    sleep(0.3)
    click_diagram(0)
    assert_null(open_words())
  end
end

# A guitar line under chord names, its first note with a diagram over it and "dolce" under it (#438).
const PALETTE_SOURCE = "\\header { title = \"Démo\" }\n<<\n  \\new ChordNames \\chordmode { s1 | s1 }\n"
+ "  \\new Staff { \\clef \"treble_8\" \\time 4/4"
+ " d'1^\\markup \\fret-diagram \"6-x;5-3;4-2;3-o;2-1;1-1;\"_\\markup \\italic \"dolce\" | r1 | r1 | r1 |"
+ " r1 | r1 | r1 | r1 | r1 | r1 | r1 | r1 | r1 | r1 | r1 | r1 }\n>>"

# The page box of the `nth` word drawn: [left, top, right, bottom].
def word_page_box(nth)
  evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const b = st.view.words[#{nth}].box; const y0 = st.view.y0 ?? 0;"
  + " return [svg.left + b[0] * scale, svg.top + (b[1] - y0) * scale,"
  + " svg.left + b[2] * scale, svg.top + (b[3] - y0) * scale]; })()")
end

describe("A note's palette and its words") do
  before_each() do
    viewport(1280, 800)
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    words_source(PALETTE_SOURCE)
  end

  test("the palette stands past the selected note's words, which a double click still opens (#438)") do
    # The note selected by a press on its head.
    evaluate("(() => { const st = document.getElementById('studio').studio;"
    + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
    + " const scale = svg.width / st.view.width;"
    + " const item = st.view.items.find((it) => it.item === st.view.words[1].item); const h = item.heads[0].box;"
    + " const at = { bubbles: true, pointerId: 1, button: 0, clientX: svg.left + (h[0] + h[2]) / 2 * scale,"
    + " clientY: svg.top + ((h[1] + h[3]) / 2 - (st.view.y0 ?? 0)) * scale };"
    + " const sheet = document.querySelector('.studio-sheet');"
    + " sheet.dispatchEvent(new PointerEvent('pointerdown', at));"
    + " sheet.dispatchEvent(new PointerEvent('pointerup', at)); })()")
    sleep(0.8)
    assert_eq(
      evaluate("document.querySelector('.studio-palette').hidden ? 'hidden'"
      + " : document.querySelector('.studio-palette').dataset.side"),
      "below"
    )
    dolce = word_page_box(1)
    palette_top = evaluate("document.querySelector('.studio-palette').getBoundingClientRect().top")
    assert(palette_top >= dolce[3], "the palette under \"dolce\": #{palette_top} >= #{dolce[3]}")
    before = words_text()
    double_click_word("text", 1)
    assert_eq(
      open_words(),
      {"kind": "studio-words-expression", "value": "dolce"}
    )
    words_key("Escape")
    assert_eq(words_text(), before, "no button of the palette was pressed")
    assert_no_page_errors()
  end

  test("on a score of one line, the chord diagram's grid opens all of it in the sheet, clear of its box (#438)") do
    click_diagram(0)
    assert_eq(open_words()["value"], "x32011")
    fits = evaluate("(() => { const g = document.querySelector('.studio-fret-grid').getBoundingClientRect();"
    + " const s = document.querySelector('.studio-sheet').getBoundingClientRect();"
    + " const b = document.querySelector('.studio-words').getBoundingClientRect();"
    + " return { bottom: g.bottom <= s.bottom, clear: g.left >= b.right || g.top >= b.bottom }; })()")
    assert_eq(
      fits,
      {"bottom": true, "clear": true}
    )
  end
end
