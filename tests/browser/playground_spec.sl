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

# Where the note palette stands: "above" or "below" the selected note, or "hidden".
def palette_side
  evaluate("(() => { const p = document.querySelector('.studio-palette');"
  + " return !p || p.hidden ? 'hidden' : p.dataset.side; })()")
end

# Types `words` into the open words box, then presses `key` ("Enter", " ").
def type_chord(words, key)
  evaluate("(() => { const box = document.querySelector('.studio-words'); box.value = #{JSON.stringify(words)};"
  + " box.dispatchEvent(new KeyboardEvent('keydown', { key: #{JSON.stringify(key)}, bubbles: true })); })()")
  sleep(0.4)
end

# The LilyPond the source box holds.
def playground_text
  evaluate("document.querySelector('[data-source]').value")
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

# Two bars repeated, with a first and a second ending, then a last bar.
const REPEATED = "\\header { title = \"Twice\" }\n{ \\time 4/4 \\repeat volta 2 { c'4 d' e' f' }"
+ " \\alternative { { g'1 } { a'1 } } b'1 \\bar \"|.\" }"

# The keys of a saved MIDI file's notes, in the order they sound, and its
# tempo: read in the page from the file the editor offered (window.savedHref).
const MIDI_KEYS = """
(async () => {
  const bytes = new Uint8Array(await (await fetch(window.savedHref)).arrayBuffer());
  const notes = [];
  let tempo = 0;
  let at = 14;
  while (at < bytes.length) {
    const end = at + 8 + ((bytes[at + 4] << 24) | (bytes[at + 5] << 16) | (bytes[at + 6] << 8) | bytes[at + 7]);
    let q = at + 8, ticks = 0, running = 0;
    const number = () => { let v = 0, b; do { b = bytes[q++]; v = (v << 7) | (b & 127); } while (b & 128); return v; };
    while (q < end) {
      ticks += number();
      let status = bytes[q];
      if (status & 128) q++; else status = running;
      running = status;
      if (status === 0xff) {
        const type = bytes[q++], size = number();
        if (type === 0x51) tempo = Math.round(60e6 / ((bytes[q] << 16) | (bytes[q + 1] << 8) | bytes[q + 2]));
        q += size;
      } else if (status === 0xf0 || status === 0xf7) q += number();
      else {
        const kind = status & 0xf0, key = bytes[q++];
        const velocity = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[q++];
        if (kind === 0x90 && velocity > 0) notes.push([ticks, key]);
      }
    }
    at = end;
  }
  notes.sort((a, b) => a[0] - b[0]);
  return JSON.stringify({ tempo, keys: notes.map((n) => n[1]) });
})()
"""

def marked_text
  evaluate("document.querySelector('[data-source-mark] mark')?.textContent ?? null")
end

# A MIDI keyboard the page is given instead of the browser's: its messages
# are sent from the test with window.fakeKeyboard.onmidimessage(…).
const FAKE_MIDI = """
(() => {
  window.fakeKeyboard = { id: 'fake-kb', name: 'Fake keys', onmidimessage: null };
  const access = { inputs: new Map([['fake-kb', window.fakeKeyboard]]), outputs: new Map() };
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
})()
"""

# A message from the fake keyboard.
def midi_in(bytes)
  evaluate("window.fakeKeyboard.onmidimessage({ data: new Uint8Array(#{JSON.stringify(bytes)}),"
  + " timeStamp: performance.now() })")
  sleep(0.1)
end

# What a selector's element says.
# Opens the Playback panel from the arrow beside Play, as a click on it does (#419).
def open_playback
  click("[popovertarget=\"studio-playback\"]")
  sleep(0.2)
end

# Whether the toolbox's section `name` is open.
def section_open?(name)
  evaluate("document.querySelector('[data-section=\"#{name}\"]').open")
end

def text_of(selector)
  evaluate("document.querySelector(#{JSON.stringify(selector)})?.textContent ?? null")
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

  test("Save as MIDI plays the repeat out, each ending in turn, at 100 a quarter") do
    type_source(REPEATED)
    evaluate("(() => { window.saved = null; HTMLAnchorElement.prototype.click = function () {"
    + " window.saved = this.download; window.savedHref = this.href; }; })()")
    evaluate("document.querySelector('[data-act=\"save-midi\"]').click()")
    sleep(0.8)
    assert_eq(evaluate("window.saved"), "twice.mid")
    heard = JSON.parse(evaluate(MIDI_KEYS))
    assert_eq(heard["tempo"], 100)
    # C D E F G, C D E F A, then B: not the written C D E F G A B.
    assert_eq(heard["keys"], [
      60,
      62,
      64,
      65,
      67,
      60,
      62,
      64,
      65,
      69,
      71
    ])
    assert_no_page_errors()
  end

  test("Ctrl + and Ctrl − zoom the score and not the page; + alone sharpens the note") do
    caret_on("e'2")
    evaluate("document.querySelector('.studio-sheet').focus()")
    # What the browser would do with the key: its own zoom, unless the editor took it.
    evaluate("window.keptKeys = [];"
    + " window.addEventListener('keydown', (e) => window.keptKeys.push(e.defaultPrevented))")
    press("Ctrl+=")
    sleep(0.3)
    assert_eq(evaluate("document.querySelector('#studio').studio.zoom"), 1.1)
    assert_eq(evaluate("document.querySelector('[data-zoom-label]').textContent"), "110 %")
    assert_eq(evaluate("window.keptKeys"), [true])
    press("Ctrl+-")
    press("Ctrl+-")
    sleep(0.3)
    assert_eq(evaluate("document.querySelector('#studio').studio.zoom"), 0.9)
    # Without Ctrl, + is a sharp: the zoom stays, the note changes.
    press("+")
    sleep(0.4)
    assert_eq(evaluate("document.querySelector('#studio').studio.zoom"), 0.9)
    assert_contains(evaluate("document.querySelector('[data-source]').value"), "eis'2")
    assert_no_page_errors()
  end

  test("an 8va, fingerings and a phrasing slur are edited on the score, not as text only") do
    type_source("{ \\ottava #1 c'''4-1\\( d''' e''' f'''\\) | \\ottava #0 c'2 d'2 | e'1 }")
    assert_not(evaluate("document.querySelector('#studio').classList.contains('studio-text-only')"))
    caret_on("c'2")
    evaluate("document.querySelector(\"[data-act='finger'][data-n='3']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "c'2-3")
    caret_on("d'2")
    evaluate("document.querySelector(\"[data-act='ottava'][data-value='-1']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "\\ottava #-1 d'2 |")
    caret_on("e'1")
    evaluate("document.querySelector(\"[data-act='string-number'][data-n='2']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "\\ottava #0 e'1\\2")
    # The phrase taken away from its first note, both its ends with it.
    caret_on("c'''4")
    evaluate("document.querySelector(\"[data-act='phrase']\").click()")
    sleep(0.4)
    assert_not(playground_text().includes?("\\("))
    assert_not(playground_text().includes?("\\)"))
    assert_contains(playground_text(), "\\ottava #1 c'''4-1 d'''4")
    assert_no_page_errors()
  end

  test("notes drawn on the other staff and words under the alto are edited on the score (#375)") do
    type_source("\\new PianoStaff << \\new Staff = \"up\" { c''4 d'' e'' f'' | g''1 }"
    + " \\new Staff = \"down\" { \\clef bass c1 | c1 } >>")
    assert_not(evaluate("document.querySelector('#studio').classList.contains('studio-text-only')"))
    caret_on("e''4")
    evaluate("document.querySelector(\"[data-act='cross'][data-dir='1']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "d''4 \\change Staff = \"down\" e''4 \\change Staff = \"up\" f''4")
    # Again: back on its own staff.
    caret_on("e''4")
    evaluate("document.querySelector(\"[data-act='cross'][data-dir='1']\").click()")
    sleep(0.4)
    assert_not(playground_text().includes?("\\change Staff"))
    # The top staff has no staff above it: said, and nothing changed.
    before = playground_text()
    evaluate("document.querySelector(\"[data-act='cross'][data-dir='-1']\").click()")
    sleep(0.4)
    assert_eq(playground_text(), before)
    # A choir staff whose words go to the alto opens on the score too.
    type_source("<< \\new Staff << \\new Voice = \"s\" { \\voiceOne c''2 d'' }"
    + " \\new Voice = \"alto\" { \\voiceTwo a'2 b' } >> \\new Lyrics \\lyricsto \"alto\" { Al -- to } >>")
    assert_not(evaluate("document.querySelector('#studio').classList.contains('studio-text-only')"))
    assert_contains(playground_text(), "\\new Lyrics \\lyricsto \"alto\" { Al -- to }")
    assert_no_page_errors()
  end

  test("a line of chord names opens on the score, and its chords are typed beat by beat (#375)") do
    type_source("{ c''2 d'' | e''1 }")
    caret_on("c''2")
    evaluate("document.querySelector(\"[data-act='chord-line']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "\\new ChordNames \\chordmode")
    assert_not(evaluate("document.querySelector('#studio').classList.contains('studio-text-only')"))
    caret_on("c''2")
    evaluate("document.querySelector(\"[data-act='chord']\").click()")
    sleep(0.3)
    # Am7, Space to the next beat, D7, Enter.
    type_chord("Am7", " ")
    type_chord("D7", " ")
    type_chord("G", "Enter")
    assert_contains(playground_text(), "a4:m7 d4:7 g2 | s1")
    # A symbol the line cannot write is refused, and the line stays.
    before = playground_text()
    caret_on("e''1")
    evaluate("document.querySelector(\"[data-act='chord']\").click()")
    sleep(0.3)
    type_chord("blue", "Enter")
    assert_eq(playground_text(), before)
    assert_no_page_errors()
  end

  test("the note palette stands under a note with chord symbols over it, and leaves while one is typed (#416)") do
    type_source("{ \\time 4/4 c'4 d'4 e'4 f'4 | g'1 }")
    caret_on("d'4")
    # No chord yet: the palette is over the note.
    assert_eq(palette_side(), "above")
    evaluate("document.querySelector(\"[data-act='chord']\").click()")
    sleep(0.3)
    # Typing a chord: the palette is out of the way of the words box.
    assert_eq(palette_side(), "hidden")
    type_chord("Am7", "Enter")
    assert_contains(playground_text(), "d'4^\"Am7\"")
    # Back on the note: the palette is under it, the chord over it seen.
    caret_on("d'4")
    assert_eq(palette_side(), "below")
    note_bottom = evaluate("(() => { const st = document.getElementById('studio').studio;"
    + " const box = document.querySelector('.studio-svg svg').getBoundingClientRect();"
    + " const scale = box.width / st.view.width;"
    + " const k = st.items.findIndex((it) => it.staff === st.sel.staff && it.index === 1);"
    + " const item = st.view.items.find((it) => it.item === k);"
    + " return box.top + (item.box[3] - (st.view.y0 ?? 0)) * scale; })()")
    palette_top = evaluate("document.querySelector('.studio-palette').getBoundingClientRect().top")
    assert(palette_top > note_bottom, "the palette starts under the note: #{palette_top} > #{note_bottom}")
    # A note of a staff with no chord symbol keeps it over.
    type_source("{ \\time 4/4 c'4 d'4 e'4 f'4 | g'1 }")
    caret_on("e'4")
    assert_eq(palette_side(), "above")
    assert_no_page_errors()
  end

  test("the arrow beside Play opens the Playback panel; Escape closes it, back on the arrow (#419)") do
    assert_not(evaluate("document.getElementById('studio-playback').matches(':popover-open')"))
    open_playback()
    assert(evaluate("document.getElementById('studio-playback').matches(':popover-open')"), "the panel opens")
    # Under the arrow, its speed, practice and MIDI fields in it.
    panel_top = evaluate("document.getElementById('studio-playback').getBoundingClientRect().top")
    arrow = "document.querySelector('[popovertarget=\"studio-playback\"]')"
    arrow_bottom = evaluate("#{arrow}.getBoundingClientRect().bottom")
    assert(panel_top >= arrow_bottom, "under the arrow: #{panel_top} >= #{arrow_bottom}")
    fields = [
      "[data-play='rate']",
      "[data-play='metronome']",
      "[data-midi-in]",
      "[data-sync='clock-out']",
      "[data-act='mixer']"
    ]
    fields.each do |field|
      assert(evaluate("Boolean(document.querySelector(\"#studio-playback #{field}\"))"), "#{field} in the panel")
    end
    # Its fields work from there: the speed set is the one played.
    evaluate("(() => { const box = document.querySelector('[data-play=\"rate\"]'); box.value = '0.5';"
    + " box.dispatchEvent(new Event('change', { bubbles: true })); })()")
    assert_eq(evaluate("document.querySelector('[data-play=\"rate\"]').value"), "0.5")
    press("Escape")
    sleep(0.2)
    assert_not(evaluate("document.getElementById('studio-playback').matches(':popover-open')"))
    # The toolbox has no Playback section any more.
    assert_not(evaluate("Boolean(document.querySelector('[data-section=\"playback\"]'))"))
    assert_no_page_errors()
  end

  test("the arrow beside Rec holds the grid a recording is fitted to, and its dynamics (#419)") do
    assert_eq(evaluate("document.querySelector('[data-quantize]').closest('[popover]')?.id"), "studio-recording")
    click("[popovertarget=\"studio-recording\"]")
    sleep(0.2)
    assert(evaluate("document.getElementById('studio-recording').matches(':popover-open')"), "the panel opens")
    assert_contains(text_of("#studio-recording"), "Fit notes to")
    assert_contains(text_of("#studio-recording"), "Write the dynamics played")
    # A click elsewhere closes it.
    click("[data-sheet]")
    sleep(0.2)
    assert_not(evaluate("document.getElementById('studio-recording').matches(':popover-open')"))
    assert_no_page_errors()
  end

  test("the toolbox opens on the tools written with, folds the rest, and keeps a fold by hand (#419)") do
    ["mode", "duration", "notes", "pitch"].each do |name|
      assert(section_open?(name), "#{name} open")
    end
    ["articulations", "ornaments", "bars-and-staves", "from-bar"].each do |name|
      assert_not(section_open?(name), "#{name} folded")
    end
    # Mode and Duration first, Duration on screen on a laptop without scrolling.
    order = evaluate("[...document.querySelectorAll('[data-section]')].map((it) => it.dataset.section).slice(0, 4)")
    assert_eq(order, [
      "mode",
      "duration",
      "notes",
      "pitch"
    ])
    viewport(1024, 768)
    sleep(0.3)
    duration_bottom = evaluate("document.querySelector('[data-section=\"duration\"]').getBoundingClientRect().bottom")
    assert(duration_bottom < 768, "Duration in sight: #{duration_bottom}")
    # Pitch folded and Ornaments opened by hand: kept after a reload.
    click("[data-section=\"pitch\"] > summary")
    click("[data-section=\"ornaments\"] > summary")
    sleep(0.2)
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    assert_not(section_open?("pitch"), "Pitch stays folded")
    assert(section_open?("ornaments"), "Ornaments stays open")
    evaluate("localStorage.removeItem('eui-score-studio-folded')")
    assert_no_page_errors()
  end

  test("bars selected open Bars & staves without changing what is kept folded (#419)") do
    evaluate("localStorage.removeItem('eui-score-studio-folded')")
    assert_not(section_open?("bars-and-staves"))
    evaluate("(() => { const st = document.getElementById('studio').studio;"
    + " st.sel = { staff: 0, t0: 0, t1: 0, bars: [0, 0] };"
    + " document.querySelector('[data-act=\"zoom-in\"]').click(); })()")
    sleep(0.3)
    assert(section_open?("bars-and-staves"), "opened for the bars")
    assert_eq(evaluate("localStorage.getItem('eui-score-studio-folded')"), nil)
    assert_no_page_errors()
  end

  test("note input shows on the score: a blue band along its top, and the bar under it says so (#419)") do
    band = "getComputedStyle(document.querySelector('[data-sheet]'), '::before').backgroundColor"
    assert_eq(evaluate(band), "rgba(0, 0, 0, 0)")
    click(".studio-toolbox [data-act=\"mode-input\"]")
    sleep(0.2)
    assert_eq(evaluate(band), "rgb(37, 99, 201)")
    # The bar under the score, not the menu bar, says what is going on.
    assert_eq(evaluate("document.querySelector('[data-state]').closest('.studio-statusbar') !== null"), true)
    assert_contains(text_of("[data-state]"), "Note input")
    press("Escape")
    sleep(0.2)
    assert_eq(evaluate(band), "rgba(0, 0, 0, 0)")
    assert_no_page_errors()
  end

  test("View › Source beside the score puts the text on the right of a wide screen, kept after a reload (#420)") do
    evaluate("localStorage.removeItem('eui-score-source-side')")
    viewport(1440, 900)
    sleep(0.3)
    source_box = "document.querySelector('.studio-source').getBoundingClientRect()"
    sheet_box = "document.querySelector('[data-sheet]').getBoundingClientRect()"
    # Under the score at first.
    assert(evaluate("#{source_box}.top") >= evaluate("#{sheet_box}.bottom"), "the source starts under the score")
    evaluate("document.querySelector('[data-act=\"source-side\"]').click()")
    sleep(0.3)
    assert(evaluate("#{source_box}.left") >= evaluate("#{sheet_box}.right"), "the source beside the score")
    assert(evaluate("#{source_box}.top") < evaluate("#{sheet_box}.bottom"), "level with the score")
    assert_eq(
      evaluate("document.querySelector('[data-source-side-label]').firstChild.textContent"),
      "Source under the score "
    )
    # The text still follows the score: a caret in it selects the note.
    caret_on("e'2")
    assert_text("Note E4 · half")
    # Kept after a reload.
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    assert(evaluate("#{source_box}.left") >= evaluate("#{sheet_box}.right"), "still beside after a reload")
    # A narrower window keeps it under the score, and says why.
    viewport(1024, 768)
    sleep(0.3)
    assert(evaluate("#{source_box}.top") >= evaluate("#{sheet_box}.bottom"), "under the score on a laptop")
    evaluate("document.querySelector('[data-act=\"source-side\"]').click()")
    sleep(0.2)
    assert_contains(text_of("[data-status]"), "The source under the score")
    evaluate("document.querySelector('[data-act=\"source-side\"]').click()")
    sleep(0.2)
    assert_contains(text_of("[data-status]"), "on a wider window")
    evaluate("localStorage.removeItem('eui-score-source-side')")
    assert_no_page_errors()
  end

  test("the playground says once that the score stays in this browser, and hides it for good (#419)") do
    evaluate("localStorage.removeItem('eui-score-playground-banner-hidden')")
    visit("/playground")
    wait_for("[data-source]")
    assert_eq(evaluate("document.querySelectorAll('.playground-banner').length"), 1)
    assert_contains(text_of(".playground-banner"), "Your score stays in this browser")
    # Said once: not again under the score.
    studio_text = evaluate("document.querySelector('.studio').innerText")
    assert_not(studio_text.includes?("Click a note to select it, or press N"))
    click("[data-banner-close]")
    sleep(0.2)
    assert_eq(evaluate("document.querySelectorAll('.playground-banner').length"), 0)
    visit("/playground")
    wait_for("[data-source]")
    sleep(0.5)
    assert_eq(evaluate("document.querySelectorAll('.playground-banner').length"), 0)
    evaluate("localStorage.removeItem('eui-score-playground-banner-hidden')")
    assert_no_page_errors()
  end

  test("Edit › Swap voices 1 and 2 puts crossed voices back, the high notes in voice 1, one undo away (#417)") do
    type_source("{ \\time 4/4 d'1 | << { f4 f c' c' } \\\\ { f'4 f' d' f' } >> | e'1 }")
    crossed = playground_text()
    caret_on("c'4")
    evaluate("document.querySelector(\"[data-act='swap-voices']\").click()")
    sleep(0.5)
    swapped = playground_text()
    assert_ne(swapped, crossed)
    # Voice 1 (first in the << >>) now opens on the high f', voice 2 on the low f.
    first = swapped.index_of("f'4")
    second = swapped.index_of("f4")
    assert(first >= 0 && second >= 0 && first < second, "the high notes come first: #{swapped}")
    evaluate("document.querySelector(\"[data-act='undo']\").click()")
    sleep(0.5)
    assert_eq(playground_text(), crossed)
    # A staff of one voice: refused, said, nothing changed.
    type_source("{ c'4 d'4 e'4 f'4 | g'1 }")
    single = playground_text()
    caret_on("d'4")
    evaluate("document.querySelector(\"[data-act='swap-voices']\").click()")
    sleep(0.4)
    assert_eq(playground_text(), single)
    assert_contains(evaluate("document.querySelector('.studio').innerText"), "one voice")
    assert_no_page_errors()
  end

  test("stems turned, a beam by hand and a note spelled the other way, from the keys (#375)") do
    type_source("{ c''8 d'' e'' f'' cis''2 | g''1 }")
    caret_on("cis''2")
    evaluate("document.querySelector('.studio-sheet').focus()")
    press("j")
    sleep(0.4)
    assert_contains(playground_text(), "des''2")
    caret_on("des''2")
    evaluate("document.querySelector('.studio-sheet').focus()")
    press("x")
    sleep(0.4)
    assert_contains(playground_text(), "\\stemUp des''2")
    # A beam by hand wants two notes: one alone is refused, and said.
    caret_on("c''8")
    evaluate("document.querySelector(\"[data-act='beam']\").click()")
    sleep(0.4)
    assert_contains(evaluate("document.querySelector('[data-status]').textContent"), "two notes or more")
    assert_not(playground_text().includes?("["))
    assert_no_page_errors()
  end

  test("a figured bass and a guitar chord diagram are typed on the score (#375)") do
    type_source("{ \\clef bass c2 g,2 | c1 }")
    caret_on("c2")
    evaluate("document.querySelector(\"[data-act='figure-line']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "\\new FiguredBass \\figuremode")
    caret_on("c2")
    evaluate("document.querySelector(\"[data-act='figures']\").click()")
    sleep(0.3)
    type_chord("6 4", " ")
    type_chord("7+", "Enter")
    assert_contains(playground_text(), "<6 4>4 <7+>2. | s1")
    # A shape over a note, as six strings from the low E.
    caret_on("g,2")
    evaluate("document.querySelector(\"[data-act='fret']\").click()")
    sleep(0.3)
    type_chord("320003", "Enter")
    assert_contains(playground_text(), "g,2^\\markup \\fret-diagram \"6-3;5-2;4-o;3-o;2-o;1-3;\"")
    # One that is not a guitar chord is refused, and the score stays.
    before = playground_text()
    caret_on("c1")
    evaluate("document.querySelector(\"[data-act='fret']\").click()")
    sleep(0.3)
    type_chord("x3201", "Enter")
    assert_eq(playground_text(), before)
    assert_no_page_errors()
  end

  test("a real file's breaths, bowings, cis! and mid-bar clef are edited on the score; its settings are kept") do
    type_source("{ \\override NoteHead.color = #red \\stemUp c''4\\upbow cis''!4 \\breathe \\clef bass e4 f4 | g1 }")
    assert_not(evaluate("document.querySelector('#studio').classList.contains('studio-text-only')"))
    # The rewrite keeps the \override where it was written (#402), and has nothing to say.
    assert_not(evaluate("document.querySelector('[data-notice]').textContent").includes?("\\override"))
    assert_contains(playground_text(), "\\override NoteHead.color = #red \\stemUp c''4\\upbow cis''!4 \\breathe")
    assert_contains(playground_text(), "\\clef bass e4 f4 | g1")
    caret_on("e4")
    evaluate("document.querySelector(\"[data-act='breath'][data-kind='caesura']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "\\clef bass e4 \\caesura f4")
    evaluate("document.querySelector(\"[data-act='art'][data-name='downbow']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "e4\\downbow \\caesura")
    caret_on("f4")
    evaluate("document.querySelector(\"[data-act='reminder'][data-kind='cautionary']\").click()")
    sleep(0.4)
    assert_contains(playground_text(), "f?4 | g1")
    assert_no_page_errors()
  end

  test("the menus are moved through with the arrows, and the score keeps its keys meanwhile") do
    caret_on("e'2")
    source_before = evaluate("document.querySelector('[data-source]').value")
    active = "(() => { const el = document.activeElement;"
    + " return el.dataset.act ?? el.textContent.trim().slice(0, 12); })()"
    evaluate("document.querySelector('.studio-dropdown summary').focus()")
    press("ArrowDown")
    assert(evaluate("document.querySelector('.studio-dropdown').open"), "↓ opens File")
    assert_eq(evaluate(active), "new")
    press("ArrowDown")
    assert_eq(evaluate(active), "Open a file…")
    press("End")
    assert_eq(evaluate(active), "share")
    press("Home")
    assert_eq(evaluate(active), "new")
    press("ArrowUp")
    assert_eq(evaluate(active), "share", "↑ on the first item goes round to the last")
    # → : the next menu, open at its first item, this one closed.
    press("ArrowRight")
    assert_not(evaluate("document.querySelectorAll('.studio-dropdown')[0].open"))
    assert(evaluate("document.querySelectorAll('.studio-dropdown')[1].open"), "→ opens Edit")
    assert_eq(evaluate(active), "undo")
    # Nothing to redo: Redo is off, and ↓ passes over it.
    assert(evaluate("document.querySelector('.studio-dropdown-items [data-act=\"redo\"]').disabled"))
    press("ArrowDown")
    assert_eq(evaluate(active), "mode-select")
    # Escape closes it, back on its name.
    press("Escape")
    assert_not(evaluate("document.querySelectorAll('.studio-dropdown')[1].open"))
    assert_eq(evaluate("document.activeElement.textContent"), "Edit")
    # None of these arrows moved the selected note.
    assert_eq(evaluate("document.querySelector('[data-source]').value"), source_before)
    assert_eq(evaluate("document.querySelector('.studio-dropdown summary').getAttribute('aria-haspopup')"), "menu")
    assert_no_page_errors()
  end

  test("the shortcuts sheet lists every key the editor handles, from its table") do
    evaluate("document.querySelector('.studio-sheet').focus()")
    press("?")
    sleep(0.3)
    assert(evaluate("document.querySelector('[data-keys]').open"), "? opens the sheet")
    keys = evaluate("[...document.querySelectorAll('[data-keys-list] dt')].map((dt) => dt.textContent)")
    # Ctrl and Alt are ⌘ and ⌥ on a Mac, the sheet written for the keyboard in front of the person.
    mac = evaluate("/mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform)")
    expected = ["R", "L / K, Ctrl+L / Ctrl+K", "Ctrl+Alt+1 – 4", "Ctrl+Shift+V", "Ctrl++ / Ctrl+−", "Space", "?"]
    expected.each do |key|
      label = mac ? key.replace("Ctrl+Shift+", "⌘⇧").replace("Ctrl+Alt+", "⌘⌥").replace("Ctrl+", "⌘") : key
      assert_contains(keys, label)
    end
    assert_not(keys.join(" ").contains("⌘"), "no ⌘ off a Mac") unless mac
    if mac
      assert_not(keys.join(" ").contains("Ctrl"), "no Ctrl on a Mac")
      assert_eq(
        evaluate("document.querySelector('.studio-dropdown-items [data-act=\"undo\"] kbd').textContent"),
        "⌘Z"
      )
    end
    assert_eq(keys.length, evaluate("[...document.querySelectorAll('[data-keys-list] dd')].length"))
    assert_no_page_errors()
  end

  test("MIDI learn gives a controller's knob to Speed, kept in the browser, and clears it") do
    evaluate("localStorage.removeItem('eui-score-midi-learn')")
    evaluate(FAKE_MIDI)
    evaluate("(() => { const box = document.querySelector('[data-midi-in]'); box.value = 'find';"
    + " box.dispatchEvent(new Event('change', { bubbles: true })); })()")
    sleep(0.4)
    assert_eq(evaluate("document.querySelector('[data-midi-in]').value"), "fake-kb")
    open_playback()
    click("#studio-playback [data-act=\"midi-learn\"]")
    sleep(0.3)
    assert(evaluate("document.querySelector('[data-midi-learn]').open"), "the dialog opens")
    targets = evaluate("[...document.querySelectorAll('.midi-learn-row')].map((row) => row.dataset.target)")
    ["play", "stop", "record", "tempo", "volume"].each do |target|
      assert_contains(targets, target)
    end
    assert_contains(text_of("[data-midi-learn]"), "Ableton Link")
    click("[data-learn=\"tempo\"]")
    sleep(0.2)
    assert_contains(text_of("[data-target=\"tempo\"] .midi-learn-control"), "move a control")
    # The knob turned: CC 21 on channel 1 is now the Speed's.
    midi_in([176, 21, 40])
    assert_eq(text_of("[data-target=\"tempo\"] .midi-learn-control"), "CC 21, channel 1")
    kept = evaluate("JSON.parse(localStorage.getItem('eui-score-midi-learn'))")
    assert_eq(kept["tempo"]["number"], 21)
    # Turned all the way up: the fastest speed; down: the slowest. Another knob does nothing.
    midi_in([176, 21, 127])
    assert_eq(evaluate("document.querySelector('[data-play=\"rate\"]').value"), "2")
    midi_in([176, 21, 0])
    assert_eq(evaluate("document.querySelector('[data-play=\"rate\"]').value"), "0.25")
    midi_in([176, 22, 127])
    assert_eq(evaluate("document.querySelector('[data-play=\"rate\"]').value"), "0.25")
    click("[data-learn-clear=\"tempo\"]")
    sleep(0.2)
    assert_eq(text_of("[data-target=\"tempo\"] .midi-learn-control"), "—")
    assert_eq(evaluate("localStorage.getItem('eui-score-midi-learn')"), "{}")
    midi_in([176, 21, 127])
    assert_eq(
      evaluate("document.querySelector('[data-play=\"rate\"]').value"),
      "0.25",
      "forgotten: the knob moves nothing"
    )
    assert_no_page_errors()
  end

  test("the MIDI clock and the device's latency are kept in the browser") do
    evaluate("localStorage.removeItem('eui-score-midi-sync')")
    open_playback()
    click("[data-sync=\"clock-out\"]")
    evaluate("(() => { const box = document.querySelector('[data-sync=\"delay\"]'); box.value = '25';"
    + " box.dispatchEvent(new Event('change', { bubbles: true })); })()")
    sleep(0.2)
    kept = evaluate("JSON.parse(localStorage.getItem('eui-score-midi-sync'))")
    assert_eq(kept["clockOut"], true)
    assert_eq(kept["clockIn"], false)
    assert_eq(kept["delay"], 25)
    assert_no_page_errors()
  end
end

# The page as it prints: the print stylesheet's rules applied to the screen
# (the browser helpers cannot switch the media), after the page has cut its
# score for printing, as it does on Ctrl/Cmd+P (beforeprint).
const AS_PRINTED = """
(() => {
  window.dispatchEvent(new Event('beforeprint'));
  const found = [];
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule && rule.media.mediaText === 'print') {
        found.push(...[...rule.cssRules].filter((r) => r instanceof CSSStyleRule).map((r) => r.cssText));
      }
      else if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch (error) {}
  }
  const style = document.createElement('style');
  style.textContent = found.join(' ');
  document.head.appendChild(style);
  return found.length;
})()
"""

def shown?(selector)
  evaluate("(() => { const el = document.querySelector(#{JSON.stringify(selector)});"
  + " return !!el && getComputedStyle(el).display !== 'none'; })()")
end

describe("The playground, printed") do
  test("prints the score alone, one picture per system, without the selection's colours") do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    long = "\\header { title = \"Long\" }\n{ " + "c'4 d' e' f' | " * 24 + "}"
    type_source(long)
    caret_on("e'")
    assert(
      evaluate("document.querySelector('.studio-svg').innerHTML.includes('#b4373a')"),
      "the selection drawn on the screen"
    )
    assert_gt(evaluate(AS_PRINTED), 5)
    systems = evaluate("document.querySelectorAll('.studio-print svg').length")
    assert_gt(systems, 2, "a picture per system")
    # Each its own band of the drawing, one after the other.
    tops = evaluate("[...document.querySelectorAll('.studio-print svg')]"
    + ".map((s) => Number(s.getAttribute('viewBox').split(' ')[1])).join(',')")
    numbers = tops.split(",").map do |t|
      t.to_f
    end
    for i in range(1, numbers.length)
      assert_gt(numbers[i], numbers[i - 1])
    end
    assert_eq(
      evaluate("document.querySelectorAll('.studio-print [id^=\"ed-p1-\"]').length > 0"),
      true,
      "ids of its own"
    )
    assert_eq(
      evaluate("document.querySelector('.studio-print').innerHTML.includes('#b4373a')"),
      false,
      "no selection drawn"
    )
    assert(shown?(".studio-print"))
    assert_not(shown?(".studio-sheet"))
    [".studio-menubar", ".studio-toolbox", ".studio-source", ".site-header", ".site-footer"].each do |part|
      assert_not(shown?(part), "#{part} is not printed")
    end
    evaluate("window.dispatchEvent(new Event('afterprint'))")
    assert_eq(evaluate("document.querySelectorAll('.studio-print').length"), 0, "gone after printing")
    assert_no_page_errors()
  end
end
