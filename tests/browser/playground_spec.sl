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

# A MusicXML file, as another program writes it: a flute's two bars.
const FLUTE_XML = """<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><work><work-title>Two Bars</work-title></work>
<part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key>
<time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<note><pitch><step>G</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
<note><pitch><step>A</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note></measure>
<measure number="2"><note><pitch><step>B</step><octave>5</octave></pitch><duration>2</duration><type>half</type></note>
<barline location="right"><bar-style>light-heavy</bar-style></barline></measure></part></score-partwise>"""

# Gives `input` (a selector) a file named `name` holding `text`, as choosing it does.
def choose_file(input, name, text)
  evaluate("(() => { const input = document.querySelector(#{JSON.stringify(input)}); const files = new DataTransfer();"
  + " files.items.add(new File([#{JSON.stringify(text)}], #{JSON.stringify(name)})); input.files = files.files;"
  + " input.dispatchEvent(new Event('change', { bubbles: true })); })()")
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

  test("a MusicXML file opens as LilyPond, and the score saves as MusicXML") do
    choose_file("[data-act='open']", "two-bars.musicxml", FLUTE_XML)
    wait_for_text("two-bars.musicxml opened.")
    source = evaluate("document.querySelector('[data-source]').value")
    assert_contains(source, "title = \"Two Bars\"")
    assert_contains(source, "\\key g \\major")
    assert_match(source, "g''4 a''4 \\| b''2")
    # Saved: the download's name and what it holds, caught as the link is clicked.
    evaluate("(() => { window.saved = null; const click = HTMLAnchorElement.prototype.click;"
    + " HTMLAnchorElement.prototype.click = function () { window.saved = this.download;"
    + " fetch(this.href).then((r) => r.text()).then((t) => { window.savedText = t; }); }; })()")
    evaluate("document.querySelector('[data-act=\"save-musicxml\"]').click()")
    sleep(0.5)
    assert_eq(evaluate("window.saved"), "two-bars.musicxml")
    saved = evaluate("window.savedText")
    assert_contains(saved, "<work-title>Two Bars</work-title>")
    assert_contains(saved, "<step>B</step><octave>5</octave>")
    assert_no_page_errors()
  end

  test("a file that is not MusicXML is refused with its reason, and the score stays") do
    choose_file("[data-act='open']", "notes.xml", "<html><body>no music</body></html>")
    wait_for_text("This is not a MusicXML score")
    assert_contains(evaluate("document.querySelector('[data-source]').value"), "Au clair de la lune")
  end
end
