# Leaving a score by a link, in a real browser (soli test --browser, #680).
# Instant navigation swaps the page without unloading it: the MIDI keyboard,
# Play's synthesizer and the microphone belong to the tab, not to the page.
# Once the visitor has followed a link, the score left must be left alone —
# no key written into it, no save — and what it started must stop: the
# music, its frames, the mixer's meter, the microphone, the room's socket.
# The next score opened is heard through its own mixer.

const LEAVE_PASSWORD = "correct horse battery"
# Slow whole notes: Play runs for half a minute, long past the checks.
const LEAVE_SOURCE = "\\header { title = \"Left\" }\n"
+ "\\new Staff { \\time 4/4 \\tempo 4 = 60 c'1 | d'1 | e'1 | f'1 | g'1 | a'1 }\n"
const LEAVE_NEXT = "\\header { title = \"Next\" }\n"
+ "\\new Staff { \\time 4/4 \\tempo 4 = 60 g'1 | f'1 | e'1 | d'1 }\n"

# Waits (`seconds` at most) for a JavaScript condition to hold.
def leave_wait(condition, seconds = 10)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < seconds * 5 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < seconds * 5, "waited for: #{condition}")
end

# Signs up and in, makes the two scores and opens the first. Answers {"left", "next"}.
def leave_open
  email = "leave-#{uuid_v4}@example.com"
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", LEAVE_PASSWORD)
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  wait_for_text("Check your inbox")
  user = User.find_by("email", email)
  visit("/confirm_email?token=#{user.start_email_confirmation}")
  wait_for_text("Your email address is confirmed")
  login(email, LEAVE_PASSWORD)
  left_score = Score.start(user, LEAVE_SOURCE)
  next_score = Score.start(user, LEAVE_NEXT)
  visit("/app/scores/#{left_score._key}")
  wait_for_text("Your changes save themselves")
  # The editor as it is now: still readable once the page has left it.
  evaluate("window.leftStudio = document.querySelector('#studio')")
  {"left": left_score, "next": next_score}
end

# Follows the header's link to the list of scores: instant navigation, not a reload.
def leave_by_link
  click("a[href='/app/scores']")
  wait_for("a.score-card-open")
  assert_eq(evaluate("window.leftStudio.isConnected"), false)
  assert_eq(evaluate("window.leftStudio.dataset.studio"), "ended")
end

# A MIDI keyboard given to the page instead of the browser's: its messages
# are sent from the test with window.fakeKeyboard.onmidimessage(…).
const LEAVE_MIDI = """
(() => {
  window.fakeKeyboard = { id: 'fake-kb', name: 'Fake keys', onmidimessage: null };
  const access = { inputs: new Map([['fake-kb', window.fakeKeyboard]]), outputs: new Map() };
  Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => access });
})()
"""

# Key `key` struck and let go on the fake keyboard, if anyone still reads it.
def leave_key(key)
  evaluate("(() => { const kb = window.fakeKeyboard;"
  + " kb.onmidimessage?.({ data: new Uint8Array([0x90, #{key}, 100]), timeStamp: performance.now() });"
  + " kb.onmidimessage?.({ data: new Uint8Array([0x80, #{key}, 0]), timeStamp: performance.now() }); })()")
  sleep(0.2)
end

# The microphone replaced by an oscillator: every stream it gives is kept in
# window.fakeMic.streams, to see whether its tracks were stopped.
const LEAVE_MIC = """
(() => {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const gain = ctx.createGain();
  gain.gain.value = 0.25;
  const out = ctx.createMediaStreamDestination();
  osc.connect(gain);
  gain.connect(out);
  osc.start();
  window.fakeMic = { streams: [] };
  navigator.mediaDevices.getUserMedia = async () => {
    await ctx.resume();
    const stream = new MediaStream(out.stream.getAudioTracks().map((track) => track.clone()));
    window.fakeMic.streams.push(stream);
    return stream;
  };
})()
"""

# A SoundFont of one silent sample, put in the cache player.js reads its
# sounds from: Play loads it at once, and plays nothing (as microphone_spec's).
const LEAVE_SOUNDS = """
async () => {
  const enc = new TextEncoder();
  const concat = (parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const chunk = (id, body) => {
    const out = new Uint8Array(8 + body.length + (body.length % 2));
    out.set(enc.encode(id), 0);
    new DataView(out.buffer).setUint32(4, body.length, true);
    out.set(body, 8);
    return out;
  };
  const list = (type, parts) => chunk('LIST', concat([enc.encode(type), ...parts]));
  const rec = (size, fill) => { const b = new Uint8Array(size); fill(new DataView(b.buffer), b); return b; };
  const name = (b, s) => b.set(enc.encode(s), 0);
  const none = () => {};
  const info = list('INFO', [
    chunk('ifil', rec(4, (v) => { v.setUint16(0, 2, true); v.setUint16(2, 1, true); })),
    chunk('isng', enc.encode('EMU8000')),
    chunk('INAM', enc.encode('Tiny')),
  ]);
  const sdta = list('sdta', [chunk('smpl', new Uint8Array(2 * (64 + 46)))]);
  const pdta = list('pdta', [
    chunk('phdr', concat([
      rec(38, (v, b) => name(b, 'Tiny')),
      rec(38, (v, b) => { name(b, 'EOP'); v.setUint16(24, 1, true); }),
    ])),
    chunk('pbag', concat([rec(4, none), rec(4, (v) => v.setUint16(0, 1, true))])),
    chunk('pmod', rec(10, none)),
    chunk('pgen', concat([rec(4, (v) => v.setUint16(0, 41, true)), rec(4, none)])),
    chunk('inst', concat([
      rec(22, (v, b) => name(b, 'Tiny')),
      rec(22, (v, b) => { name(b, 'EOI'); v.setUint16(20, 1, true); }),
    ])),
    chunk('ibag', concat([rec(4, none), rec(4, (v) => v.setUint16(0, 1, true))])),
    chunk('imod', rec(10, none)),
    chunk('igen', concat([rec(4, (v) => v.setUint16(0, 53, true)), rec(4, none)])),
    chunk('shdr', concat([
      rec(46, (v, b) => {
        name(b, 'S');
        v.setUint32(24, 64, true);
        v.setUint32(28, 8, true);
        v.setUint32(32, 56, true);
        v.setUint32(36, 22050, true);
        b[40] = 60;
        v.setUint16(44, 1, true);
      }),
      rec(46, (v, b) => name(b, 'EOS')),
    ])),
  ]);
  const riff = chunk('RIFF', concat([enc.encode('sfbk'), info, sdta, pdta]));
  const cache = await caches.open('eui-score-sounds');
  const where = new URL('/soundfonts/MuseScore_General.sf3?v=0.2', location.href).href;
  await cache.put(where, new Response(riff, { headers: { 'content-type': 'audio/x-soundfont' } }));
  return riff.length;
}
"""

# Counts, by the callback's name, the animation frames asked for from now on:
# window.leaveFrames.meter is the mixer's meter, .follow the playhead's.
const LEAVE_FRAMES = """
(() => {
  window.leaveFrames = {};
  if (window.leaveFramesSpied) return;
  window.leaveFramesSpied = true;
  const ask = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (fn) => {
    window.leaveFrames[fn.name] = (window.leaveFrames[fn.name] ?? 0) + 1;
    return ask(fn);
  };
})()
"""

# The Play menu's item `act`, clicked.
def leave_menu(act)
  evaluate("document.querySelector('.studio-dropdown [data-act=\"#{act}\"]').click()")
end

describe("Leaving a score by a link") do
  before_each() do
    logout()
  end

  test("a MIDI keyboard writes no more into the score left, and nothing more is saved to it") do
    opened = leave_open()
    left_score = opened["left"]
    evaluate(LEAVE_MIDI)
    evaluate("(() => { const box = document.querySelector('[data-midi-in]'); box.value = 'find';"
    + " box.dispatchEvent(new Event('change', { bubbles: true })); })()")
    leave_wait("document.querySelector('[data-midi-in]').value === 'fake-kb'")
    # The keyboard writes into the score open: a B over the first C, saved.
    leave_key(71)
    leave_wait("document.querySelector('[data-source]').value.includes(\"b'\")")
    leave_wait("document.querySelector('[data-save-state]').textContent === 'Saved'")
    saved = Score.find(left_score._key)
    assert_contains(saved.source, "b'")
    leave_by_link()
    assert_eq(evaluate("window.fakeKeyboard.onmidimessage"), nil, "the keyboard no longer read for the score left")
    assert_eq(evaluate("window.leftStudio.dataset.room ?? null"), "closed", "the room's socket closed")
    left_text = evaluate("window.leftStudio.querySelector('[data-source]').value")
    [60, 62, 64].each do |key|
      leave_key(key)
    end
    sleep(2.5)
    assert_eq(
      evaluate("window.leftStudio.querySelector('[data-source]').value"),
      left_text,
      "nothing written into it"
    )
    after = Score.find(left_score._key)
    assert_eq(after.revision, saved.revision, "no save of the score left")
    assert_eq(after.source, saved.source)
    assert_no_page_errors()
  end

  test("the music, its frames, the mixer's meter and the microphone stop; the next score plays through its mixer") do
    opened = leave_open()
    next_score = opened["next"]
    assert_gt(evaluate("(#{LEAVE_SOUNDS.trim})()"), 100)
    evaluate(LEAVE_MIC)
    # The microphone open, for the tuner.
    leave_menu("tuner")
    wait_for(".studio-tuner[open]")
    click(".studio-tuner [data-tuner-start]")
    leave_wait("document.querySelector('[data-tuner-start]').getAttribute('aria-pressed') === 'true'")
    assert_eq(evaluate("window.fakeMic.streams.length"), 1)
    # The mixer open, its meter running; the music playing through it.
    leave_menu("mixer")
    wait_for(".studio-mixer[open]")
    click(".studio-play")
    wait_for_text("Playing", {"timeout": 20})
    leave_wait("document.querySelector('#studio').studio.playing?.handle?.playing === true")
    assert_not_null(evaluate("document.querySelector('#studio').studio.liveMixer ? 'mixer' : null"))
    evaluate("window.leftHandle = document.querySelector('#studio').studio.playing.handle")
    evaluate(LEAVE_FRAMES)
    sleep(0.5)
    assert_gt(evaluate("window.leaveFrames.meter ?? 0"), 0, "the meter runs before")
    assert_gt(evaluate("window.leaveFrames.follow ?? 0"), 0, "the playhead runs before")

    leave_by_link()
    evaluate(LEAVE_FRAMES)
    sleep(1)
    assert_eq(evaluate("window.leaveFrames.meter ?? 0"), 0, "the mixer's meter stopped")
    assert_eq(evaluate("window.leaveFrames.follow ?? 0"), 0, "the playhead stopped")
    assert_eq(evaluate("window.leftHandle.playing"), false, "the music stopped")
    assert_eq(evaluate("window.leftStudio.studio.playing"), nil)
    assert_eq(evaluate("window.leftStudio.studio.liveMixer"), nil, "its mixer no longer in the way out")
    assert(
      evaluate("window.fakeMic.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))"),
      "the microphone let go"
    )
    assert_eq(evaluate("window.leftStudio.dataset.room ?? null"), "closed", "the room's socket closed")

    # The next score: Play's synthesizer, made for the first, now goes through its mixer.
    click("a[href='/app/scores/#{next_score._key}']")
    wait_for_text("Your changes save themselves")
    assert_eq(evaluate("document.querySelector('#studio') === window.leftStudio"), false)
    click(".studio-play")
    wait_for_text("Playing", {"timeout": 20})
    leave_wait("document.querySelector('#studio').studio.playing?.handle?.playing === true")
    assert_not_null(
      evaluate("document.querySelector('#studio').studio.liveMixer ? 'mixer' : null"),
      "the next score's mixer is heard"
    )
    evaluate("document.querySelector('[data-act=\"stop\"]').click()")
    assert_no_page_errors()
  end
end
