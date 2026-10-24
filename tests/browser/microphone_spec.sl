# The microphone in the editor, in a real browser (soli test --browser,
# #390). There is no microphone here: the page's getUserMedia is replaced by
# one that answers an oscillator's stream (a sawtooth, rich in harmonics, as
# an instrument is), or refuses as a person who says no. The sounds Play
# loads are replaced by a tiny SoundFont put in the browser's cache, where
# player.js looks first: the music plays silently, its clock runs.

const MIC_PASSWORD = "correct horse battery"
const MIC_SOURCE = "\\header { title = \"Sung\" }\n"
+ "\\new Staff { \\time 4/4 \\tempo 4 = 120 c'4 d' e' f' | g'1 | r1 | r1 }\n"

# Waits (`seconds` at most) for a JavaScript condition to hold.
def mic_wait(condition, seconds = 10)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < seconds * 5 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < seconds * 5, "waited for: #{condition}")
end

# Signs up and in, makes the score and opens it in the editor. Answers {"score", "user"}.
def mic_open(source = MIC_SOURCE)
  email = "mic-#{uuid_v4}@example.com"
  visit("/signup")
  fill_in("#email", email)
  fill_in("#password", MIC_PASSWORD)
  # The form refuses what is sent back within two seconds of being shown.
  sleep(2.2)
  click("form.auth-form button[type=submit]")
  wait_for_text("Check your inbox")
  user = User.find_by("email", email)
  visit("/confirm_email?token=#{user.start_email_confirmation}")
  wait_for_text("Your email address is confirmed")
  login(email, MIC_PASSWORD)
  score = Score.start(user, source)
  visit("/app/scores/#{score._key}")
  wait_for_text("Your changes save themselves")
  {"score": score, "user": user}
end

# The microphone replaced by an oscillator at `freq` Hz: window.fakeMic.osc
# changes its pitch, window.fakeMic.asked counts the times it was asked for.
const MIC_FAKE = """
(freq) => {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = 0.25;
  const out = ctx.createMediaStreamDestination();
  osc.connect(gain);
  gain.connect(out);
  osc.start();
  window.fakeMic = { ctx, osc, gain, asked: 0 };
  navigator.mediaDevices.getUserMedia = async () => {
    window.fakeMic.asked++;
    await ctx.resume();
    // A stream of its own each time, as a browser gives: stopping it leaves the next one alive.
    return new MediaStream(out.stream.getAudioTracks().map((track) => track.clone()));
  };
}
"""

def mic_fake(freq)
  evaluate("(#{MIC_FAKE.trim})(#{freq})")
end

# A SoundFont of one silent sample, put in the cache player.js reads its
# sounds from: Play loads it at once, and plays nothing.
const MIC_SOUNDS = """
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

def mic_sounds
  assert_gt(evaluate("(#{MIC_SOUNDS.trim})()"), 100)
end

# The fake microphone plays `freqs` (Hz), a second each from now, then falls silent.
def mic_sing(freqs)
  evaluate("(() => { const { ctx, osc, gain } = window.fakeMic; const now = ctx.currentTime;"
  + " #{JSON.stringify(freqs)}.forEach((f, k) => osc.frequency.setValueAtTime(f, now + k));"
  + " gain.gain.setValueAtTime(0.25, now); gain.gain.setValueAtTime(0, now + #{freqs.length}); })()")
end

# The text of the score as the editor has it.
def mic_text
  evaluate("document.querySelector('[data-source]').value")
end

# A microphone the person refuses.
def mic_refuse
  evaluate("navigator.mediaDevices.getUserMedia = async () => {"
  + " throw new DOMException('Permission denied', 'NotAllowedError'); }")
end

# The Play menu's item `act`, clicked.
def mic_menu(act)
  evaluate("document.querySelector('.studio-dropdown [data-act=\"#{act}\"]').click()")
end

# The tuner's reading, "A4 0": the note and its cents.
def mic_heard
  evaluate("document.querySelector('.studio-tuner').dataset.heard ?? ''")
end

describe("The microphone in the editor, in a browser") do
  before_each() do
    logout()
  end

  test("the tuner names the note heard, its octave and how far off, against the A4 chosen") do
    mic_open()
    mic_fake(440)
    mic_menu("tuner")
    wait_for(".studio-tuner[open]")
    click(".studio-tuner [data-tuner-start]")
    mic_wait("document.querySelector('[data-tuner-name]').textContent === 'A'")
    assert_eq(evaluate("document.querySelector('[data-tuner-octave]').textContent"), "4")
    mic_wait("Math.abs(Number(document.querySelector('.studio-tuner').dataset.heard.split(' ')[1])) <= 3")
    assert_text("in tune")
    # A little sharp: 452 Hz is 47 cents over A4 = 440 …
    evaluate("window.fakeMic.osc.frequency.value = 452")
    mic_wait("document.querySelector('[data-tuner-cents]').textContent.includes('sharp')")
    mic_wait("Math.abs(Number(document.querySelector('.studio-tuner').dataset.heard.split(' ')[1]) - 47) <= 3")
    # … and in tune against A4 = 452.
    evaluate("(() => { const box = document.querySelector('[data-tuner-a4]'); box.value = '452';"
    + " box.dispatchEvent(new Event('change', { bubbles: true })); })()")
    mic_wait("Math.abs(Number(document.querySelector('.studio-tuner').dataset.heard.split(' ')[1])) <= 3")
    assert_eq(evaluate("localStorage.getItem('eui-score-tuner-a4')"), "452")
    # Down an octave and a fifth: D3, a little flat against 452.
    evaluate("window.fakeMic.osc.frequency.value = 146.83")
    mic_wait("document.querySelector('.studio-tuner').dataset.heard.startsWith('D3 ')")
    assert_contains(mic_heard(), "D3")
    click(".studio-tuner [data-tuner-start]")
    assert_eq(evaluate("document.querySelector('[data-tuner-start]').textContent"), "Start listening")
    assert_eq(evaluate("window.fakeMic.asked"), 1)
    assert_no_page_errors()
  end

  test("a take recorded with Play: kept, its waveform, its fader, its notes written into a staff, deleted") do
    opened = mic_open()
    score = opened["score"]
    mic_sounds()
    mic_fake(330)
    evaluate("window.fakeMic.gain.gain.value = 0")
    mic_menu("audio-tracks")
    wait_for(".studio-audio[open]")
    evaluate("document.querySelector('[data-audio-name=\"1\"]').value = 'Voice'")
    click(".studio-audio [data-audio-record='1']")
    wait_for_text("Recording into Voice", {"timeout": 20})
    # E4, G4, A4, a second each: half notes at 120 to the quarter.
    mic_sing([329.63, 392, 440])
    sleep(3.4)
    click(".studio-audio [data-audio-record='1']")
    wait_for_text("Recorded 0:0", {"timeout": 20})
    take = ScoreTake.where({"score_id": score._key}).first
    assert_not_null(take)
    assert_eq(take.track, 1)
    assert_eq(take.name, "Voice")
    assert_eq(take.rate, 1)
    # From a quarter of a second before bar 1, for about 3.4 s: the count-in left out.
    assert(take.offset > -0.6 && take.offset < 0.3, "offset #{take.offset}")
    assert(take.duration > 2.8 && take.duration < 4.5, "duration #{take.duration}")
    assert(take.size > 100000, "the WAV's bytes")
    # Its waveform under the staves, in the MIDI view.
    evaluate("document.querySelector('[data-midi-button]').click()")
    wait_for(".studio-waves .wave-strip")
    assert_contains(evaluate("document.querySelector('.wave-strip').getAttribute('aria-label')"), "Voice")
    assert(evaluate("document.querySelector('.wave-line').getAttribute('d').length") > 50, "a waveform drawn")
    # Its own fader in the mixer, kept with the score.
    mic_menu("mixer")
    wait_for(".studio-mixer [data-strip='audio-1']")
    evaluate("(() => { const el = document.querySelector(\".studio-mixer [data-lane='audio-1'][data-field='volume']\");"
    + " el.value = '-12'; el.dispatchEvent(new Event('change', { bubbles: true })); })()")
    mic_wait("document.querySelector('[data-source]').value.includes('\"audio-1\":{\"volume\":-12}')")
    evaluate("document.querySelector('.studio-mixer [data-mixer-close]').click()")
    # Its notes, written into the staff, in one Undo.
    click(".studio-audio [data-audio-transcribe]")
    wait_for_text("from Voice into", {"timeout": 20})
    written = mic_text()
    music = written.substring(written.index_of("\\time"), written.length)
    assert_not(music.contains("c'4 d'"), "bar 1 replaced")
    assert(
      music.index_of("e'") >= 0 && music.index_of("e'") < music.index_of("g'") &&
          music.index_of("g'") < music.index_of("a'"),
      music
    )
    evaluate("document.querySelector('[data-act=\"undo\"]').click()")
    mic_wait("document.querySelector('[data-source]').value.includes(\"c'4 d'\")")
    assert_contains(mic_text(), "audio-1")
    # Kept on the server: there again after a reload, once the score is saved.
    mic_wait("document.querySelector('[data-save-state]').textContent === 'Saved'")
    visit("/app/scores/#{score._key}")
    wait_for_text("Your changes save themselves")
    evaluate("document.querySelector('[data-midi-button]').click()")
    wait_for(".studio-waves .wave-strip")
    # Played with the score: paused, played on, stopped, without an error.
    click(".studio-play")
    wait_for_text("Playing", {"timeout": 20})
    sleep(0.6)
    evaluate("document.querySelector('.studio-play').click()")
    wait_for_text("Paused")
    evaluate("document.querySelector('.studio-play').click()")
    wait_for_text("Playing")
    evaluate("document.querySelector('[data-act=\"stop\"]').click()")
    # Deleted, after a second press.
    mic_menu("audio-tracks")
    wait_for(".studio-audio [data-audio-delete='1']")
    click(".studio-audio [data-audio-delete='1']")
    assert_eq(evaluate("document.querySelector('[data-audio-delete=\"1\"]').textContent"), "Delete for good?")
    assert_eq(ScoreTake.where({"score_id": score._key}).count, 1)
    click(".studio-audio [data-audio-delete='1']")
    wait_for_text("take is deleted")
    assert_eq(ScoreTake.where({"score_id": score._key}).count, 0)
    assert_no_selector(".wave-strip")
    assert_no_page_errors()
  end

  test("practice: the place follows the notes played, past a wrong one") do
    mic_open()
    mic_fake(330)
    evaluate("window.fakeMic.gain.gain.value = 0")
    mic_menu("practice")
    wait_for(".studio-practice[open]")
    click(".studio-practice [data-practice-start]")
    mic_wait("document.querySelector('[data-practice-start]').getAttribute('aria-pressed') === 'true'")
    assert_eq(evaluate("document.querySelector('[data-practice-next]').textContent"), "C4, bar 1")
    # C D, then a wrong F♯, then E: the place moves on to F.
    mic_sing([261.63, 293.66, 369.99, 329.63])
    mic_wait("document.querySelector('.studio-practice').dataset.at === '3'", 15)
    assert_text("F4, bar 1")
    assert_eq(evaluate("document.querySelector('[data-practice-heard]').textContent"), "E4")
    click(".studio-practice [data-practice-start]")
    assert_no_page_errors()
  end

  test("a refused microphone: a clear message, and nothing listens") do
    mic_open()
    mic_refuse()
    mic_menu("tuner")
    click(".studio-tuner [data-tuner-start]")
    wait_for_text("The microphone was refused")
    assert_eq(evaluate("document.querySelector('[data-tuner-start]').textContent"), "Start listening")
    mic_menu("audio-tracks")
    wait_for(".studio-audio[open]")
    click(".studio-audio [data-audio-record='1']")
    wait_for_text("The microphone was refused")
    assert_eq(ScoreTake.count, 0)
  end
end
