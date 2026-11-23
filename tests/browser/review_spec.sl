# The score read over (#1022), in a real browser: the status bar counts the
# remarks, its button opens the Review; a violin's low F is listed as out of
# its range, and clicking the remark selects that note; Ignore sets it aside
# on the score's settings line, so a reload still has it aside, and Show
# ignored lists it again. A bar the text wrote short is listed and selected.

const RV_SOURCE = "<< \\new Staff \\with { instrumentName = \"Violin\" midiInstrument = \"violin\" }"
+ " { \\time 4/4 g'1\\p | f1 | a'1 }\n"
+ " \\new Staff \\with { instrumentName = \"Cello\" midiInstrument = \"cello\" } { \\clef bass c1\\p | d1 | e1 } >>\n"

const RV_SHORT = "\\new Staff \\with { instrumentName = \"Flute\" midiInstrument = \"flute\" }"
+ " { \\time 4/4 c''1\\mf | d''4 e'' f'' | g''1 | a''1 }\n"

# The playground opened on `source`, as if typed in its text.
def rv_open(source)
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(source)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
end

# Waits (ten seconds at most) for a JavaScript condition to hold.
def rv_wait(condition)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < 50 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < 50, "waited for: #{condition}")
end

# The remarks listed in the panel, their words joined.
def rv_listed
  evaluate("[...document.querySelectorAll('[data-review-list] [data-review-go]')]"
  + ".map((go) => go.textContent).join(' / ')")
end

def rv_count
  evaluate("document.querySelector('[data-review-count]').hidden ? null"
  + " : document.querySelector('[data-review-n]').textContent")
end

def rv_text
  evaluate("document.querySelector('[data-source]').value")
end

describe("The Review (#1022)") do
  test("lists a note out of range, selects it on a click, and an Ignore survives a reload") do
    rv_open(RV_SOURCE)
    rv_wait("!document.querySelector('[data-review-count]').hidden")
    assert_eq(rv_count(), "1")
    click("[data-review-count]")
    rv_wait("!document.querySelector('[data-review]').hidden && document.querySelector('[data-review-go]')")
    assert_contains(rv_listed(), "Bar 2 Violin: F3 is out of its range (the lowest note is G3)")
    assert_eq(evaluate("document.querySelector('[data-review-list] h3').textContent"), "Out of range (1)")
    # A click on the remark selects its note: the violin's, at the second bar's start.
    click("[data-review-go]")
    rv_wait("document.getElementById('studio').studio.sel?.staff === 0")
    assert_eq(
      evaluate("JSON.stringify(document.getElementById('studio').studio.sel)"),
      "{\"staff\":0,\"t0\":80640,\"t1\":80640,\"head\":-1}"
    )
    assert_contains(evaluate("document.querySelector('[data-state]').textContent"), "F3")
    # Ignore: set aside, kept on the settings line, the count gone.
    click("[data-review-ignore]")
    rv_wait("document.querySelector('[data-review-none]') && !document.querySelector('[data-review-none]').hidden")
    assert_eq(rv_listed(), "")
    assert_eq(rv_count(), nil)
    assert_contains(rv_text(), "\"review\":{\"0\":[\"low:80640\"]}")
    # Reloaded: the draft's text keeps it aside.
    visit("/playground")
    wait_for("[data-source]")
    rv_wait("document.getElementById('studio').studio.score")
    sleep(0.8)
    assert_eq(rv_count(), nil)
    evaluate("document.querySelector('.studio-dropdown-items [data-act=\"review\"]').click()")
    rv_wait("!document.querySelector('[data-review]').hidden")
    assert_eq(rv_listed(), "")
    click("[data-review-ignored]")
    rv_wait("document.querySelector('[data-review-go]')")
    assert_contains(rv_listed(), "Violin: F3 is out of its range")
    assert_eq(evaluate("document.querySelector('[data-review-ignore]').textContent"), "Show again")
    # Shown again: one Undo away, and the setting gone from the line.
    click("[data-review-ignore]")
    rv_wait("!document.querySelector('[data-review-count]').hidden")
    assert_not(rv_text().contains("\"review\""), "the settings line holds no remark set aside")
    assert_no_page_errors()
  end

  test("lists a bar the text wrote short, and a click selects that bar") do
    rv_open(RV_SHORT)
    rv_wait("!document.querySelector('[data-review-count]').hidden")
    click("[data-review-count]")
    rv_wait("document.querySelector('[data-review-go]')")
    assert_eq(rv_listed(), "Bar 2 Flute: 3 beats instead of 4 (4/4)")
    assert(
      evaluate("document.querySelector('[data-review-count]').classList.contains('studio-review-errors')"),
      "an error is counted in red"
    )
    click("[data-review-go]")
    rv_wait("document.getElementById('studio').studio.sel?.bars")
    assert_eq(evaluate("JSON.stringify(document.getElementById('studio').studio.sel.bars)"), "[1,1]")
    # The panel closes, and opens again from its button.
    click("[data-review-close]")
    rv_wait("document.querySelector('[data-review]').hidden")
    assert_no_page_errors()
  end
end
