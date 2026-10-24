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

  test("a real file's breaths, bowings, cis! and mid-bar clef are edited on the score; its settings are named") do
    type_source("{ \\override NoteHead.color = #red \\stemUp c''4\\upbow cis''!4 \\breathe \\clef bass e4 f4 | g1 }")
    assert_not(evaluate("document.querySelector('#studio').classList.contains('studio-text-only')"))
    # The rewrite left out the \override, and said so.
    assert_contains(evaluate("document.querySelector('[data-notice]').textContent"), "\\override NoteHead.color")
    assert_contains(playground_text(), "\\stemUp c''4\\upbow cis''!4 \\breathe \\clef bass e4 f4 | g1")
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
