# Signs moved and reshaped with the pointer (#1020), in a real browser: a
# dynamic, words and an articulation dragged to where they read best, a slur
# reshaped by one of its four points, a hairpin drawn shorter by an end —
# each written as LilyPond writes it, one step to undo, and set back by
# Backspace or "Automatic position". A press that does not move writes
# nothing (a double press still opens a word), a finger selects before it
# drags, and of two signs of one kind on a note only one takes the drag.

const SIGN_DYNAMIC = "{ \\time 4/4 c''4\\mf d''4 e''4_\"dolce\" f''4-> | g'1 }"
const SIGN_SLUR = "{ \\time 4/4 c''4( d''4 e''4 f''4) | g'1 }"
const SIGN_HAIRPIN = "{ \\time 4/4 c''4\\< d''4 e''4 f''4\\! | g'1 }"
const SIGN_PAIR = "{ \\time 4/4 c''4->-. d''4 e''4 f''4 | g'1 }"

# Replaces the source box's text as typing does, then leaves it.
def sign_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
end

def sign_text
  evaluate("document.querySelector('[data-source]').value")
end

def sign_status
  evaluate("document.querySelector('[data-status]').textContent")
end

# Where the sign `on` is on the screen, as a JS expression answering [x, y]:
# the middle of its box, the middle of its curve, or — `handle` 0 to 3 — one
# of its handles.
def sign_at(on, handle = -1)
  "(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width;"
  + " const sign = st.view.signs.find((s) => s.on === #{JSON.stringify(on)});"
  + " const h = sign.handles; const k = #{handle};"
  + " const mid = (a) => (h[0][a] + 3 * h[1][a] + 3 * h[2][a] + h[3][a]) / 8;"
  + " const p = k >= 0 ? h[k] : h && h.length === 4 ? [mid(0), mid(1)]"
  + " : [(sign.box[0] + sign.box[2]) / 2, (sign.box[1] + sign.box[3]) / 2];"
  + " return [svg.left + p[0] * scale, svg.top + (p[1] - (st.view.y0 ?? 0)) * scale]; })()"
end

# The pixels of the screen in a staff space, as a JS expression.
def sign_space
  "(8 * document.getElementById('studio').studio.zoom"
  + " * document.querySelector('.studio-svg svg').getBoundingClientRect().width"
  + " / document.getElementById('studio').studio.view.width)"
end

# A press at `from` (a JS expression answering [x, y]) dragged by so many
# staff spaces to the right and down, and let go: real pointer events, the
# moves a frame apart as a hand's are. `more` goes into each event
# (`shiftKey: true`, `pointerType: 'touch'`).
def sign_drag(from, right, down, more = "")
  evaluate("(() => { const sheet = document.querySelector('.studio-sheet'); const [x, y] = #{from};"
  + " const space = #{sign_space()};"
  + " window.signDrag = { x, y, dx: #{right} * space, dy: #{down} * space };"
  + " const at = { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y, #{more} };"
  + " (document.elementFromPoint(x, y) ?? sheet).dispatchEvent(new PointerEvent('pointerdown', at)); })()")
  sleep(0.15)
  for step in [0.25, 0.6, 1]
    evaluate("(() => { const d = window.signDrag;"
    + " document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent('pointermove',"
    + " { bubbles: true, cancelable: true, pointerId: 1, buttons: 1,"
    + " clientX: d.x + d.dx * #{step}, clientY: d.y + d.dy * #{step}, #{more} })); })()")
    sleep(0.15)
  end
  evaluate("(() => { const d = window.signDrag;"
  + " document.querySelector('.studio-sheet').dispatchEvent(new PointerEvent('pointerup',"
  + " { bubbles: true, cancelable: true, pointerId: 1, clientX: d.x + d.dx, clientY: d.y + d.dy, #{more} })); })()")
  sleep(0.4)
end

# Pointer events at `from` (a JS expression answering [x, y]): `events` is
# JavaScript that sends them, with `sheet`, `x`, `y`, the element `under`
# the point and `at`, an event's settings there. `more` goes into `at`.
def sign_events(from, events, more = "")
  evaluate("(() => { const sheet = document.querySelector('.studio-sheet'); const [x, y] = #{from};"
  + " const under = document.elementFromPoint(x, y) ?? sheet;"
  + " const at = { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y, #{more} };"
  + " #{events} })()")
  sleep(0.4)
end

const SIGN_DOWN_UP = "under.dispatchEvent(new PointerEvent('pointerdown', at));"
+ " sheet.dispatchEvent(new PointerEvent('pointerup', at));"

# A press and its release at `from`, without a move between them.
def sign_press(from, more = "")
  sign_events(from, SIGN_DOWN_UP, more)
end

# Where the head of the `nth` note is on the screen, as a JS expression answering [x, y].
def sign_note_at(nth)
  "(() => { const st = document.getElementById('studio').studio;"
  + " const svg = document.querySelector('.studio-svg svg').getBoundingClientRect();"
  + " const scale = svg.width / st.view.width; const b = st.view.items[#{nth}].heads[0].box;"
  + " return [svg.left + (b[0] + b[2]) / 2 * scale,"
  + " svg.top + ((b[1] + b[3]) / 2 - (st.view.y0 ?? 0)) * scale]; })()"
end

# A key pressed on the score.
def sign_key(key, alt = false)
  evaluate("document.querySelector('.studio-sheet').dispatchEvent(new KeyboardEvent('keydown',"
  + " { key: #{JSON.stringify(key)}, altKey: #{alt}, bubbles: true, cancelable: true }))")
  sleep(0.3)
end

# The selected sign's box on the page: what it is, or nil.
def sign_selected
  evaluate("document.querySelector('.studio-sign-box')?.dataset.sign ?? null")
end

def sign_handles
  evaluate("document.querySelectorAll('.studio-sign-handle').length")
end

def sign_undo
  evaluate("document.querySelector('[data-act=undo]').click()")
  sleep(0.5)
end

describe("Signs moved with the pointer") do
  before_each() do
    viewport(1280, 800)
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
  end

  test("a dynamic is dragged, in its dashed box, to a tenth of a space; Undo takes it back") do
    sign_source(SIGN_DYNAMIC)
    before = sign_text()
    assert_null(sign_selected())
    sign_drag(sign_at("dynamic"), 3, 2)
    # Three spaces right, two down: y counts up in the text.
    assert_contains(sign_text(), "c''4-\\tweak DynamicText.extra-offset #'(3 . -2) \\mf")
    assert_eq(sign_selected(), "dynamic")
    assert_eq(evaluate("getComputedStyle(document.querySelector('.studio-sign-box')).borderTopStyle"), "dashed")
    assert_contains(sign_status(), "3 to the right, -2 up")
    # A dynamic has no handles; moved, it has its way back under it.
    assert_eq(sign_handles(), 0)
    assert_eq(evaluate("document.querySelector('.studio-sign-back button').textContent"), "Automatic position")
    # Dragged again from where it now is: the offsets add up, one tweak.
    sign_drag(sign_at("dynamic"), -1.26, -2)
    assert_contains(sign_text(), "\\tweak DynamicText.extra-offset #'(1.7 . 0) \\mf")
    assert_eq(sign_text().split("extra-offset").length, 2)
    # One Undo a drag.
    sign_undo()
    assert_contains(sign_text(), "#'(3 . -2)")
    sign_undo()
    assert_eq(sign_text(), before)
    assert_no_page_errors()
  end

  test("words and an articulation are dragged; Shift keeps the drag to one axis") do
    sign_source(SIGN_DYNAMIC)
    sign_drag(sign_at("text:dolce"), 2, 1.5)
    assert_contains(sign_text(), "e''4-\\tweak TextScript.extra-offset #'(2 . -1.5) _\"dolce\"")
    assert_eq(sign_selected(), "text:dolce")
    sign_drag(sign_at("art:accent"), 0.5, -3)
    assert_contains(sign_text(), "f''4-\\tweak Script.extra-offset #'(0.5 . 3) ->")
    assert_eq(sign_selected(), "art:accent")
    # With Shift, the longer way alone: up, not sideways.
    sign_source(SIGN_DYNAMIC)
    sign_drag(sign_at("art:accent"), 1, -3, "shiftKey: true")
    assert_contains(sign_text(), "f''4-\\tweak Script.extra-offset #'(0 . 3) ->")
    # The dynamic was not touched by any of it.
    assert_contains(sign_text(), "c''4\\mf")
    assert_no_page_errors()
  end

  test("a press that does not move writes nothing, and a double press still opens the words") do
    sign_source(SIGN_DYNAMIC)
    before = sign_text()
    sign_press(sign_at("text:dolce"))
    assert_eq(sign_selected(), "text:dolce")
    assert_eq(sign_text(), before)
    assert_contains(sign_status(), "The text: drag it")
    # Three pixels are not a drag.
    near = "{ ...at, buttons: 1, clientX: x + 3, clientY: y + 1 }"
    sign_events(
      sign_at("dynamic"),
      "sheet.dispatchEvent(new PointerEvent('pointerdown', at));"
      + " sheet.dispatchEvent(new PointerEvent('pointermove', #{near}));"
      + " sheet.dispatchEvent(new PointerEvent('pointerup', #{near}));"
    )
    assert_eq(sign_selected(), "dynamic")
    assert_eq(sign_text(), before)
    # A press on a note selects the note: the sign's box goes.
    sign_press(sign_note_at(1))
    assert_null(sign_selected())
    assert_eq(evaluate("document.getElementById('studio').studio.sel?.t0 > 0"), true)
    # Two presses on the words open them, as before.
    sign_events(sign_at("text:dolce"), SIGN_DOWN_UP + " " + SIGN_DOWN_UP)
    assert_eq(evaluate("document.querySelector('.studio-words')?.value ?? null"), "dolce")
    assert_eq(sign_text(), before)
    assert_no_page_errors()
  end

  test("Backspace and Automatic position put a moved sign back; Alt+arrows nudge it, one step to undo") do
    sign_source(SIGN_DYNAMIC)
    before = sign_text()
    sign_press(sign_at("dynamic"))
    # Nothing to put back yet: said, nothing written, and the note is no rest.
    sign_key("Backspace")
    assert_contains(sign_status(), "is where the engraver puts it")
    assert_eq(sign_text(), before)
    assert_null(evaluate("document.querySelector('.studio-sign-back')"))
    # Three nudges right and one up, in a row.
    sign_key("ArrowRight", true)
    sign_key("ArrowRight", true)
    sign_key("ArrowRight", true)
    sign_key("ArrowUp", true)
    assert_contains(sign_text(), "\\tweak DynamicText.extra-offset #'(0.3 . 0.1) \\mf")
    assert_eq(sign_selected(), "dynamic")
    # …are one Undo.
    sign_undo()
    assert_eq(sign_text(), before)
    # Moved, then Backspace: back, and that is a step of its own.
    sign_press(sign_at("dynamic"))
    sign_key("ArrowDown", true)
    assert_contains(sign_text(), "#'(0 . -0.1)")
    sign_key("Backspace")
    assert_eq(sign_text(), before)
    assert_contains(sign_status(), "is back where the engraver puts it")
    sign_undo()
    assert_contains(sign_text(), "#'(0 . -0.1)")
    # The button under the sign does the same.
    evaluate("document.querySelector('.studio-sign-back button').click()")
    sleep(0.5)
    assert_eq(sign_text(), before)
    # Without a sign selected, Alt+arrows are not the signs': nothing is written.
    sign_key("Escape")
    assert_null(sign_selected())
    sign_key("ArrowRight", true)
    assert_eq(sign_text(), before)
    assert_no_page_errors()
  end

  test("a slur shows its four points, and one dragged reshapes it; dragged whole, it moves") do
    sign_source(SIGN_SLUR)
    before = sign_text()
    sign_press(sign_at("slur"))
    assert_eq(sign_selected(), "slur")
    assert_eq(sign_handles(), 4)
    assert_eq(sign_text(), before)
    # Its second point, a space and a half up and half a space left.
    sign_drag(sign_at("slur", 1), -0.5, -1.5)
    assert_contains(sign_text(), "c''4-\\shape #'((0 . 0) (-0.5 . 1.5) (0 . 0) (0 . 0)) (")
    assert_eq(sign_handles(), 4)
    assert_contains(sign_status(), "The slur reshaped")
    # Its last point too: the first stays as it was set.
    sign_drag(sign_at("slur", 3), 0, 1)
    assert_contains(sign_text(), "-\\shape #'((0 . 0) (-0.5 . 1.5) (0 . 0) (0 . -1)) (")
    # Taken by its curve, it moves whole, the shape kept.
    sign_drag(sign_at("slur"), 0, -1)
    assert_contains(
      sign_text(),
      "c''4-\\tweak Slur.extra-offset #'(0 . 1) -\\shape #'((0 . 0) (-0.5 . 1.5) (0 . 0) (0 . -1)) ("
    )
    sign_undo()
    sign_undo()
    assert_contains(sign_text(), "c''4-\\shape #'((0 . 0) (-0.5 . 1.5) (0 . 0) (0 . 0)) (")
    # Backspace lets go of the shape too.
    sign_press(sign_at("slur"))
    sign_key("Backspace")
    assert_eq(sign_text(), before)
    # A press on a note under the slur's arch is the note's.
    sign_press(sign_note_at(1))
    assert_null(sign_selected())
    assert_no_page_errors()
  end

  test("a hairpin shows its two ends, drawn in by a drag; it sounds as long as before") do
    sign_source(SIGN_HAIRPIN)
    before = sign_text()
    sign_press(sign_at("hairpin"))
    assert_eq(sign_selected(), "hairpin")
    assert_eq(sign_handles(), 2)
    # The right end, two spaces to the left: only how it is drawn changes.
    sign_drag(sign_at("hairpin", 1), -2, 0.8)
    assert_contains(sign_text(), "c''4-\\tweak Hairpin.shorten-pair #'(0 . 2) \\<")
    assert_contains(sign_text(), "f''4\\!")
    assert_contains(sign_status(), "it sounds as long as before")
    # The left end, a space to the right.
    sign_drag(sign_at("hairpin", 0), 1, 0)
    assert_contains(sign_text(), "\\tweak Hairpin.shorten-pair #'(1 . 2) \\<")
    # Taken by its middle, it moves whole.
    sign_drag(sign_at("hairpin"), 0, 1)
    assert_contains(
      sign_text(),
      "c''4-\\tweak Hairpin.extra-offset #'(0 . -1) -\\tweak Hairpin.shorten-pair #'(1 . 2) \\<"
    )
    sign_key("Backspace")
    assert_eq(sign_text(), before)
    assert_no_page_errors()
  end

  test("a finger selects a sign first, then drags it; a finger's drag elsewhere is left to the scroll") do
    sign_source(SIGN_DYNAMIC)
    before = sign_text()
    touch = "pointerType: 'touch'"
    # A finger dragged from a sign not yet selected moves nothing — the page scrolls — but, let go, selects it.
    sign_drag(sign_at("dynamic"), 3, 2, touch)
    assert_eq(sign_text(), before)
    assert_eq(sign_selected(), "dynamic")
    # Selected, the sign is the finger's: its box alone takes the touch from the scroll.
    assert_eq(evaluate("getComputedStyle(document.querySelector('.studio-sign-box')).position"), "absolute")
    sign_drag(sign_at("dynamic"), 3, 2, touch)
    assert_contains(sign_text(), "\\tweak DynamicText.extra-offset #'(3 . -2) \\mf")
    # A scroll the browser takes over from a tap on another sign selects nothing.
    sign_events(
      sign_at("art:accent"),
      "sheet.dispatchEvent(new PointerEvent('pointerdown', at));"
      + " sheet.dispatchEvent(new PointerEvent('pointercancel', at));",
      touch
    )
    assert_eq(sign_selected(), "dynamic")
    assert_not(sign_text().includes?("Script"))
    assert_no_page_errors()
  end

  test("of two signs of one kind on a note, one takes the drag and the other says so") do
    sign_source(SIGN_PAIR)
    before = sign_text()
    first = evaluate("document.getElementById('studio').studio.view.signs.filter((s) => s.grob === 'Script')[0].on")
    second = evaluate("document.getElementById('studio').studio.view.signs.filter((s) => s.grob === 'Script')[1].on")
    assert_ne(first, second)
    # The other one: selected, greyed, not moved, and the status says which to take.
    sign_drag(sign_at(second), 2, -2)
    assert_eq(sign_text(), before)
    assert_eq(sign_selected(), second)
    assert_eq(evaluate("document.querySelector('.studio-sign-box').classList.contains('studio-sign-held')"), true)
    assert_contains(sign_status(), "moves with the other sign of its kind on this note")
    sign_key("ArrowRight", true)
    assert_eq(sign_text(), before)
    # The first takes the drag (the engraver moves both).
    sign_drag(sign_at(first), 2, -2)
    assert_contains(sign_text(), "\\tweak Script.extra-offset #'(2 . 2)")
    assert_eq(sign_text().split("extra-offset").length, 2)
    assert_no_page_errors()
  end
end
