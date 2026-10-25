# Scores that used to open read-only (#402), in a real browser (soli test
# --browser): a French clef, a tempo and a mark inside a bar, a cadenza, an
# ossia, a horn changing key apart from the flute, \override, \paper and
# \layout — the piece opens on the score, its notes are written over, the
# text keeps all of it, Undo takes the note back, and the MIDI view shows it.

const ED_SOURCE = "\\paper { ragged-right = ##f }\n" + "\\layout { \\context { \\Staff \\RemoveEmptyStaves } }\n"
+ "\\header { title = \"Opens in the editor\" }\n"
+ "<<\n"
+ "  \\new Staff = \"main\" \\with { instrumentName = \"Flute\" \\override StaffSymbol.thickness = #1.5 } {\n"
+ "    \\clef french \\key d \\major \\time 4/4\n"
+ "    d''4 e''4 \\tempo 4 = 90 fis''4 \\mark \"Trio\" g''4 | \\override NoteHead.color = #red a''1 |\n"
+ "    \\cadenzaOn b''8 a''8 g''8 fis''8 e''8 d''8 \\cadenzaOff \\bar \"|\" e''1 |\n"
+ "    << { d''1 } \\new Staff \\with { alignAboveContext = \"main\" } { fis''2 \\tuplet 3/2 { g''4 a'' b'' } } >>\n"
+ "  }\n"
+ "  \\new Staff \\with { instrumentName = \"Horn in F\" } {\n"
+ "    \\clef bass \\key c \\major \\time 4/4\n"
+ "    c1 | \\key bes \\major d1 | \\cadenzaOn s2. \\cadenzaOff \\bar \"|\" f1 | bes,1\n"
+ "  }\n"
+ ">>\n"

const ED_TAB = "\\header { title = \"Tab\" }\n"
+ "<< \\new Staff { \\clef \"treble_8\" c'4 e'4\\2 g'4 c''4 | d'1 } \\new TabStaff { c'4 e'4\\2 g'4 c''4 | d'1 } >>\n"

# The playground opened on `source`, the score focused.
def ed_open(source)
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

def ed_text
  evaluate("document.querySelector('[data-source]').value")
end

def ed_editable?
  evaluate("Boolean(document.getElementById('studio').studio.score)")
end

def ed_notice
  evaluate("(() => { const n = document.querySelector('[data-notice]');"
  + " return n && !n.hidden ? n.textContent : ''; })()")
end

# The MIDI view switched, as the app's MIDI button switches it.
def ed_midi_view
  evaluate("(() => { const b = document.createElement('button'); b.dataset.act = 'midi-view';"
  + " document.getElementById('studio').appendChild(b); b.click(); b.remove(); })()")
  sleep(0.6)
end

describe("Scores that used to open read-only, in a browser") do
  test("a score with a cadenza, an ossia, keys apart and settings opens editable and keeps them through an edit") do
    ed_open(ED_SOURCE)
    assert(ed_editable?(), "the score is the model's: #{ed_notice}")
    assert_not(ed_notice().includes?("does not edit"))
    # Read and written back: nothing it says is lost.
    text = ed_text()
    for kept in [
      "\\clef french",
      "\\tempo 4 = 90 fis''4 \\mark \"Trio\"",
      "\\override NoteHead.color = #red",
      "\\cadenzaOn b''8",
      "alignAboveContext = \"main\"",
      "\\key bes \\major d1",
      "\\layout { \\context { \\Staff \\RemoveEmptyStaves } }",
      "ragged-right = ##f",
      "\\override StaffSymbol.thickness = #1.5"
    ]
      assert_contains(text, kept)
    end
    # A note written at the start, in note input: the rest is kept.
    steps_before = evaluate("document.getElementById('studio').studio.past.length")
    press("n")
    sleep(0.3)
    press("g")
    sleep(0.5)
    after = ed_text()
    assert_eq(evaluate("document.getElementById('studio').studio.past.length"), steps_before + 1)
    assert(after.includes?("\\key d \\major \\time 4/4\n    g''4 e''4"), after)
    for kept in [
      "\\tempo 4 = 90 fis''4 \\mark \"Trio\"",
      "\\override NoteHead.color = #red",
      "\\cadenzaOn b''8",
      "alignAboveContext",
      "\\key bes \\major d1"
    ]
      assert_contains(after, kept)
    end
    press("Escape")
    press("Ctrl+z")
    sleep(0.5)
    assert_contains(ed_text(), "\\key d \\major \\time 4/4\n    d''4 e''4")
    # The MIDI view (the app's button; the playground has none, so one is put in) shows it, then the score again.
    ed_midi_view()
    assert_eq(evaluate("document.getElementById('studio').studio.mode"), "midi")
    roll = "!document.querySelector('.studio-roll').hidden && document.querySelectorAll('.studio-roll rect').length > 0"
    assert(evaluate(roll), "the roll is drawn")
    ed_midi_view()
    assert_eq(evaluate("document.getElementById('studio').studio.mode"), "score")
    assert_no_page_errors()
  end

  test("a tablature opens editable; a note written on the staff above, the TabStaff stays one") do
    ed_open(ED_TAB)
    assert(ed_editable?(), "the score is the model's: #{ed_notice}")
    assert_contains(ed_text(), "\\new TabStaff {")
    press("n")
    sleep(0.3)
    press("a")
    sleep(0.5)
    assert_contains(ed_text(), "\\new TabStaff {")
    assert_no_page_errors()
  end
end
