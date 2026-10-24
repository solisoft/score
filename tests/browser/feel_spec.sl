# Edit ▸ Quantize and Play ▸ Swing and humanize in a real browser (soli test
# --browser): quantize and written swing are one edit each, which Undo takes
# back; swing and humanize played are kept in the text's meta line.

# Replaces the source box's text as typing does, then leaves it.
def feel_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

def feel_text
  evaluate("document.querySelector('[data-source]').value")
end

def feel_click(selector)
  evaluate("document.querySelector(#{JSON.stringify(selector)}).click()")
  sleep(0.4)
end

# Moves a slider of a dialog to `value`, as dragging it does.
def feel_slide(name, value)
  evaluate("(() => { const input = document.querySelector('[data-#{name}]'); input.value = '#{value}';"
  + " input.dispatchEvent(new Event('input', { bubbles: true })); })()")
end

describe("Quantize, swing and humanize, in a browser") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
  end

  test("quantize moves the notes off the eighths onto them, their accent with them, in one Undo") do
    feel_source("{ \\time 4/4 r32 c'8..-> d'8.. e'32 r8 f'4 r8 }")
    feel_click("[data-act='quantize']")
    wait_for("[data-quantize-apply]")
    assert_text("What moves: the whole score")
    assert_eq(evaluate("document.querySelector('[data-quantize-grid]').value"), "eighth")
    feel_click("[data-quantize-apply]")
    assert_text("2 notes moved to eighths")
    assert_contains(feel_text(), "c'8..-> r32 d'8.. r32 e'32")
    assert_eq(evaluate("String(document.querySelector('dialog.studio-quantize').open)"), "false")
    feel_click(".studio-dropdown-items [data-act='undo']")
    assert_contains(feel_text(), "r32 c'8..-> d'8.. e'32")
    assert_no_page_errors()
  end

  test("quantize is refused with nothing to read, and moves nothing already on the grid") do
    feel_source("{ \\time 4/4 c'8 d' e' f' g'2 }")
    feel_click("[data-act='quantize']")
    wait_for("[data-quantize-apply]")
    feel_click("[data-quantize-apply]")
    assert_text("nothing moved")
    assert_contains(feel_text(), "c'8 d'8 e'8 f'8 g'2")
  end

  test("swing and humanize are kept in the meta line, which Undo takes back") do
    feel_source("{ \\time 4/4 c'8 d' e' f' g'2 }")
    feel_click("[data-act='swing']")
    wait_for("[data-feel-apply]")
    feel_slide("swing-amount", 66)
    feel_slide("humanize-time", 15)
    feel_slide("humanize-velocity", 8)
    feel_click("[data-feel-apply]")
    assert_text("Played with swing 66 % on eighths, humanized ±15 ms, ±8 %")
    assert_contains(
      feel_text(),
      "%% eui-score {\"swing\":{\"amount\":66,\"unit\":8},\"humanize\":{\"time\":15,\"velocity\":8,\"seed\":1}}"
    )
    # The notes are as written.
    assert_contains(feel_text(), "c'8 d'8 e'8 f'8 g'2")
    # A new take: another seed, the same settings.
    feel_click("[data-act='swing']")
    feel_click("[data-feel-act='seed']")
    assert_contains(feel_text(), "\"seed\":2")
    # Back to straight: the keys go, and with nothing left, the line.
    feel_click("[data-act='swing']")
    assert_eq(evaluate("document.querySelector('[data-swing-amount]').value"), "66")
    feel_slide("swing-amount", 50)
    feel_slide("humanize-time", 0)
    feel_slide("humanize-velocity", 0)
    feel_click("[data-feel-apply]")
    assert_eq(feel_text().includes?("eui-score"), false)
    feel_click(".studio-dropdown-items [data-act='undo']")
    assert_contains(feel_text(), "\"swing\":{\"amount\":66")
    assert_no_page_errors()
  end

  test("swing written into the notes: even eighths become triplets") do
    feel_source("{ \\time 4/4 c'8 d' e' f' g'2 }")
    feel_click("[data-act='swing']")
    wait_for("[data-feel-act='write-triplet']")
    feel_click("[data-feel-act='write-triplet']")
    assert_text("2 pairs of eighths written as triplets")
    assert_contains(feel_text(), "\\tuplet 3/2 { c'4 d'8 } \\tuplet 3/2 { e'4 f'8 } g'2")
    assert_no_page_errors()
  end

  test("the metronome's clicks and accent are in the Playback section, kept from one visit to the next") do
    evaluate("(() => { const menu = document.querySelector('[data-play=\"subdivide\"]'); menu.value = '16';"
    + " menu.dispatchEvent(new Event('change', { bubbles: true })); })()")
    feel_click("[data-play='accent']")
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    assert_eq(evaluate("document.querySelector('[data-play=\"subdivide\"]').value"), "16")
    assert_eq(evaluate("document.querySelector('[data-play=\"accent\"]').checked"), false)
  end
end
