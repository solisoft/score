# Practice, the synthesizer and your own SoundFont (#391), in a real browser
# (soli test --browser): the loop that goes faster each pass, saved files
# transposed and slowed when asked, a staff on the synthesizer in the mixer,
# a SoundFont file loaded and refused, and an MPE keyboard found.

const PRACTICE_TUNE = "{ \\time 2/4 \\tempo 4 = 240 c''8 d'' e'' f'' | g''2 }"
const PRACTICE_DUET = "<< \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''1 }"
+ " \\new Staff { \\clef bass c4 e g c | c1 } >>"

# Replaces the source box's text as typing does, then leaves it.
def practice_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

# The caret put on `token` in the text: its note selected.
def practice_caret(token)
  evaluate("(() => { const box = document.querySelector('[data-source]');"
  + " const at = box.value.indexOf(#{JSON.stringify(token)}); box.focus(); box.setSelectionRange(at + 1, at + 1);"
  + " box.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()")
  sleep(0.4)
end

def practice_click(selector)
  evaluate("document.querySelector(#{JSON.stringify(selector)}).click()")
  sleep(0.3)
end

# A control (`selector`) set to `value` as a person sets it: a box ticked, a choice made.
def practice_set(selector, value)
  evaluate("(() => { const el = document.querySelector(#{JSON.stringify(selector)});"
  + " if (el.type === 'checkbox') el.checked = #{JSON.stringify(value)} === 'true';"
  + " else el.value = #{JSON.stringify(value)};"
  + " el.dispatchEvent(new Event('input', { bubbles: true }));"
  + " el.dispatchEvent(new Event('change', { bubbles: true })); })()")
  sleep(0.3)
end

# The object on the text's `%% eui-score` line.
def practice_meta
  JSON.parse(evaluate("(() => { const line = document.querySelector('[data-source]').value"
  + ".match(/^%% eui-score (.*)$/m);"
  + " return line ? line[1] : '{}'; })()"))
end

# Play needs the General MIDI sounds (public/soundfonts/MuseScore_General.sf3,
# 38 MB, not in git: deploy/soundfont.sh fetches it). Without them, a test
# that plays is pending, not passed.
def practice_needs_sounds
  served = evaluate("fetch('/soundfonts/MuseScore_General.sf3?v=0.2')"
  + ".then((r) => { r.body?.cancel(); return r.ok; }, () => false)")
  pending("the General MIDI sounds are not in public/soundfonts/ (deploy/soundfont.sh)") unless served
end

# What the melody's channel (0) plays once Play has begun, as player.js `patchOf` says, or nil.
const PRACTICE_PATCH = """
(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name)
    .find((n) => n.includes('/eui-score/player.js'));
  const P = await import(url);
  for (let i = 0; i < 40; i++) {
    const patch = document.querySelector('#studio').studio.playing?.handle ? P.patchOf(0) : null;
    if (patch?.bankMSB === 64) return { name: patch.name, bankMSB: patch.bankMSB, program: patch.program };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
})()
"""

def practice_status
  evaluate("document.querySelector('[data-status]').textContent")
end

const PRACTICE_WAIT = """
(async (text, seconds) => {
  for (let i = 0; i < seconds * 5; i++) {
    if (document.querySelector('[data-status]').textContent.includes(text)) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
})
"""

# Waits up to `seconds` for the status line to hold `text`, twenty seconds at a time (the driver's limit is thirty).
def practice_wait_status(text, seconds)
  waited = 0
  while waited < seconds && !evaluate("(#{PRACTICE_WAIT.trim})(#{JSON.stringify(text)}, 20)")
    waited = waited + 20
  end
  assert_contains(practice_status(), text)
end

# The keys of the notes the synthesizer plays once Play has begun (waits for the sounds), or nil.
const PRACTICE_VOICES = """
(async () => {
  for (let i = 0; i < 40; i++) {
    const playing = document.querySelector('#studio').studio.playing;
    if (playing?.voices) return playing.voices.notes.map((n) => n.key);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
})()
"""

# A saved MIDI file (window.savedHref): its note-on keys and its tempo events (µs a quarter), as JSON.
const PRACTICE_MIDI = """
(async () => {
  const b = new Uint8Array(await (await fetch(window.savedHref)).arrayBuffer());
  const keys = [], tempos = [];
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
      if (status === 0xff) {
        const type = b[q++]; const size = number();
        if (type === 0x51) tempos.push((b[q] << 16) | (b[q + 1] << 8) | b[q + 2]);
        q += size;
      } else if (status === 0xf0 || status === 0xf7) { const size = number(); q += size; }
      else {
        const kind = status & 0xf0;
        const key = b[q++];
        const velocity = kind === 0xc0 || kind === 0xd0 ? 0 : b[q++];
        if (kind === 0xc0 || kind === 0xd0) q--;
        if (kind === 0x90 && velocity > 0) keys.push(key);
      }
    }
    at = end;
  }
  return JSON.stringify({ keys, tempos });
})()
"""

def practice_saved_midi
  evaluate("(() => { window.savedHref = null;"
  + " HTMLAnchorElement.prototype.click = function () { window.savedHref = this.href; }; })()")
  evaluate("document.querySelector('[data-act=\"save-midi\"]').click()")
  sleep(0.5)
  JSON.parse(evaluate(PRACTICE_MIDI))
end

# Save the sound as WAV (window.savedHref) and its loudest sample, 0–1: the
# PCM after the "data" chunk, 16-bit.
const PRACTICE_PEAK = """
(async () => {
  for (let i = 0; i < 50 && !window.savedHref; i++) await new Promise((resolve) => setTimeout(resolve, 400));
  if (!window.savedHref) return -1;
  const b = new Uint8Array(await (await fetch(window.savedHref)).arrayBuffer());
  const v = new DataView(b.buffer);
  let at = 12;
  while (at + 8 < b.length && String.fromCharCode(...b.subarray(at, at + 4)) !== 'data') {
    at += 8 + v.getUint32(at + 4, true);
  }
  let peak = 0;
  for (let p = at + 8; p + 1 < b.length; p += 2) peak = Math.max(peak, Math.abs(v.getInt16(p, true)) / 32768);
  return peak;
})()
"""

def practice_wav_peak
  evaluate("(() => { window.savedHref = null;"
  + " HTMLAnchorElement.prototype.click = function () { window.savedHref = this.href; }; })()")
  evaluate("document.querySelector('[data-act=\"save-wav\"]').click()")
  evaluate(PRACTICE_PEAK)
end

# A SoundFont made in the page — two presets, "Glass Organ" (program 19) and
# "Soft Choir" (52), both a looped 440 Hz sine — put in the mixer's file box
# as a person picks it; or, `real` false, a text file.
const PRACTICE_FONT = """
(async (name, real) => {
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const name20 = (n) => ascii(n.padEnd(20, '\0').slice(0, 20));
  const chunk = (id, body) => [...ascii(id), ...u32(body.length), ...body, ...(body.length & 1 ? [0] : [])];
  const list = (type, chunks) => chunk('LIST', [...ascii(type), ...chunks.flat()]);
  const presets = [['Glass Organ', 19], ['Soft Choir', 52]];
  const header = (n, program, bag) =>
    [...name20(n), ...u16(program), ...u16(0), ...u16(bag), ...u32(0), ...u32(0), ...u32(0)];
  const phdr = chunk('phdr', [
    ...presets.flatMap(([n, program], k) => header(n, program, k)),
    ...header('EOP', 0, presets.length),
  ]);
  const pbag = chunk('pbag', [...presets.flatMap((p, k) => [...u16(k), ...u16(0)]), ...u16(presets.length), ...u16(0)]);
  const pmod = chunk('pmod', new Array(10).fill(0));
  const pgen = chunk('pgen', [...presets.flatMap(() => [...u16(41), ...u16(0)]), ...u16(0), ...u16(0)]);
  const inst = chunk('inst', [...name20('Sine'), ...u16(0), ...name20('EOI'), ...u16(1)]);
  const ibag = chunk('ibag', [...u16(0), ...u16(0), ...u16(2), ...u16(0)]);
  const imod = chunk('imod', new Array(10).fill(0));
  const igen = chunk('igen', [...u16(54), ...u16(1), ...u16(53), ...u16(0), ...u16(0), ...u16(0)]);
  const n = 1000;
  const shdr = chunk('shdr', [
    ...name20('Sine'), ...u32(0), ...u32(n), ...u32(0), ...u32(n), ...u32(44000), 69, 0, ...u16(0), ...u16(1),
    ...new Array(46).fill(0),
  ]);
  const smpl = [];
  for (let i = 0; i < n + 46; i++) {
    const v = i < n ? Math.round(12000 * Math.sin((2 * Math.PI * i) / 100)) : 0;
    smpl.push(...u16(v & 0xffff));
  }
  const info = list('INFO', [
    chunk('ifil', [...u16(2), ...u16(1)]), chunk('isng', ascii('EMU8000\0')), chunk('INAM', ascii('Probe\0')),
  ]);
  const pdta = list('pdta', [phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr]);
  const body = [...ascii('sfbk'), ...info, ...list('sdta', [chunk('smpl', smpl)]), ...pdta];
  const bytes = real
    ? new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body])
    : new TextEncoder().encode('just some text, not a SoundFont');
  const box = document.querySelector('[data-inst-file]');
  const files = new DataTransfer();
  files.items.add(new File([bytes], name));
  box.files = files.files;
  box.dispatchEvent(new Event('change', { bubbles: true }));
})
"""

def practice_font(name, real)
  evaluate("(#{PRACTICE_FONT.trim})(#{JSON.stringify(name)}, #{real})")
  sleep(1)
end

describe("Practice, the synthesizer and your own SoundFont, in a browser") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    evaluate("localStorage.removeItem('eui-score-studio-practice')")
  end

  test("the loop plays faster each pass, says its speed, and stops at the target") do
    practice_source(PRACTICE_TUNE)
    practice_caret("c''8")
    practice_click("[data-act='set-loop']")
    assert_eq(evaluate("JSON.stringify(document.querySelector('#studio').studio.loopBars)"), "[0,0]")
    practice_set("[data-practice='ramp']", "true")
    practice_set("[data-practice='from']", "50")
    practice_set("[data-practice='step']", "25")
    practice_set("[data-practice='to']", "100")
    practice_set("[data-practice='at']", "stop")
    # Kept in this browser.
    kept = JSON.parse(evaluate("localStorage.getItem('eui-score-studio-practice')"))
    assert_eq(kept["from"], "50")
    assert_eq(kept["ramp"], true)
    # Every speed the panel says, in order.
    evaluate("(() => { window.speeds = []; const out = document.querySelector('[data-practice-now]');"
    + " new MutationObserver(() => window.speeds.push(out.textContent))"
    + ".observe(out, { childList: true, characterData: true, subtree: true }); })()")
    practice_needs_sounds()
    click(".studio-play")
    practice_wait_status("100 % reached after 3 passes", 60)
    speeds = evaluate("window.speeds")
    assert_eq(speeds[0], "Pass 1 · 50 % (to 100 %)")
    assert_contains(speeds, "Pass 2 · 75 % (to 100 %)")
    assert_contains(speeds, "Pass 3 · 100 % (the target, last pass)")
    assert_eq(speeds[speeds.length - 1], "Practice loop: 100 % reached after 3 passes.")
    # Stopped: nothing plays.
    assert_null(evaluate("document.querySelector('#studio').studio.playing"))
    assert_no_page_errors()
  end

  test("faster each pass with no loop set plays on from the start, and says why") do
    practice_source(PRACTICE_TUNE)
    practice_set("[data-practice='ramp']", "true")
    practice_needs_sounds()
    click(".studio-play")
    practice_wait_status("Faster each pass plays a loop", 40)
    assert_contains(practice_status(), "Playing from the start")
    assert_null(evaluate("document.querySelector('#studio').studio.playing?.ramp ?? null"))
    # The speed is Playback's own.
    assert_eq(evaluate("document.querySelector('#studio').studio.playing.handle.rate"), 1)
    click(".studio-play")
    assert_no_page_errors()
  end

  test("Save as MIDI is transposed and slowed only when Saved files too is ticked") do
    practice_source(PRACTICE_TUNE)
    practice_set("[data-practice='transpose']", "2")
    assert_text("Play transposed: +2 semitones")
    practice_set("[data-play='rate']", "0.5")
    plain = practice_saved_midi()
    assert_eq(plain["keys"], [
      72,
      74,
      76,
      77,
      79
    ])
    assert_eq(plain["tempos"][plain["tempos"].length - 1], 250000)
    practice_set("[data-practice='exports']", "true")
    played = practice_saved_midi()
    assert_eq(played["keys"], [
      74,
      76,
      78,
      79,
      81
    ])
    assert_eq(played["tempos"][played["tempos"].length - 1], 500000)
    # The score itself is as written.
    assert_contains(evaluate("document.querySelector('[data-source]').value"), "c''8 d''8 e''8 f''8")
    assert_no_page_errors()
  end

  test("a staff plays the synthesizer: chosen in its mixer strip, its knobs kept in the score, Undo takes them back") do
    practice_source(PRACTICE_DUET)
    practice_click(".tool-mixer")
    wait_for(".studio-mixer[open]")
    assert_eq(
      evaluate("document.querySelectorAll('.studio-mixer [data-inst=\"kind\"]').length"),
      2,
      "an Instrument choice a staff"
    )
    practice_set(".studio-mixer [data-inst='kind'][data-inst-lane='1']", "synth")
    assert_eq(practice_meta()["synth"], {"1": {"preset": "pad"}})
    wait_for(".studio-mixer [data-inst='filter.cutoff'][data-inst-lane='1']")
    practice_set(".studio-mixer [data-inst='preset'][data-inst-lane='1']", "bass")
    practice_set(".studio-mixer [data-inst='filter.cutoff'][data-inst-lane='1']", "0.8")
    practice_set(".studio-mixer [data-inst='osc1.wave'][data-inst-lane='1']", "square")
    assert_eq(practice_meta()["synth"], {"1": {
      "preset": "bass",
      "osc1": {"wave": "square"},
      "filter": {"cutoff": 0.8}
    }})
    assert_contains(
      evaluate("document.querySelector('.studio-mixer [data-inst-part=\"1\"] summary').textContent"),
      "Synthesizer"
    )
    # The strip's own mute still acts on it: the staff's mixer settings kept beside it.
    practice_click(".studio-mixer [data-toggle='mute'][data-lane='1']")
    assert_eq(practice_meta()["mixer"]["tracks"]["1"]["mute"], true)
    assert_not_null(practice_meta()["synth"]["1"])
    # Undo: the mute, then the wave go; the rest stays.
    practice_click("[data-act='undo']")
    practice_click("[data-act='undo']")
    assert_eq(practice_meta()["synth"], {"1": {
      "preset": "bass",
      "filter": {"cutoff": 0.8}
    }})
    # Played: the bass staff's notes go to the synthesizer, the melody's stay with the SoundFont.
    practice_needs_sounds()
    practice_click("[data-mixer-close]")
    click(".studio-play")
    heard = nil
    tries = 0
    while heard.nil? && tries < 4
      heard = evaluate(PRACTICE_VOICES)
      tries = tries + 1
    end
    assert_eq(heard, [
      48,
      52,
      55,
      48,
      48
    ], "the bass staff's notes, to the synthesizer")
    # Paused: its voices let go.
    click(".studio-play")
    assert_eq(evaluate("document.querySelector('#studio').studio.playing.voices.voices.size"), 0)
    practice_click("[data-act='stop']")
    # General MIDI again: the synthesizer's settings go.
    practice_set(".studio-mixer [data-inst='kind'][data-inst-lane='1']", "gm")
    assert_null(practice_meta()["synth"])
    assert_no_page_errors()
  end

  test("Save the sound renders the synthesizer's staff through its strip: heard, and silent when muted") do
    practice_needs_sounds()
    practice_source("{ \\time 4/4 \\tempo 4 = 240 c''2 e''2 }")
    practice_click(".tool-mixer")
    wait_for(".studio-mixer[open]")
    practice_set(".studio-mixer [data-inst='kind'][data-inst-lane='0']", "synth")
    practice_set(".studio-mixer [data-inst='preset'][data-inst-lane='0']", "lead")
    assert_gt(practice_wav_peak(), 0.05, "the synthesizer heard in the WAV")
    # Muted on its strip: the WAV is silent, the synthesizer with the rest.
    practice_click(".studio-mixer [data-toggle='mute'][data-lane='0']")
    assert_lt(practice_wav_peak(), 0.001, "a muted strip silences the synthesizer")
    assert_no_page_errors()
  end

  test("a drum staff has no Instrument choice: its kit is the SoundFont's") do
    practice_source("<< \\new Staff { c''1 } \\new DrumStaff \\drummode { bd4 sn bd sn } >>")
    practice_click(".tool-mixer")
    wait_for(".studio-mixer[open]")
    assert_eq(evaluate("document.querySelectorAll('.studio-mixer [data-inst=\"kind\"]').length"), 1)
    assert_eq(evaluate("document.querySelector('.studio-mixer [data-inst=\"kind\"]').dataset.instLane"), "0")
  end

  test("an own SoundFont: loaded, kept in this browser, its presets listed; a file that is not one is refused") do
    practice_source(PRACTICE_DUET)
    evaluate("indexedDB.deleteDatabase('eui-score-soundfonts')")
    practice_click(".tool-mixer")
    wait_for(".studio-mixer[open]")
    # Not a SoundFont: refused, nothing written.
    practice_font("notes.txt", false)
    assert_contains(practice_status(), "notes.txt is not a SoundFont")
    assert_null(practice_meta()["soundfont"])
    # A SoundFont: its first preset given to the melody.
    evaluate("document.querySelector('[data-inst-file]').value = ''")
    evaluate("(() => { const box = document.querySelector('[data-inst-file]'); box.click = () => {}; })()")
    practice_set(".studio-mixer [data-inst='kind'][data-inst-lane='0']", "sf")
    practice_font("Organs.sf2", true)
    assert_contains(practice_status(), "Organs.sf2: 2 presets, kept in this browser")
    font = practice_meta()["soundfont"]["0"]
    assert_eq(font["name"], "Organs.sf2")
    assert_eq(font["program"], 19)
    assert_eq(font["preset"], "Glass Organ")
    assert_match(font["hash"], "^[0-9a-f]{16}$")
    wait_for(".studio-mixer [data-inst='sf-preset'][data-inst-lane='0']")
    assert_eq(evaluate("document.querySelectorAll('.studio-mixer [data-inst=\"sf-preset\"] option').length"), 2)
    practice_set(".studio-mixer [data-inst='sf-preset'][data-inst-lane='0']", "0:52")
    assert_eq(practice_meta()["soundfont"]["0"]["preset"], "Soft Choir")
    # Kept in IndexedDB, under its digest.
    evaluate("(() => { window.keptFonts = null; const open = indexedDB.open('eui-score-soundfonts');"
    + " open.onsuccess = () => { const all = open.result.transaction('fonts').objectStore('fonts').getAllKeys();"
    + " all.onsuccess = () => { window.keptFonts = all.result; }; }; })()")
    sleep(0.5)
    assert_eq(evaluate("window.keptFonts"), [font["hash"]])
    # Played: the melody's channel plays the file's Soft Choir (bank 0 moved to 64), not General MIDI's choir.
    practice_needs_sounds()
    practice_click("[data-mixer-close]")
    click(".studio-play")
    patch = nil
    tries = 0
    while patch.nil? && tries < 4
      patch = evaluate(PRACTICE_PATCH)
      tries = tries + 1
    end
    assert_eq(patch["name"], "Soft Choir")
    assert_eq(patch["bankMSB"], 64)
    assert_eq(patch["program"], 52)
    click(".studio-play")
    evaluate("indexedDB.deleteDatabase('eui-score-soundfonts')")
    assert_no_page_errors()
  end

  test("a score whose SoundFont this browser lacks says so, and plays the default sounds") do
    evaluate("indexedDB.deleteDatabase('eui-score-soundfonts')")
    sleep(0.3)
    font = JSON.stringify({"soundfont": {"0": {
      "name": "Faraway.sf2",
      "hash": "00112233445566ff",
      "bank": 0,
      "program": 4,
      "preset": "EP"
    }}})
    practice_source("{ c''4 d'' e'' f'' }\n%% eui-score #{font}\n")
    practice_wait_status("Faraway.sf2 is not in this browser", 5)
    practice_click(".tool-mixer")
    wait_for(".mixer-inst-missing")
    assert_contains(
      evaluate("document.querySelector('.mixer-inst-missing').textContent"),
      "the default sounds play this staff"
    )
    # Still kept in the score, for where the file is.
    assert_eq(practice_meta()["soundfont"]["0"]["hash"], "00112233445566ff")
  end

  test("an MPE keyboard is found from its configuration message, and can be set by hand") do
    evaluate("localStorage.removeItem('eui-score-mpe')")
    evaluate("(() => { window.fakeKeyboard = { id: 'fake-kb', name: 'Fake MPE', onmidimessage: null };"
    + " const access = { inputs: new Map([['fake-kb', window.fakeKeyboard]]), outputs: new Map() };"
    + " Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access }); })()")
    practice_source(PRACTICE_TUNE)
    practice_set("[data-midi-in]", "find")
    sleep(0.4)
    assert_eq(evaluate("document.querySelector('[data-midi-in]').value"), "fake-kb")
    assert_eq(evaluate("document.querySelector('[data-mpe]').checked"), false)
    [[176, 101, 0], [176, 100, 6], [
      176,
      6,
      15
    ]].each do |message|
      evaluate("window.fakeKeyboard.onmidimessage({ data: new Uint8Array(#{JSON.stringify(message)}),"
      + " timeStamp: performance.now() })")
    end
    sleep(0.2)
    assert_eq(evaluate("document.querySelector('[data-mpe]').checked"), true)
    assert_contains(practice_status(), "MPE keyboard found: 15 member channels")
    # Ticked by hand: kept in this browser.
    practice_set("[data-mpe]", "false")
    assert_eq(evaluate("localStorage.getItem('eui-score-mpe')"), "0")
    practice_set("[data-mpe]", "true")
    assert_eq(evaluate("localStorage.getItem('eui-score-mpe')"), "1")
    assert_contains(practice_status(), "Pitch bend and Pressure curves")
    assert_no_page_errors()
  end
end
