# A staff's own \transposition (#1023), in a real browser: a clarinet part
# written with \transposition bes opens as it sounds, an edit writes its text
# back with the command and its notes as written, and View ▸ Written pitch
# finds it transposing although nothing in its name says so.

const TR_SOURCE = "\\header { title = \"Part\" }\n"
+ "\\new Staff { \\clef treble \\time 4/4 \\transposition bes \\key d \\major d'4 e'4 fis'4 g'4 | a'1 }"

def tr_open
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(TR_SOURCE)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
  evaluate("document.querySelector('.studio-sheet').focus()")
end

def tr_text
  evaluate("document.querySelector('[data-source]').value")
end

def tr_status
  evaluate("document.querySelector('[data-status]').textContent")
end

describe("A staff's own \\transposition, in a browser") do
  before_each() do
    tr_open()
  end

  test("opened as it sounds, edited, and written back with its \\transposition and its written notes") do
    first = evaluate("(() => { const st = document.getElementById('studio').studio;"
    + " return st.score.staves[0].events[0].pitches[0].d; })()")
    assert_eq(first, 7)
    press("n")
    sleep(0.3)
    evaluate("document.getElementById('studio').studio.input.t = 161280")
    # Concert A4: written B4.
    press("a")
    sleep(0.4)
    assert_contains(tr_text(), "\\transposition bes")
    assert_contains(tr_text(), "d'4 e'4 fis'4 g'4 | b'4")
    assert_no_page_errors()
  end

  test("View ▸ Written pitch finds the staff written apart from how it sounds") do
    evaluate("document.querySelector('.studio-dropdown-items [data-act=\"written\"]').click()")
    sleep(0.4)
    assert_contains(tr_status(), "transposing instruments as their players read them")
    assert_no_page_errors()
  end
end
