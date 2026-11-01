# The automation lane, in a real browser (soli test --browser): points added,
# dragged and taken away on the app's MIDI view, kept in the score's
# text under `cc`, taken back by Undo, and written into the saved MIDI.

const AUTO_DUET = "<< \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''1 } \\new Staff { \\clef bass c4 c c c | c1 } >>"

# Replaces the source box's text as typing does, then leaves it.
def auto_type_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

# Signs up and in as a person does, the address confirmed from its link:
# the MIDI view is the app's.
def auto_sign_up
  email = "automation-#{uuid_v4}@example.com"
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", "correct horse battery")
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  wait_for_text("Check your inbox")
  token = User.find_by("email", email).start_email_confirmation
  visit("/confirm_email?token=#{token}")
  wait_for_text("Your email address is confirmed")
  login(email, "correct horse battery")
  visit("/app")
  wait_for_text("Your scores")
end

# Imports `text` as a file named `name`, as File › Import does.
def auto_import(name, text)
  # Its listener is set by the page's script, which runs after the page's text is shown.
  wait_for("[data-import][data-ready]")
  evaluate("(() => { const input = document.querySelector('[data-import]'); const files = new DataTransfer();"
  + " files.items.add(new File([#{JSON.stringify(text)}], #{JSON.stringify(name)})); input.files = files.files;"
  + " input.dispatchEvent(new Event('change', { bubbles: true })); })()")
end

# The text's `cc` curves, as JSON ("null" with none).
def auto_curves
  evaluate("(() => { const line = document.querySelector('[data-source]').value.match(/^%% eui-score (.*)$/m);"
  + " return JSON.stringify(line ? (JSON.parse(line[1]).cc ?? null) : null); })()")
end

# A press on the lane at `beat` (quarters from the start) and `fraction` of
# its height from the top, moved to `to_beat`, `to_fraction`, let go;
# `kind` "click" for a plain press, "dblclick" for a double click.
const AUTO_PRESS = """
(beat, fraction, toBeat, toFraction, kind) => {
  const svg = document.querySelector('.cc-strip');
  const box = svg.getBoundingClientRect();
  const bar = [...svg.querySelectorAll('.cc-bar-line')].map((l) => Number(l.getAttribute('x1')));
  const quarter = (bar[1] - bar[0]) / 4;
  const at = (b, f) => ({
    clientX: box.left + bar[0] + b * quarter, clientY: box.top + box.height * f, pointerId: 1, bubbles: true,
  });
  const host = document.querySelector('.studio-roll');
  if (kind === 'dblclick') return svg.dispatchEvent(new MouseEvent('dblclick', at(beat, fraction)));
  svg.dispatchEvent(new PointerEvent('pointerdown', at(beat, fraction)));
  if (toBeat !== beat || toFraction !== fraction) {
    host.dispatchEvent(new PointerEvent('pointermove', at(toBeat, toFraction)));
  }
  host.dispatchEvent(new PointerEvent('pointerup', at(toBeat, toFraction)));
}
"""

def auto_press(beat, fraction, to_beat, to_fraction, kind)
  evaluate("(#{AUTO_PRESS.trim})(#{beat}, #{fraction}, #{to_beat}, #{to_fraction}, #{JSON.stringify(kind)})")
  sleep(0.3)
end

# A select of the lane's bar set to `value`.
def auto_choose(selector, value)
  evaluate("(() => { const el = document.querySelector(#{JSON.stringify(selector)});"
  + " el.value = #{JSON.stringify(value)};"
  + " el.dispatchEvent(new Event('change', { bubbles: true })); })()")
  sleep(0.3)
end

# The controller events of a saved MIDI file (window.savedHref): [[status, number, value]], as JSON.
const AUTO_MIDI_CCS = """
(async () => {
  const b = new Uint8Array(await (await fetch(window.savedHref)).arrayBuffer());
  const out = [];
  let at = 14;
  while (at < b.length) {
    const end = at + 8 + ((b[at + 4] << 24) | (b[at + 5] << 16) | (b[at + 6] << 8) | b[at + 7]);
    let q = at + 8, running = 0;
    const number = () => { let v = 0, x; do { x = b[q++]; v = (v << 7) | (x & 127); } while (x & 128); return v; };
    while (q < end) {
      number();
      let status = b[q];
      if (status & 128) q++; else status = running;
      running = status;
      if (status === 0xff) { q++; const size = number(); q += size; }
      else if (status === 0xf0 || status === 0xf7) { const size = number(); q += size; }
      else {
        const kind = status & 0xf0;
        const one = b[q++];
        const two = kind === 0xc0 || kind === 0xd0 ? 0 : b[q++];
        if (kind === 0xb0 || kind === 0xe0) out.push([status, one, two]);
      }
    }
    at = end;
  }
  return JSON.stringify(out);
})()
"""

describe("The automation lane, in a browser") do
  before_each() do
    logout()
    auto_sign_up()
    auto_import("duet.ly", AUTO_DUET)
    wait_for("[data-save-state]")
    wait_for_text("Your changes save themselves")
    click("[data-midi-button]")
    wait_for(".cc-strip")
  end

  test("points added, dragged and taken away, kept under cc, taken back by Undo, written into the MIDI") do
    assert_eq(evaluate("document.querySelectorAll('[data-cc-lane] option').length"), 2, "a choice per staff")
    assert_text("Click to add a point")
    # Two modulation points on the first staff: low on beat one, high on beat three.
    auto_press(0, 0.9, 0, 0.9, "click")
    auto_press(2, 0.1, 2, 0.1, "click")
    curves = JSON.parse(auto_curves())
    points = curves["0"]["1"]
    assert_eq(points.length, 2)
    assert_eq(points[0][0], 0)
    assert_eq(points[1][0], 40320)
    assert(points[0][1] < 20, "low")
    assert(points[1][1] > 110, "high")
    assert_eq(evaluate("document.querySelectorAll('.cc-point').length"), 2)
    # The high one dragged to beat four, half way up.
    auto_press(2, 0.1, 3, 0.5, "click")
    points = JSON.parse(auto_curves())["0"]["1"]
    assert_eq(points[1][0], 60480)
    assert(points[1][1] > 50 && points[1][1] < 80, "half way")
    # Written into the MIDI as saved: a ramp, on the first staff's channel.
    evaluate("(() => { HTMLAnchorElement.prototype.click = function () { window.savedHref = this.href; }; })()")
    evaluate("document.querySelector('[data-act=\"save-midi\"]').click()")
    sleep(0.8)
    modulation = JSON.parse(evaluate(AUTO_MIDI_CCS)).filter do |e|
      e[0] == 176 && e[1] == 1
    end
    assert(modulation.length >= 8, "a value every sixteenth along the ramp")
    # The other staff, the pitch bend: a curve of its own.
    auto_choose("[data-cc-lane]", "1")
    auto_choose("[data-cc-id]", "bend")
    assert_text("Click to add a point")
    auto_press(1, 0.5, 1, 0.5, "click")
    curves = JSON.parse(auto_curves())
    assert_eq(curves["1"]["bend"].length, 1)
    assert_eq(curves["0"]["1"].length, 2, "the first staff's curve kept")
    # A double click takes the point away; Undo puts it back.
    auto_press(1, 0.5, 1, 0.5, "dblclick")
    assert_null(JSON.parse(auto_curves())["1"])
    evaluate("document.querySelector('[data-act=\"undo\"]').click()")
    sleep(0.3)
    assert_eq(JSON.parse(auto_curves())["1"]["bend"].length, 1)
    # Cleared: the curve goes, the other stays.
    evaluate("document.querySelector('[data-cc-clear]').click()")
    sleep(0.3)
    assert_null(JSON.parse(auto_curves())["1"])
    assert_eq(JSON.parse(auto_curves())["0"]["1"].length, 2)
    # Saved with the score: read again after a reload.
    sleep(2)
    wait_for_text("Saved")
    visit(evaluate("location.pathname"))
    wait_for_text("Your changes save themselves")
    assert_eq(JSON.parse(auto_curves())["0"]["1"].length, 2)
    assert_no_page_errors()
  end

  test("a meta line written to inject markup draws none: velocities and curves read as numbers (#537)") do
    payload = "<img src=x onerror=\"window.injected = 1\">"
    meta = {"velocity": {"0:0:72": payload, "0:20160:74": 300}, "cc": {"0": {"1": [[0, payload], [40320, 90]]}}}
    auto_type_source("{ c''4 d'' e'' f'' }\n%% eui-score " + meta.to_json + "\n")
    wait_for(".vel-strip")
    sleep(0.5)
    assert_eq(evaluate("document.querySelectorAll('.studio-roll img').length"), 0, "no element injected")
    assert_eq(evaluate("window.injected === undefined"), true, "no script run")
    assert_eq(
      evaluate("[...document.querySelectorAll('.vel-strip title')].filter((t) => t.textContent === '127').length"),
      1,
      "the velocity too loud clamped"
    )
    assert_eq(evaluate("document.querySelectorAll('.cc-point').length"), 1, "the point that is no number left out")
    assert_eq(evaluate("document.querySelector('.cc-point title').textContent"), "90")
    # Kept: the page is left with nothing unsaved, or the next visit is held
    # up by the page's "leave?" question.
    sleep(2)
    wait_for_text("Saved")
    assert_no_page_errors()
  end

  test("the sustain pedal of the notation wins: its curve is drawn, and said not to be heard") do
    auto_type_source("{ c''4\\sustainOn d'' e''\\sustainOff f'' }")
    auto_choose("[data-cc-id]", "64")
    auto_press(0, 0.1, 0, 0.1, "click")
    assert_eq(JSON.parse(auto_curves())["0"]["64"][0][1], 127, "on")
    assert_text("this curve is not heard")
    assert_eq(evaluate("document.querySelectorAll('.cc-curve-muted').length"), 1)
    # The File menu offers the compressed sound and the stems.
    assert_eq(evaluate("document.querySelectorAll('[data-act=\"save-mp3\"], [data-act=\"save-stems\"]').length"), 2)
    # Kept: the page is left with nothing unsaved.
    sleep(2)
    wait_for_text("Saved")
    assert_no_page_errors()
  end
end
