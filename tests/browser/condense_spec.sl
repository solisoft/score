# Two desks on one staff (#1021), in a real browser: Format ▸ Condense with the
# staff below sets two flutes as the two parts of a \partCombine — one undo
# away — File ▸ Parts then lists each desk as a part of its own, a passage is
# set apart from the menu, Split puts the two staves back; what cannot share a
# staff is refused on the status line; a divisi is written over a selected bar.

const CD_SOURCE = "\\header { title = \"Winds\" }\n"
+ "<< \\new Staff \\with { instrumentName = \"Flute 1\" } { \\time 4/4 c''4 d'' e'' f'' | g''1 | r1 }"
+ " \\new Staff \\with { instrumentName = \"Flute 2\" } { c''4 b' c'' d'' | r1 | e''2 e'' }"
+ " \\new Staff \\with { instrumentName = \"Bassoon\" } { \\clef bass <c e>2 <d f>2 | d1 | e1 } >>\n"

# The playground opened on the three winds, the score focused.
def cd_open
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(CD_SOURCE)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
  evaluate("document.querySelector('.studio-sheet').focus()")
end

def cd_text
  evaluate("document.querySelector('[data-source]').value")
end

def cd_status
  evaluate("document.querySelector('[data-status]').textContent")
end

# Waits (ten seconds at most) for a JavaScript condition to hold.
def cd_wait(condition)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < 50 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < 50, "waited for: #{condition}")
end

# A real click on the first head of the drawn item standing for lane `lane`'s event `index`;
# with `shift`, the selection reaches to it.
def cd_click(lane, index, shift)
  point = JSON.parse(evaluate("(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const k = st.items.findIndex((it) => it.staff === #{lane} && it.index === #{index});"
  + " const item = st.view.items.find((it) => it.item === k);"
  + " const h = item.heads[0].box;"
  + " return JSON.stringify({ x: svg.left + (h[0] + h[2]) / 2 * scale,"
  + " y: svg.top + ((h[1] + h[3]) / 2 - (st.view.y0 ?? 0)) * scale }); })()"))
  for kind in ["pointerdown", "pointerup"]
    evaluate("document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent(#{JSON.stringify(kind)},"
    + " { clientX: #{point["x"]}, clientY: #{point["y"]}, pointerId: 1, bubbles: true, button: 0,"
    + " shiftKey: #{shift} }))")
    sleep(0.2)
  end
end

# Format ▸ the item `selector` names: the menu opened by its title, the item clicked in it.
def cd_format(selector)
  evaluate("(() => { for (const menu of document.querySelectorAll('.studio-dropdown[open]')) menu.open = false; })()")
  click(".studio-dropdown:has([data-act=\"condense\"]) > summary")
  cd_wait("document.querySelector('.studio-dropdown:has([data-act=\"condense\"])').open")
  click(".studio-dropdown-items #{selector}")
  sleep(0.6)
end

# What the engraver says it drew on the score: its staves, and each one's notes and rests.
def cd_drawn
  evaluate("document.querySelector('.studio-svg svg desc').textContent")
end

# The names File ▸ Parts offers, joined.
def cd_parts
  evaluate("[...document.querySelectorAll('[data-parts-staff] option')].map((item) => item.textContent).join(' | ')")
end

# What the read page saves, caught as its link is clicked: each file's name and text, in window.deskFiles.
# The page scrolls smoothly (application.css); a click scrolls its button into view and reads its place at
# once, so the part's button, below the fold, was clicked where it no longer was and nothing was saved
# (#1033, as in part_layout_spec, #1018). Scrolled at once, the click lands on it.
const CD_SAVES = """
(() => {
  document.documentElement.style.scrollBehavior = "auto";
  window.deskFiles = [];
  HTMLAnchorElement.prototype.click = function () {
    const file = { name: this.download, text: null };
    window.deskFiles.push(file);
    fetch(this.href).then((r) => r.text()).then((t) => { file.text = t; });
  };
})()
"""

const CD_CONDENSED = "\\header { title = \"Winds\" }\n"
+ "fluteI = { c''4 d'' e'' f'' | g''1 | r1 }\nfluteII = { c''4 b' c'' d'' | r1 | e''2 e'' }\n"
+ "<< \\new Staff \\with { instrumentName = \"Flute 1.2\" } { \\partCombine \\fluteI \\fluteII }"
+ " \\new Staff \\with { instrumentName = \"Bassoon\" } { \\clef bass c1 | d1 | e1 } >>\n"
+ "%% eui-score {\"desks\":{\"0\":{\"names\":[\"Flûte solo\",\"Flute 2\"]}},"
+ "\"parts\":{\"1\":{\"breaks\":{\"0\":\"line\"}}}}\n"

# The text of the part of lane `lane`, as the read page saves it; nil when none comes.
def cd_read_part(lane)
  evaluate("window.deskFiles.length = 0")
  select_option("[data-read-part-staff]", lane)
  click("[data-read-part-ly]")
  for tries in range(0, 50)
    text = evaluate("(window.deskFiles[0] || {}).text ?? null")
    return text unless text.nil?

    sleep(0.2)
  end
  nil
end

describe("Two desks on one staff, on the read page (#1021)") do
  before_each() do
    logout()
  end

  test("a guest is offered each desk's part, named as its staff was, with that desk's notes and layout alone") do
    owner = User.new()
    owner.email = "cd-#{uuid_v4}@example.com"
    owner.set_password("correct horse battery")
    owner.confirmed_at = DateTime.utc.to_unix
    owner.save
    score = Score.start(owner, CD_CONDENSED)
    score.make_visible("link")
    visit("/s/#{score.share_token}")
    assert_selector("[data-read-exports]")
    evaluate(CD_SAVES)
    click("[data-read-parts]")
    wait_for("[data-read-part]:not([hidden])")
    assert_eq(
      evaluate("[...document.querySelectorAll('[data-read-part-staff] option')].map((item) => item.textContent)"
      + ".join(' | ')"),
      "Flûte solo | Flute 2 | Bassoon"
    )
    second = cd_read_part("1")
    assert_not_null(second, "the second desk's part saved")
    assert_contains(second, "instrument = \"Flute 2\"")
    assert_contains(second, "c''4 b'4 c''4 d''4 | \\break R1 | e''2 e''2")
    assert_not(second.contains("partCombine"), "one desk alone on its staff")
    assert_not(second.contains("g''1"), "nothing of the first desk's")
    first = cd_read_part("0")
    assert_not_null(first, "the first desk's part saved")
    assert_contains(first, "instrument = \"Flûte solo\"")
    assert_contains(first, "c''4 d''4 e''4 f''4 | g''1 | R1")
    assert_not(first.contains("\\break"), "the second desk's break is not the first's")
    assert_no_page_errors()
  end
end

describe("Two desks on one staff, in the browser (#1021)") do
  before_each() do
    cd_open()
  end

  test("two flutes condensed on one staff, one undo away; each desk is a part; a passage set apart; split again") do
    assert(evaluate("Boolean(document.getElementById('studio').studio.score)"), "the score is the model's")
    before = cd_text()
    assert_eq(evaluate("document.getElementById('studio').studio.view.staves?.length ?? 3"), 3)
    cd_click(0, 1, false)
    cd_format("[data-act=\"condense\"]")
    condensed = cd_text()
    assert_contains(condensed, "fluteI = {\n  c''4 d''4 e''4 f''4 | g''1 | r1\n}")
    assert_contains(condensed, "fluteII = {\n  c''4 b'4 c''4 d''4 | r1 | e''2 e''2\n}")
    assert_contains(condensed, "instrumentName = \"Flute 1.2\"")
    # What it prints over a part alone and both as one, in the editor's language (English here).
    assert_contains(condensed, "soloText = \"1.\" soloIIText = \"2.\" aDueText = \"a2\"")
    assert_contains(condensed, "\\partCombine \\fluteI \\fluteII")
    assert_contains(condensed, "\"desks\":{\"0\":{\"names\":[\"Flute 1\",\"Flute 2\"]")
    assert_contains(cd_status(), "Two staves on one: Flute 1.2")
    # Drawn on one staff: what both play is drawn once (the engraver marks it a2 itself).
    assert_contains(cd_drawn(), "2 staves, 3 bars. Flute 1.2: no sharps or flats, 4/4, 7 notes")
    assert_eq(
      evaluate("document.getElementById('studio').studio.score.staves.filter((lane) => !lane.voice).length"),
      2
    )
    # File ▸ Parts: one part a desk, and the bassoon's; the second desk's is its notes alone.
    click(".studio-dropdown:first-child > summary")
    click(".studio-dropdown-items [data-act=\"parts\"]")
    cd_wait("document.querySelector('[data-parts]').open && document.querySelector('[data-parts-preview] svg')")
    assert_eq(cd_parts(), "Flute 1 | Flute 2 | Bassoon")
    select_option("[data-parts-staff]", "1")
    sleep(0.4)
    # Its six notes and its bar of rest, on one staff: nothing of the first desk's.
    assert_contains(
      evaluate("document.querySelector('[data-parts-preview] svg desc').textContent"),
      "1 staff, 3 bars. Staff 1: no sharps or flats, 4/4, 6 notes, 1 rest."
    )
    # A break in the second desk's part alone.
    fill_in("[data-parts-bar]", "1")
    click("[data-parts-break=\"line\"]")
    cd_wait("document.querySelector('[data-parts-breaks] li')")
    assert_contains(cd_text(), "\"parts\":{\"1\":{\"breaks\":{\"0\":\"line\"}}}")
    select_option("[data-parts-staff]", "0")
    sleep(0.3)
    assert_eq(evaluate("document.querySelectorAll('[data-parts-breaks] li').length"), 0)
    click("[data-parts-close]")
    cd_wait("!document.querySelector('[data-parts]').open")
    press("Ctrl+z")
    sleep(0.5)
    assert_eq(cd_text(), condensed)
    # The first bar set apart, from its first note to its last: two voices, no a2 over it.
    evaluate("document.querySelector('.studio-sheet').focus()")
    cd_click(0, 0, false)
    cd_click(0, 3, true)
    cd_format("[data-act=\"combine-mode\"][data-mode=\"apart\"]")
    assert_contains(
      cd_text(),
      "fluteI = {\n  \\partCombineApart c''4 d''4 e''4 f''4 | \\partCombineAutomatic g''1 | r1\n}"
    )
    assert_contains(cd_status(), "set apart")
    assert_contains(cd_drawn(), "Flute 1.2: no sharps or flats, 4/4, 11 notes")
    press("Ctrl+z")
    sleep(0.5)
    assert_eq(cd_text(), condensed)
    # One undo: the three staves as they were, to the letter. Redo, then Split: the same.
    press("Ctrl+z")
    sleep(0.5)
    assert_eq(cd_text(), before)
    press("Ctrl+y")
    sleep(0.5)
    assert_eq(cd_text(), condensed)
    cd_click(0, 0, false)
    cd_format("[data-act=\"split-staves\"]")
    assert_eq(cd_text(), before)
    assert_contains(cd_status(), "One staff for each part again")
    assert_no_page_errors()
  end

  test("what cannot share a staff is refused and changes nothing; a divisi is written over the selected bar") do
    before = cd_text()
    # The second flute and the bassoon read different clefs.
    cd_click(1, 0, false)
    cd_format("[data-act=\"condense\"]")
    assert_contains(cd_status(), "different clefs")
    assert_eq(cd_text(), before)
    # A staff of one part does not split, nor is it set apart.
    cd_format("[data-act=\"split-staves\"]")
    assert_contains(cd_status(), "only a staff of two parts splits")
    cd_format("[data-act=\"combine-mode\"][data-mode=\"apart\"]")
    assert_contains(cd_status(), "holds one part")
    assert_eq(cd_text(), before)
    # The bassoon's first bar divided: its chords' upper notes above, the lower below, div. and unis.
    cd_click(2, 0, false)
    cd_format("[data-act=\"divisi\"]")
    assert_contains(cd_text(), "<< { e2^\"div.\" f2 } \\\\ { c2 d2 } >> | d1^\"unis.\" | e1")
    assert_contains(cd_status(), "Bar 1 divided")
    press("Ctrl+z")
    sleep(0.5)
    assert_eq(cd_text(), before)
    assert_no_page_errors()
  end
end
