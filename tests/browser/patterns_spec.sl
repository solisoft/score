# Edit ▸ Drum grid, Arpeggiate and Chord track in a real browser (soli test
# --browser): each dialog writes into the score as one edit, which Undo
# takes back.

# Replaces the source box's text as typing does, then leaves it.
def pattern_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

# Puts the caret inside the first `token` of the text: that note is selected.
def pattern_caret(token)
  evaluate("(() => { const box = document.querySelector('[data-source]');"
  + " const at = box.value.indexOf(#{JSON.stringify(token)}); box.focus(); box.setSelectionRange(at + 1, at + 1);"
  + " box.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()")
  sleep(0.4)
end

def pattern_text
  evaluate("document.querySelector('[data-source]').value")
end

def pattern_click(selector)
  evaluate("document.querySelector(#{JSON.stringify(selector)}).click()")
  sleep(0.4)
end

describe("The pattern tools, in a browser") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
  end

  test("the drum grid writes a drum bar as its cells are clicked, loops it, and Undo takes a stroke back") do
    pattern_source("\\new DrumStaff \\drummode { \\time 4/4 r1 | r1 }")
    pattern_caret("r1")
    pattern_click("[data-act='drum-grid']")
    wait_for("[data-cell='bd:0']")
    assert_eq(evaluate("document.querySelectorAll('[data-cell^=\"bd:\"]').length"), 16)
    assert_eq(evaluate("JSON.stringify(document.querySelector('#studio').studio.loopBars)"), "[0,0]")
    pattern_click("[data-cell='bd:0']")
    assert_contains(pattern_text(), "bd4 r2. | r1")
    pattern_click("[data-cell='sn:4']")
    pattern_click("[data-cell='sn:4']")
    assert_contains(pattern_text(), "bd4 sn4-> r2")
    assert_eq(evaluate("document.querySelector('[data-cell=\"sn:4\"]').dataset.value"), "2")
    # The next bar, looped in its turn.
    pattern_click("[data-grid-act='next']")
    assert_eq(evaluate("JSON.stringify(document.querySelector('#studio').studio.loopBars)"), "[1,1]")
    pattern_click("[data-cell='hh:0']")
    assert_contains(pattern_text(), "| hh4 r2.")
    evaluate("document.querySelector('[data-drum-grid]').close()")
    sleep(0.3)
    assert_eq(evaluate("document.querySelector('#studio').studio.loopBars"), nil)
    pattern_click(".studio-dropdown-items [data-act='undo']")
    assert_contains(pattern_text(), "bd4 sn4-> r2 | r1")
    assert_no_page_errors()
  end

  test("the drum grid is refused on a staff of notes") do
    pattern_source("{ \\time 4/4 c'1 }")
    pattern_caret("c'1")
    pattern_click("[data-act='drum-grid']")
    assert_text("Select a bar of a drum staff first")
    assert_eq(evaluate("document.querySelector('[data-drum-grid]')?.open ?? false"), false)
  end

  test("the selected chords are broken up and down in eighths, in one Undo") do
    pattern_source("{ \\time 4/4 <c' e' g'>2 <a c' e'>2 | c''1 }")
    # The two chords of the first bar selected, as a click and a Shift+click do.
    evaluate("document.querySelector('#studio').studio.sel = { staff: 0, t0: 0, t1: 40320, head: -1 }")
    pattern_click("[data-act='arpeggiate']")
    wait_for("[data-arp-apply]")
    evaluate("document.querySelector('[data-arp-pattern]').value = 'up-down'")
    evaluate("document.querySelector('[data-arp-step]').value = '8'")
    pattern_click("[data-arp-apply]")
    assert_contains(pattern_text(), "c'8 e'8 g'8 e'8 a8 c'8 e'8 c'8 | c''1")
    assert_text("2 chords broken")
    pattern_click(".studio-dropdown-items [data-act='undo']")
    assert_contains(pattern_text(), "<c' e' g'>2 <a c' e'>2")
    assert_no_page_errors()
  end

  test("a chord track is written on the chosen staff from the chord symbols") do
    pattern_source("<< \\new Staff { \\time 4/4 c''1^\"C\" | a'2^\"Am\" f'2^\"F\" }"
    + " \\new Staff { \\clef bass r1 | r1 } >>")
    # The melody selected: it holds the chord symbols, so the chords go on the staff below it.
    pattern_caret("c''1")
    pattern_click("[data-act='chord-track']")
    wait_for("[data-chord-apply]")
    assert_eq(evaluate("document.querySelector('[data-chord-staff]').value"), "1")
    evaluate("document.querySelector('[data-chord-style]').value = 'bass-chord'")
    pattern_click("[data-chord-apply]")
    assert_contains(pattern_text(), "c,4 <c e g>4 <c e g>4 <c e g>4 | a,4 <a c' e'>4 f,4 <f a c'>4")
    assert_text("3 chords written")
    assert_no_page_errors()
  end

  test("the chord track asks for chord symbols when there are none") do
    pattern_source("{ \\time 4/4 c'1 }")
    pattern_click("[data-act='chord-track']")
    assert_text("No chord symbols yet")
  end
end
