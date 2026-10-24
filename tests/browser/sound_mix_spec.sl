# The mixer and each note's velocity, in a real browser (soli test
# --browser): set on the playground, kept in the score's text on its
# `%% eui-score` line, taken back by Undo, and written into the MIDI.

const SOUND_DUET = "<< \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''1 } \\new Staff { \\clef bass c4 c c c | c1 } >>"

# Replaces the source box's text as typing does, then leaves it.
def sound_type_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

# The object on the text's `%% eui-score` line, as JSON ("{}" with none).
def sound_meta
  evaluate("(() => { const line = document.querySelector('[data-source]').value.match(/^%% eui-score (.*)$/m);"
  + " return line ? line[1] : '{}'; })()")
end

# A drag across the velocity strip, from note `a` to note `b` (in the
# order they are drawn), at `fraction` of the strip's height from its top.
const STRIP_DRAG = """
(a, b, fraction, shift) => {
  const svg = document.querySelector('.vel-strip');
  const box = svg.getBoundingClientRect();
  const xs = [...svg.querySelectorAll('.vel-note circle')].map((c) => box.left + Number(c.getAttribute('cx')));
  const y = box.top + box.height * fraction;
  const host = document.querySelector('.studio-roll');
  const press = (type, x, el) =>
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, shiftKey: shift }));
  press('pointerdown', xs[a], svg);
  if (a !== b) press('pointermove', xs[b], host);
  press('pointerup', xs[b], host);
}
"""

def strip_drag(a, b, fraction, shift)
  evaluate("(#{STRIP_DRAG.trim})(#{a}, #{b}, #{fraction}, #{shift})")
  sleep(0.3)
end

# The velocities of a saved MIDI file's note-ons (window.savedHref), as JSON.
const MIDI_VELOCITIES = """
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
        q++;
        const velocity = kind === 0xc0 || kind === 0xd0 ? 0 : b[q++];
        if (kind === 0x90 && velocity > 0) out.push(velocity);
      }
    }
    at = end;
  }
  return JSON.stringify(out);
})()
"""

# A mixer control (`lane` "0", "1" or "master"; `field` "volume",
# "reverb.on"…) set to `value`, as a person lets it go.
def mixer_set(lane, field, value)
  control = ".studio-mixer [data-lane='#{lane}'][data-field='#{field}']"
  evaluate("(() => { const el = document.querySelector(#{JSON.stringify(control)});"
  + " if (el.type === 'checkbox') el.checked = #{value}; else el.value = #{JSON.stringify(value)};"
  + " el.dispatchEvent(new Event('input', { bubbles: true }));"
  + " el.dispatchEvent(new Event('change', { bubbles: true })); })()")
  sleep(0.3)
end

# A click on what `selector` finds.
def sound_click(selector)
  evaluate("document.querySelector(#{JSON.stringify(selector)}).click()")
  sleep(0.3)
end

# Whether the button `selector` finds is pressed: "true" or "false".
def sound_pressed(selector)
  evaluate("document.querySelector(#{JSON.stringify(selector)}).getAttribute('aria-pressed')")
end

describe("The mixer and the velocities, in a browser") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    sound_type_source(SOUND_DUET)
  end

  test("the mixer's settings are kept in the score, its M is the Playback section's, Undo takes them back") do
    evaluate("document.querySelector('.tool-mixer').click()")
    wait_for(".studio-mixer[open]")
    assert_eq(
      evaluate("document.querySelectorAll('.studio-mixer .mixer-strip').length"),
      3,
      "two staves and the master"
    )
    mixer_set("0", "volume", "-12")
    mixer_set("1", "pan", "-0.5")
    mixer_set("master", "reverb.on", "true")
    mixer_set("master", "reverb.room", "cathedral")
    meta = JSON.parse(sound_meta())
    assert_eq(meta["mixer"]["tracks"]["0"]["volume"], -12)
    assert_eq(meta["mixer"]["tracks"]["1"]["pan"], -0.5)
    assert_eq(
      meta["mixer"]["master"]["reverb"],
      {"on": true, "room": "cathedral"}
    )
    # Muted in the mixer: the Playback section's M is pressed too, and the reverse.
    sound_click(".studio-mixer [data-toggle='mute'][data-lane='1']")
    assert_eq(sound_pressed("[data-play='staves'] [data-act='mute'][data-lane='1']"), "true")
    sound_click("[data-play='staves'] [data-act='solo'][data-lane='0']")
    assert_eq(sound_pressed(".studio-mixer [data-toggle='solo'][data-lane='0']"), "true")
    meta = JSON.parse(sound_meta())
    assert_eq(meta["mixer"]["tracks"]["1"]["mute"], true)
    assert_eq(meta["mixer"]["tracks"]["0"]["solo"], true)
    # Undo, twice: the solo, then the mute, go; the rest stays.
    sound_click("[data-act='undo']")
    sound_click("[data-act='undo']")
    meta = JSON.parse(sound_meta())
    assert_null(meta["mixer"]["tracks"]["1"]["mute"])
    assert_null(meta["mixer"]["tracks"]["0"]["solo"])
    assert_eq(meta["mixer"]["tracks"]["0"]["volume"], -12)
    assert_eq(sound_pressed("[data-play='staves'] [data-act='mute'][data-lane='1']"), "false")
    # A fader double-clicked goes back to the middle: nothing differs from the defaults, nothing kept for it.
    evaluate("document.querySelector(\".studio-mixer [data-lane='1'][data-field='pan']\")"
    + ".dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
    sleep(0.3)
    assert_null(JSON.parse(sound_meta())["mixer"]["tracks"]["1"])
    assert_no_page_errors()
  end
end

# How many of `values` lie from `low` to `high`.
def sound_count(values, low, high)
  count = 0
  for value in values
    count += 1 if value >= low && value <= high
  end
  count
end

# Signs up and in as a person does, the address confirmed from its link.
def sound_sign_up
  email = "sound-#{uuid_v4}@example.com"
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
def sound_import(name, text)
  # Its listener is set by the page's script, which runs after the page's text is shown.
  wait_for("[data-import][data-ready]")
  evaluate("(() => { const input = document.querySelector('[data-import]'); const files = new DataTransfer();"
  + " files.items.add(new File([#{JSON.stringify(text)}], #{JSON.stringify(name)})); input.files = files.files;"
  + " input.dispatchEvent(new Event('change', { bubbles: true })); })()")
end

describe("The velocity strip, in the app") do
  before_each() do
    logout()
  end

  test("drawn, chosen and set, kept in the saved score, written into the MIDI, taken back by Undo") do
    sound_sign_up()
    sound_import("duet.ly", SOUND_DUET)
    wait_for("[data-save-state]")
    wait_for_text("Your changes save themselves")
    click("[data-midi-button]")
    wait_for(".vel-strip")
    assert_eq(evaluate("document.querySelectorAll('.vel-note').length"), 10)
    sleep(0.5)
    assert_eq(evaluate("document.querySelectorAll('.vel-note-heard').length"), 10, "none set: all as the dynamics")
    # Drawn across the first three beats, near the top: both staves' notes there, loud.
    strip_drag(0, 2, 0.1, false)
    velocity = JSON.parse(sound_meta())["velocity"]
    assert_eq(velocity.keys.length, 6)
    assert_eq(sound_count(velocity.values, 111, 127), 6, "drawn near the top: loud")
    assert_eq(evaluate("document.querySelectorAll('.vel-note-heard').length"), 4)
    # Two chosen (a click, a Shift-click), then a fixed velocity for them.
    strip_drag(3, 3, 0.5, false)
    strip_drag(4, 4, 0.5, true)
    assert_text("2 chosen")
    evaluate("document.querySelector('[data-vel-value]').value = '30'")
    evaluate("document.querySelector('[data-vel-act=\"fixed\"]').click()")
    sleep(0.3)
    velocity = JSON.parse(sound_meta())["velocity"]
    assert_eq(velocity.keys.length, 8)
    assert_eq(sound_count(velocity.values, 30, 30), 2)
    assert_text("Velocity 30: 2 notes")
    # Written into the MIDI as saved.
    evaluate("(() => { HTMLAnchorElement.prototype.click = function () { window.savedHref = this.href; }; })()")
    evaluate("document.querySelector('[data-act=\"save-midi\"]').click()")
    sleep(0.8)
    velocities = JSON.parse(evaluate(MIDI_VELOCITIES))
    assert_eq(velocities.length, 10)
    assert_eq(sound_count(velocities, 30, 30), 2)
    assert_eq(sound_count(velocities, 111, 127), 6)
    # Undo: the fixed velocity goes, the drawn ones stay.
    evaluate("document.querySelector('[data-act=\"undo\"]').click()")
    sleep(0.3)
    assert_eq(JSON.parse(sound_meta())["velocity"].keys.length, 6)
    # Saved with the score: read again after a reload.
    sleep(2)
    wait_for_text("Saved")
    visit(evaluate("location.pathname"))
    wait_for_text("Your changes save themselves")
    assert_eq(JSON.parse(sound_meta())["velocity"].keys.length, 6)
    assert_no_page_errors()
  end
end
