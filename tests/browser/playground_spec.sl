# The playground's score and its LilyPond, linked, in a real browser (soli
# test --browser): the caret on a note in the text selects it on the score,
# a note selected on the score is marked in the text, and the drawing says
# what it is to a screen reader.

const MOONLIGHT = "\\header { title = \"Au clair de la lune\" }\n{ \\time 4/4 c'4 c' c' d' | e'2 d' | c'1 }"

# Replaces the source box's text as typing does, then leaves it: the model
# reads it and writes it back in its own notation.
def type_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

# Puts the caret inside the first `token` of the text, as a click there does.
def caret_on(token)
  evaluate("(() => { const box = document.querySelector('[data-source]');"
  + " const at = box.value.indexOf(#{JSON.stringify(token)}); box.focus(); box.setSelectionRange(at + 1, at + 1);"
  + " box.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()")
  sleep(0.4)
end

def marked_text
  evaluate("document.querySelector('[data-source-mark] mark')?.textContent ?? null")
end

describe("The playground, in a browser") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    type_source(MOONLIGHT)
  end

  test("the caret on a note in the text selects that note on the score") do
    caret_on("e'2")
    assert_text("Note E4 · half")
    assert_eq(marked_text(), "e'2")
    caret_on("c'1")
    assert_text("Note C4 · whole")
    assert_no_page_errors()
  end

  test("a note selected on the score is marked and selected in the text, the focus staying on the score") do
    caret_on("e'2")
    evaluate("document.querySelector('.studio-sheet').focus()")
    press("ArrowRight")
    sleep(0.4)
    assert_text("Note D4 · half")
    assert_eq(marked_text(), "d'2")
    selected = evaluate("(() => { const box = document.querySelector('[data-source]');"
    + " return box.value.slice(box.selectionStart, box.selectionEnd); })()")
    assert_eq(selected, "d'2")
    assert(evaluate("document.activeElement.classList.contains('studio-sheet')"))
  end

  test("typing in the text drops the mark: it would point at the old text") do
    caret_on("e'2")
    assert_eq(marked_text(), "e'2")
    evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = box.value + ' ';"
    + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
    assert_null(marked_text())
  end

  test("the drawing names its score and describes it") do
    title = evaluate("document.querySelector('.studio-sheet svg title')?.textContent")
    assert_eq(title, "Au clair de la lune")
    words = evaluate("document.querySelector('.studio-sheet svg desc')?.textContent")
    assert_eq(words, "1 staff, 3 bars. Staff 1: no sharps or flats, 4/4, 7 notes, 0 rests.")
  end
end
