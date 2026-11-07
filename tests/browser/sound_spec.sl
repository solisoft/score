# Keyswitches, program changes and articulation maps (#670), in a real
# browser (soli test --browser): placed on the Sound lane of the app's MIDI
# view, kept on the score's `%% eui-score` line, never engraved, and written
# into the saved MIDI a little before the note they go with.

const SOUND_PIECE = "\\new Staff { \\time 4/4 \\set Staff.midiInstrument = \"violin\" "
+ "c''4-. d''-. e''^\"pizz.\" f'' | g''4^\"arco\" a'' b'' c''' }"

# Signs up and in as a person does, the address confirmed from its link:
# the MIDI view is the app's.
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
  wait_for("[data-import][data-ready]")
  evaluate("(() => { const input = document.querySelector('[data-import]'); const files = new DataTransfer();"
  + " files.items.add(new File([#{JSON.stringify(text)}], #{JSON.stringify(name)})); input.files = files.files;"
  + " input.dispatchEvent(new Event('change', { bubbles: true })); })()")
end

# The text's meta line, key `key`, as JSON ("null" with none).
def sound_meta(key)
  evaluate("(() => { const line = document.querySelector('[data-source]').value.match(/^%% eui-score (.*)$/m);"
  + " return JSON.stringify(line ? (JSON.parse(line[1])[#{JSON.stringify(key)}] ?? null) : null); })()")
end

# A select or a field of the editor set to `value`, as a person changes it.
def sound_set(selector, value)
  evaluate("(() => { const el = document.querySelector(#{JSON.stringify(selector)});"
  + " el.value = #{JSON.stringify(value)};"
  + " el.dispatchEvent(new Event('input', { bubbles: true }));"
  + " el.dispatchEvent(new Event('change', { bubbles: true })); })()")
  sleep(0.3)
end

# A press on the lane's row `row` ("keys", "programs") at `beat` (quarters
# from the start), let go there; "dblclick" double-clicks it instead.
const SOUND_PRESS = """
(beat, row, kind) => {
  const svg = document.querySelector('.ks-strip');
  const box = svg.getBoundingClientRect();
  const bar = [...svg.querySelectorAll('.cc-bar-line')].map((l) => Number(l.getAttribute('x1')));
  const quarter = (bar[1] - bar[0]) / 4;
  const y = row === 'keys' ? 14 : 40;
  const at = { clientX: box.left + bar[0] + beat * quarter + 1, clientY: box.top + y, pointerId: 1, bubbles: true };
  const host = document.querySelector('.studio-roll');
  if (kind === 'dblclick') return svg.dispatchEvent(new MouseEvent('dblclick', at));
  svg.dispatchEvent(new PointerEvent('pointerdown', at));
  host.dispatchEvent(new PointerEvent('pointerup', at));
}
"""

def sound_press(beat, row, kind)
  evaluate("(#{SOUND_PRESS.trim})(#{beat}, #{JSON.stringify(row)}, #{JSON.stringify(kind)})")
  sleep(0.3)
end

# The note-ons and program changes of the saved MIDI file (window.savedBytes, read as it is saved),
# in order: { division, events: [[tick, status, key, velocity]] }, as JSON.
const SOUND_MIDI_EVENTS = """
(async () => {
  const b = new Uint8Array(await window.savedBytes);
  const out = [];
  let at = 14;
  while (at < b.length) {
    const end = at + 8 + ((b[at + 4] << 24) | (b[at + 5] << 16) | (b[at + 6] << 8) | b[at + 7]);
    let q = at + 8, running = 0, tick = 0;
    const number = () => { let v = 0, x; do { x = b[q++]; v = (v << 7) | (x & 127); } while (x & 128); return v; };
    while (q < end) {
      tick += number();
      let status = b[q];
      if (status & 128) q++; else status = running;
      running = status;
      if (status === 0xff) { q++; const size = number(); q += size; }
      else if (status === 0xf0 || status === 0xf7) { const size = number(); q += size; }
      else {
        const kind = status & 0xf0;
        const one = b[q++];
        const two = kind === 0xc0 || kind === 0xd0 ? 0 : b[q++];
        if ((kind === 0x90 && two > 0) || kind === 0xc0) out.push([tick, status, one, two]);
      }
    }
    at = end;
  }
  return JSON.stringify({ division: (b[12] << 8) | b[13], events: out });
})()
"""

def sound_save_midi
  evaluate("(() => { HTMLAnchorElement.prototype.click = function () {"
  + " window.savedBytes = fetch(this.href).then((r) => r.arrayBuffer()); }; })()")
  evaluate("document.querySelector('[data-act=\"save-midi\"]').click()")
  sleep(1)
end

# What the engraved score says of itself: its staves, bars, notes and rests.
def sound_engraved
  evaluate("[...document.querySelectorAll('svg desc')].map((d) => d.textContent).join(' | ')")
end

describe("The Sound lane, in a browser") do
  before_each() do
    logout()
    sound_sign_up()
    sound_import("strings.ly", SOUND_PIECE)
    wait_for("[data-save-state]")
    wait_for_text("Your changes save themselves")
    click("[data-midi-button]")
    wait_for(".cc-strip")
  end

  test("a keyswitch placed: kept on the meta line, not engraved, in the saved MIDI just before its note") do
    engraved = sound_engraved()
    assert_contains(engraved, "8 notes")
    sound_set("[data-cc-id]", "sound")
    wait_for(".ks-strip")
    assert_text("Click a row to place a keyswitch or a program change")
    # A keyswitch, note 24 (C1), on beat two.
    sound_set("[data-ks-key]", "24")
    assert_eq(evaluate("document.querySelector('[data-ks-key-name]').textContent"), "C1")
    sound_press(1, "keys", "click")
    assert_eq(JSON.parse(sound_meta("ks")), {"0": {"keys": [[20160, 24]]}})
    assert_eq(evaluate("document.querySelectorAll('.ks-key').length"), 1, "its flag on the lane")
    # A program change, 41 on bank 1, at the start.
    sound_set("[data-ks-program]", "41")
    sound_set("[data-ks-msb]", "1")
    sound_press(0, "programs", "click")
    assert_eq(JSON.parse(sound_meta("ks"))["0"]["programs"], [[
      0,
      41,
      1
    ]])
    # Nothing more on the page: the same notes, no low C engraved.
    sleep(0.8)
    assert_eq(sound_engraved(), engraved, "the engraving is as it was")
    # In the MIDI as saved: the keyswitch at velocity 1, a few ticks before the D on beat two.
    sound_save_midi()
    saved = JSON.parse(evaluate(SOUND_MIDI_EVENTS))
    events = saved["events"]
    division = saved["division"]
    switch = events.filter do |e|
      e[2] == 24 && e[3] == 1
    end
    assert_eq(switch.length, 1, "one keyswitch")
    d_note = events.find do |e|
      e[2] == 74 && e[3] > 1
    end
    assert(switch[0][0] < d_note[0], "before the note")
    assert(switch[0][0] > d_note[0] - division / 4, "only just before")
    assert_eq(d_note[0], division, "the note where it was written")
    programs = events.filter do |e|
      e[1] >= 192 && e[1] < 208 && e[2] == 41
    end
    assert_eq(programs.length, 1, "the program change")
    # Taken away with a double click; Undo puts it back.
    sound_press(1, "keys", "dblclick")
    assert_null(JSON.parse(sound_meta("ks"))["0"]["keys"])
    evaluate("document.querySelector('[data-act=\"undo\"]').click()")
    sleep(0.3)
    assert_eq(JSON.parse(sound_meta("ks"))["0"]["keys"], [[20160, 24]])
    # Saved with the score: read again after a reload.
    sleep(2)
    wait_for_text("Saved")
    visit(evaluate("location.pathname"))
    wait_for_text("Your changes save themselves")
    assert_eq(JSON.parse(sound_meta("ks"))["0"]["keys"], [[20160, 24]])
    assert_no_page_errors()
  end

  test("an articulation map: the template chosen, its keyswitches before the staccato and the pizz. notes") do
    sound_set("[data-cc-id]", "sound")
    wait_for(".ks-strip")
    sound_set("[data-ks-map]", "template")
    maps = JSON.parse(sound_meta("ksmaps"))
    map_id = maps.keys[0]
    assert_eq(maps[map_id]["name"], "Keyswitches from C0 (template)")
    assert_eq(JSON.parse(sound_meta("ks"))["0"]["map"], map_id)
    assert(evaluate("document.querySelectorAll('.ks-mapped').length") >= 3, "what the map sends, drawn pale")
    # The dialog: the map's rules, editable; a rule's note changed is kept.
    click("[data-ks-edit]")
    wait_for(".studio-ksmap[open]")
    assert_text("Match each one to your library's own keyswitch chart")
    assert_eq(evaluate("document.querySelectorAll('.ksmap-rules tbody tr').length"), 11)
    # On a laptop's screen, the whole dialog shows, its last row too; on a short window it stays inside and scrolls.
    fits = "(() => { const box = document.querySelector('.studio-ksmap'); const it = box.getBoundingClientRect();"
    + " const last = box.querySelector('[data-ksd=\"lead\"]').getBoundingClientRect();"
    + " return [it.top >= 0, it.bottom <= innerHeight, last.bottom <= it.bottom,"
    + " box.scrollHeight <= box.clientHeight + 1].join(' '); })()"
    viewport(1280, 800)
    sleep(0.3)
    assert_eq(evaluate(fits), "true true true true")
    viewport(1280, 600)
    sleep(0.3)
    assert_eq(evaluate(fits), "true true false false")
    viewport(1280, 800)
    sound_set(".ksmap-rules tbody tr:nth-child(9) [data-ksd=\"key\"]", "60")
    staccato = JSON.parse(sound_meta("ksmaps"))[map_id]["rules"].find do |rule|
      rule["mark"] == "staccato"
    end
    assert_eq(staccato["key"], 60)
    # Kept in this browser, for other scores.
    click("[data-ksd-act=\"keep\"]")
    sleep(0.3)
    assert_eq(evaluate("JSON.parse(localStorage.getItem('eui-score-articulation-maps')).length"), 1)
    click("[data-ksd-act=\"close\"]")
    # In the MIDI: 60 before the staccato notes, 13 before the pizz., 12 (the default) back for arco.
    sound_save_midi()
    switches = JSON.parse(evaluate(SOUND_MIDI_EVENTS))["events"].filter do |e|
      e[3] == 1
    end
    assert_eq(switches.map(&{ |e|
      e[2]
    }), [60, 13, 12])
    sleep(2)
    wait_for_text("Saved")
    assert_no_page_errors()
  end

  test("any controller: CC 21 chosen by its number, its curve kept under cc") do
    sound_set("[data-cc-id]", "other")
    assert_eq(evaluate("document.querySelector('[data-cc-other]').hidden"), false, "its number asked for")
    sound_set("[data-cc-number]", "21")
    wait_for(".cc-strip")
    assert_text("CC 21")
    evaluate("(() => { const svg = document.querySelector('.cc-strip'); const box = svg.getBoundingClientRect();"
    + " const x = box.left + Number(svg.querySelector('.cc-bar-line').getAttribute('x1')) + 1;"
    + " const at = { clientX: x, clientY: box.top + 20, pointerId: 1, bubbles: true };"
    + " svg.dispatchEvent(new PointerEvent('pointerdown', at));"
    + " document.querySelector('.studio-roll').dispatchEvent(new PointerEvent('pointerup', at)); })()")
    sleep(0.3)
    assert_eq(JSON.parse(sound_meta("cc"))["0"]["21"].length, 1)
    # Bank select is no curve: refused, said.
    sound_set("[data-cc-id]", "other")
    sound_set("[data-cc-number]", "0")
    assert_text("bank select (0, 32)")
    sleep(2)
    wait_for_text("Saved")
    assert_no_page_errors()
  end
end
