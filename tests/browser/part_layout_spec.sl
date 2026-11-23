# A part laid out on its own (#1018), in a real browser: File ▸ Parts sets a
# break and a staff size for one instrument, kept on the score's settings line
# — found again once the dialog, then the page, is opened again — while the
# score's own layout and the other part stay as they were; a break that
# cannot be is refused in the dialog; Undo takes each change back.

const PL_SOURCE = "\\header { title = \"Duo\" }\n"
+ "<< \\new Staff \\with { instrumentName = \"Flute\" } { \\time 4/4 c''1 | d''1 | e''1 | f''1 }"
+ " \\new Staff \\with { instrumentName = \"Bass\" } { \\clef bass c1 | d1 | e1 | f1 } >>\n"

# The playground opened on the duo.
def pl_open
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(PL_SOURCE)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
end

def pl_text
  evaluate("document.querySelector('[data-source]').value")
end

# Waits (ten seconds at most) for a JavaScript condition to hold.
def pl_wait(condition)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < 50 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < 50, "waited for: #{condition}")
end

# File ▸ Parts…, as the menu's item does, then the instrument of lane `lane` chosen.
def pl_parts(lane)
  evaluate("document.querySelector('.studio-dropdown-items [data-act=\"parts\"]').click()")
  pl_wait("document.querySelector('[data-parts]').open && document.querySelector('[data-parts-preview] svg')")
  select_option("[data-parts-staff]", lane)
  sleep(0.3)
end

def pl_close
  click("[data-parts-close]")
  pl_wait("!document.querySelector('[data-parts]').open")
end

# What the dialog shows of the part: its breaks' words, joined.
def pl_breaks
  evaluate("[...document.querySelectorAll('[data-parts-breaks] li span')].map((item) => item.textContent).join('; ')")
end

def pl_field(name)
  evaluate("document.querySelector('[data-parts-field=\"#{name}\"]').value")
end

def pl_status
  evaluate("document.querySelector('[data-parts-status]').textContent")
end

# The preview's height: a part on more lines is taller.
def pl_preview_height
  evaluate("document.querySelector('[data-parts-preview] svg').viewBox.baseVal.height")
end

# What the read page saves, caught as its link is clicked: each file's name and text, in window.partFiles.
const PL_SAVES = """
(() => {
  window.partFiles = [];
  HTMLAnchorElement.prototype.click = function () {
    const file = { name: this.download, text: null };
    window.partFiles.push(file);
    fetch(this.href).then((r) => r.text()).then((t) => { file.text = t; });
  };
})()
"""

# The text of the part of lane `lane`, as the read page saves it; nil when none comes.
def pl_read_part(lane)
  evaluate("window.partFiles.length = 0")
  select_option("[data-read-part-staff]", lane)
  click("[data-read-part-ly]")
  for tries in range(0, 50)
    text = evaluate("(window.partFiles[0] || {}).text ?? null")
    return text unless text.nil?

    sleep(0.2)
  end
  nil
end

describe("A part's own layout, on the read page (#1018)") do
  before_each() do
    logout()
  end

  test("a guest's part is laid out as its owner set it; the other part, and the score, are not") do
    owner = User.new()
    owner.email = "pl-#{uuid_v4}@example.com"
    owner.set_password("correct horse battery")
    owner.confirmed_at = DateTime.utc.to_unix
    owner.save
    layout = "%% eui-score {\"parts\":{\"1\":{\"breaks\":{\"1\":\"line\"},\"staffSize\":16}}}\n"
    score = Score.start(owner, PL_SOURCE + layout)
    score.make_visible("link")
    visit("/s/#{score.share_token}")
    assert_selector("[data-read-exports]")
    evaluate(PL_SAVES)
    click("[data-read-parts]")
    wait_for("[data-read-part]:not([hidden])")
    bass = pl_read_part("1")
    assert_not_null(bass, "the bass's part saved")
    assert_contains(bass, "\\clef bass")
    assert_contains(bass, "#(set-global-staff-size 16)")
    assert_contains(bass, "d1 | \\break e1")
    assert_not(bass.contains("\"parts\""), "laid out, the part carries the setting no more")
    flute = pl_read_part("0")
    assert_not_null(flute, "the flute's part saved")
    assert_contains(flute, "c''1")
    assert_not(flute.contains("\\break"))
    assert_not(flute.contains("set-global-staff-size"))
    assert_no_page_errors()
  end
end

describe("A part's own layout, in the browser (#1018)") do
  before_each() do
    pl_open()
  end

  test("a break and a staff size set for one part are kept and found again; the score and the other part stay") do
    pl_parts("1")
    assert_eq(pl_breaks(), "")
    assert_eq(pl_field("staffSize"), "")
    assert_eq(evaluate("document.querySelector('[data-parts-reset]').disabled"), true)
    one_line = pl_preview_height()
    fill_in("[data-parts-bar]", "2")
    click("[data-parts-break='line']")
    pl_wait("document.querySelector('[data-parts-breaks] li')")
    assert_eq(pl_breaks(), "New line after bar 2")
    assert_eq(pl_status(), "A new line after bar 2, in this part alone.")
    # The preview is the part on two lines now.
    pl_wait("document.querySelector('[data-parts-preview] svg').viewBox.baseVal.height > #{one_line}")
    two_lines = pl_preview_height()
    select_option("[data-parts-field='staffSize']", "16")
    pl_wait("document.querySelector('[data-source]').value.includes('\"staffSize\":16')")
    # The flute's part has none of it.
    select_option("[data-parts-staff]", "0")
    sleep(0.3)
    assert_eq(pl_breaks(), "")
    assert_eq(pl_field("staffSize"), "")
    assert_lt(pl_preview_height(), two_lines, "the flute's part is on one line still")
    pl_close()
    # Kept on the settings line; the score's music and page are as they were.
    assert_contains(pl_text(), "%% eui-score {\"parts\":{\"1\":{\"breaks\":{\"1\":\"line\"},\"staffSize\":16}}}")
    assert_not(pl_text().contains("\\break"))
    assert_not(pl_text().contains("set-global-staff-size"))
    assert_not(pl_text().contains("\\paper"))
    # Opened again, the dialog shows it; and again once the page is loaded anew, from the draft.
    pl_parts("1")
    assert_eq(pl_breaks(), "New line after bar 2")
    assert_eq(pl_field("staffSize"), "16")
    pl_close()
    sleep(1.0)
    visit("/playground")
    wait_for("[data-source]")
    pl_wait("document.querySelector('[data-source]').value.includes('\"parts\"')")
    pl_parts("1")
    assert_eq(pl_breaks(), "New line after bar 2")
    assert_eq(pl_field("staffSize"), "16")
    assert_gt(pl_preview_height(), one_line)
    assert_no_page_errors()
  end

  test("a break that cannot be is refused in the dialog, and nothing is written") do
    before = pl_text()
    pl_parts("0")
    fill_in("[data-parts-bar]", "4")
    click("[data-parts-break='page']")
    pl_wait("document.querySelector('[data-parts-status]').textContent")
    assert_eq(pl_status(), "a break goes after a bar, before the last one ends")
    assert_eq(pl_breaks(), "")
    # No bar number at all is refused the same way.
    fill_in("[data-parts-bar]", "")
    click("[data-parts-break='line']")
    sleep(0.3)
    assert_eq(pl_status(), "a break goes after a bar, before the last one ends")
    pl_close()
    assert_eq(pl_text(), before)
    assert_no_page_errors()
  end

  test("Undo takes a part's breaks back; a break goes by its button, and Reset gives the part back to the score") do
    before = pl_text()
    pl_parts("0")
    fill_in("[data-parts-bar]", "1")
    click("[data-parts-break='page']")
    pl_wait("document.querySelector('[data-parts-breaks] li')")
    assert_eq(pl_breaks(), "New page after bar 1")
    fill_in("[data-parts-bar]", "3")
    click("[data-parts-break='line']")
    pl_wait("document.querySelectorAll('[data-parts-breaks] li').length === 2")
    click("[data-parts-remove='0']")
    pl_wait("document.querySelectorAll('[data-parts-breaks] li').length === 1")
    assert_eq(pl_breaks(), "New line after bar 3")
    pl_close()
    assert_contains(pl_text(), "{\"parts\":{\"0\":{\"breaks\":{\"2\":\"line\"}}}}")
    # Three edits, each undone in turn: the removal, the second break, the first.
    evaluate("document.querySelector('.studio-dropdown-items [data-act=\"undo\"]').click()")
    sleep(0.3)
    assert_contains(pl_text(), "{\"parts\":{\"0\":{\"breaks\":{\"0\":\"page\",\"2\":\"line\"}}}}")
    evaluate("document.querySelector('.studio-dropdown-items [data-act=\"undo\"]').click()")
    sleep(0.3)
    assert_contains(pl_text(), "{\"parts\":{\"0\":{\"breaks\":{\"0\":\"page\"}}}}")
    evaluate("document.querySelector('.studio-dropdown-items [data-act=\"undo\"]').click()")
    sleep(0.3)
    assert_eq(pl_text(), before)
    # Reset: the part's own layout goes whole.
    pl_parts("0")
    select_option("[data-parts-field='systemsPerPage']", "3")
    pl_wait("document.querySelector('[data-source]').value.includes('\"systemsPerPage\":3')")
    click("[data-parts-reset]")
    pl_wait("!document.querySelector('[data-source]').value.includes('\"parts\"')")
    assert_eq(pl_status(), "This part is laid out as the score is.")
    assert_eq(pl_field("systemsPerPage"), "")
    pl_close()
    assert_eq(pl_text(), before)
    assert_no_page_errors()
  end
end
