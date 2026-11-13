# The embedded score in a real browser (soli test --browser, #834): the
# element is <score-sheet>, and <eui-score>, its first name, is the same
# element — a page that embeds it keeps working.

# Waits (`seconds` at most) for a JavaScript condition to hold.
def sheet_wait(condition, seconds = 20)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < seconds * 5 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < seconds * 5, "waited for: #{condition}")
end

# Puts `tag` with `source` on the page (its id probe-`name`), the module loaded, and answers once
# it has engraved: "svg" when it drew a score, else the message it shows.
def sheet_engraved(tag, source, name)
  evaluate("(async () => { const v = JSON.parse(document.getElementById('embed-data').textContent).v;"
  + " await import(`/eui-score/eui-score.js?v=${v}`);"
  + " const el = document.createElement('#{tag}'); el.id = 'probe-#{name}';"
  + " el.textContent = #{JSON.stringify(source)}; document.body.appendChild(el); return 1; })()")
  sheet_wait("document.querySelector('#probe-#{name} > svg, #probe-#{name} > .eui-score-error')")
  evaluate("(() => { const el = document.querySelector('#probe-#{name}');"
  + " return el.querySelector('svg') ? 'svg' : el.textContent; })()")
end

describe("<score-sheet> and its first name (#834)") do
  test("the embed page's scores are <score-sheet> elements, drawn") do
    visit("/embed")
    sheet_wait("document.querySelectorAll('score-sheet > svg').length >= 3")
    assert_eq(evaluate("customElements.get('score-sheet') !== undefined"), true)
    assert_eq(evaluate("document.querySelectorAll('eui-score').length"), 0)
    assert_eq(evaluate("getComputedStyle(document.querySelector('score-sheet')).display"), "block")
    assert_no_page_errors()
  end

  test("<eui-score> is still an element that draws its score, and both refuse alike") do
    visit("/embed")
    assert_eq(sheet_engraved("eui-score", "{ c'4 d' e' f' }", "old"), "svg")
    assert_eq(sheet_engraved("score-sheet", "{ c'4 d' e' f' }", "new"), "svg")
    assert_eq(evaluate("customElements.get('eui-score') !== customElements.get('score-sheet')"), true)
    assert_eq(evaluate("document.querySelector('#probe-old') instanceof customElements.get('score-sheet')"), true)
    refused = sheet_engraved("score-sheet", "{ c'4 \\\\nope }", "refused")
    assert_contains(refused, "score:")
    assert_no_page_errors()
  end
end
