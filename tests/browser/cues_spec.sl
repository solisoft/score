# Cues (#1023), in a real browser: the oboe comes back after five bars of
# rest; the Review proposes a cue from the flute over the two bars before,
# "Add" writes it small over the rests — one Undo takes it away — and once
# it is there, "Remove cue" takes it back out.

const CU_SOURCE = "\\header { title = \"Cues\" }\n<< "
+ "\\new Staff \\with { instrumentName = \"Oboe\" midiInstrument = \"oboe\" }"
+ " { c''1\\mf | R1 | R1 | R1 | R1 | R1 | d''1 }"
+ " \\new Staff \\with { instrumentName = \"Flute\" midiInstrument = \"flute\" }"
+ " { g''4\\f a''4 b''4 c'''4 | d'''1 | e'''1 | f'''1 | g'''1 | a''4 b''4 c'''4 d'''4 | e'''1 } >>"

def cu_open
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(CU_SOURCE)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

def cu_text
  evaluate("document.querySelector('[data-source]').value")
end

# The Review opened, as its button does.
def cu_review
  evaluate("document.querySelector('.studio-dropdown-items [data-act=\"review\"]').click()")
  sleep(0.6)
end

def cu_cue_button
  evaluate("document.querySelector('[data-review-list] [data-rule=\"cue\"] [data-review-cue]')?.textContent ?? null")
end

describe("Cues proposed by the Review, in a browser") do
  before_each() do
    cu_open()
  end

  test("the cue proposed, added over the rests, one Undo away, then removed") do
    cu_review()
    assert_contains(
      evaluate("document.querySelector('[data-review-list] [data-rule=\"cue\"]').textContent"),
      "Oboe comes back after 5 bars of rest: a cue from Flute over the bars before"
    )
    assert_eq(cu_cue_button(), "Add")
    evaluate("document.querySelector('[data-review-list] [data-rule=\"cue\"] [data-review-cue]').click()")
    sleep(0.8)
    assert_contains(
      cu_text(),
      "<< { r1 } \\new CueVoice { g''1 } >> | << { r1 } \\new CueVoice { a'4 b'4 c''4 d''4 } >>"
    )
    assert_eq(cu_cue_button(), "Remove cue")
    press("Ctrl+z")
    sleep(0.8)
    assert_not(cu_text().includes?("CueVoice"))
    press("Ctrl+y")
    sleep(0.8)
    assert_contains(cu_text(), "CueVoice")
    evaluate("document.querySelector('[data-review-list] [data-rule=\"cue\"] [data-review-cue]').click()")
    sleep(0.8)
    assert_not(cu_text().includes?("CueVoice"))
    assert_eq(cu_cue_button(), "Add")
    assert_no_page_errors()
  end
end
