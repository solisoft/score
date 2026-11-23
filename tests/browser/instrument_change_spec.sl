# Insert ▸ Change instrument… (#1023), in a real browser: the flute player
# takes up the clarinet from the fourth bar — the dialog opens there, the
# change is written with "To Cl." in the rests and \transposition bes, one
# Undo takes it back; at the very start it is refused, and nothing written.

const IC_SOURCE = "\\header { title = \"Doubling\" }\n"
+ "\\new Staff \\with { instrumentName = \"Flute\" midiInstrument = \"flute\" }"
+ " { \\time 4/4 c''4 d''4 e''4 f''4 | R1 | R1 | c''4 d''4 e''4 f''4 }"

def ic_open
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(IC_SOURCE)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

def ic_text
  evaluate("document.querySelector('[data-source]').value")
end

# The first note or rest of bar `bar` (from 0) selected.
def ic_select(bar)
  evaluate("(() => { const st = document.getElementById('studio').studio; const at = 80640 * #{bar};"
  + " st.sel = { staff: 0, t0: at, t1: at, head: -1 }; })()")
end

def ic_status
  evaluate("document.querySelector('[data-status]').textContent")
end

describe("Insert ▸ Change instrument…, in a browser") do
  before_each() do
    ic_open()
  end

  test("the flute to the clarinet from bar 4: written with its words and \\transposition, one Undo away") do
    ic_select(3)
    evaluate("document.querySelector('.studio-dropdown-items [data-act=\"instrument-change\"]').click()")
    sleep(0.3)
    assert(evaluate("document.querySelector('[data-instrument-change]').open"))
    assert_contains(evaluate("document.querySelector('[data-instrument-change-where]').textContent"), "4")
    # The drum kit is not offered.
    assert_not(evaluate("[...document.querySelectorAll('[data-instrument-change-choice] option')]"
    + ".some((option) => option.textContent === 'Drum kit')"))
    evaluate("(() => { const choice = document.querySelector('[data-instrument-change-choice]');"
    + " choice.value = [...choice.options].find((option) => option.textContent === 'Clarinet in B♭').value; })()")
    click("[data-act='instrument-change-apply']")
    sleep(0.5)
    assert_not(evaluate("document.querySelector('[data-instrument-change]').open"))
    assert_contains(ic_text(), "r1^\"To Cl.\"")
    assert_contains(
      ic_text(),
      "\\set Staff.midiInstrument = \"clarinet\" \\transposition bes d''4^\"Clarinet in B♭\""
    )
    assert_contains(ic_status(), "One Undo takes it back")
    press("Ctrl+z")
    sleep(0.4)
    assert_not(ic_text().includes?("\\transposition"))
    assert_no_page_errors()
  end

  test("at the very start, refused, and nothing written") do
    before = ic_text()
    ic_select(0)
    evaluate("document.querySelector('.studio-dropdown-items [data-act=\"instrument-change\"]').click()")
    sleep(0.3)
    assert_not(evaluate("document.querySelector('[data-instrument-change]').open"))
    assert_contains(ic_status(), "first instrument is its own")
    assert_eq(ic_text(), before)
  end
end
