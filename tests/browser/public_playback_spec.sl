# Play outside the editor, in a real browser (soli test --browser, #682):
# the read page and the examples play a score as the editor does — each
# note at the velocity its meta line sets — and say what they say in the
# page's language. The sounds Play loads are replaced by a tiny SoundFont
# put in the browser's cache, where player.js looks first (as
# microphone_spec.sl does): the music plays silently, its MIDI is real.

const HEARD_PASSWORD = "correct horse battery"
const HEARD_SOURCE = "\\header { title = \"Soft start\" }\n{ c'4 d' e' f' }\n"
+ "%% eui-score {\"velocity\":{\"0:0:60\":20}}\n"

# A score whose first note is set to velocity 20, the others at their
# dynamics — or `source` — open to whoever has its link.
def heard_shared_score(source = HEARD_SOURCE)
  owner = User.new()
  owner.email = "heard-#{uuid_v4}@example.com"
  owner.set_password(HEARD_PASSWORD)
  owner.confirmed_at = DateTime.utc.to_unix
  owner.save
  score = Score.start(owner, source)
  score.make_visible("link")
  score
end

# Every MIDI file the page hands over — to the synthesizer (player.js slices
# its bytes) or saved through a link — kept as each note-on's velocity, in
# the order they sound: window.heardFiles.
const HEARD_HOOKS = """
(() => {
  const velocities = (bytes) => {
    const b = new Uint8Array(bytes);
    const ons = [];
    let i = 14;
    while (i + 8 <= b.length) {
      const length = ((b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]) >>> 0;
      let p = i + 8;
      const end = p + length;
      let tick = 0;
      let status = 0;
      const vlq = () => {
        let x = 0;
        for (;;) { const c = b[p++]; x = (x << 7) | (c & 127); if (!(c & 128)) return x; }
      };
      while (p < end) {
        tick += vlq();
        if (b[p] & 128) status = b[p++];
        if (status === 0xff) { p++; const n = vlq(); p += n; }
        else if (status === 0xf0 || status === 0xf7) { const n = vlq(); p += n; }
        else {
          const kind = status & 0xf0;
          if (kind === 0x90 && b[p + 1] > 0) ons.push([tick, b[p + 1]]);
          p += kind === 0xc0 || kind === 0xd0 ? 1 : 2;
        }
      }
      i = end;
    }
    return ons.sort((x, y) => x[0] - y[0]).map((on) => on[1]);
  };
  const isMidi = (b) => b.length >= 4 && b[0] === 0x4d && b[1] === 0x54 && b[2] === 0x68 && b[3] === 0x64;
  window.heardFiles = [];
  const slice = ArrayBuffer.prototype.slice;
  ArrayBuffer.prototype.slice = function (...args) {
    const out = slice.apply(this, args);
    if (isMidi(new Uint8Array(out, 0, Math.min(4, out.byteLength)))) {
      window.heardFiles.push({ by: 'play', velocities: velocities(out) });
    }
    return out;
  };
  HTMLAnchorElement.prototype.click = function () {
    const name = this.download;
    fetch(this.href).then((r) => r.arrayBuffer()).then((bytes) => {
      const heard = isMidi(new Uint8Array(bytes)) ? velocities(bytes) : null;
      window.heardFiles.push({ by: 'save', name, velocities: heard });
    });
  };
})()
"""

# A SoundFont of one silent sample, in the cache player.js reads its sounds
# from: Play loads it at once, and plays nothing (microphone_spec.sl's).
const HEARD_SOUNDS = """
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

def heard_sounds
  assert_gt(evaluate("(#{HEARD_SOUNDS.trim})()"), 100)
end

# Waits (`seconds` at most) for a JavaScript condition to hold.
def heard_wait(condition, seconds = 10)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < seconds * 5 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < seconds * 5, "waited for: #{condition}")
end

# Waits for the page's `n`th MIDI file handed over by `by` ("play" or "save"), and answers it, or nil.
def heard_file(by, n = 1)
  for tries in range(0, 75)
    files = "(window.heardFiles || []).filter((f) => f.by === '#{by}')"
    found = JSON.parse(evaluate("JSON.stringify(#{files}[#{n - 1}] ?? null)"))
    return found unless found.nil?

    sleep(0.2)
  end
  nil
end

describe("Play on the read page and the examples (#682)") do
  before_each() do
    logout()
  end

  test("Play gives the synthesizer each note at the velocity the score sets for it") do
    score = heard_shared_score()
    visit("/s/#{score.share_token}")
    heard_sounds()
    evaluate(HEARD_HOOKS)
    click("[data-score-play]")
    wait_for(".score-progress", {"timeout": 30})
    played = heard_file("play")
    assert_not_null(played, "a MIDI file played")
    assert_eq(played["velocities"], [
      20,
      90,
      90,
      90
    ])
    assert_eq(evaluate("document.querySelector('.score-progress').getAttribute('aria-label')"), "Playing")
    click("[data-score-play]")
    heard_wait("document.querySelector('.score-progress') === null")
    assert_no_page_errors()
  end

  test("with no source to read, Play plays the page's own MIDI, as written") do
    score = heard_shared_score()
    visit("/s/#{score.share_token}")
    heard_sounds()
    evaluate(HEARD_HOOKS)
    # The figure's MIDI is a data: URL, which the page's connect-src lets no fetch reach (#544).
    evaluate("document.querySelector('[data-score-play]').removeAttribute('data-src')")
    click("[data-score-play]")
    wait_for(".score-progress", {"timeout": 30})
    played = heard_file("play")
    assert_not_null(played, "a MIDI file played")
    assert_eq(played["velocities"], [
      90,
      90,
      90,
      90
    ], "the server's file: no velocity of the meta line")
    click("[data-score-play]")
    heard_wait("document.querySelector('.score-progress') === null")
  end

  test("the MIDI link saves the file as Play plays it, its velocities in") do
    score = heard_shared_score()
    visit("/s/#{score.share_token}")
    evaluate(HEARD_HOOKS)
    click("[data-score-midi]")
    saved = heard_file("save")
    assert_not_null(saved, "a MIDI file saved")
    assert_eq(saved["name"], "soft-start.mid")
    assert_eq(saved["velocities"], [
      20,
      90,
      90,
      90
    ])
    assert_no_page_errors()
  end

  test("the MIDI link that cannot make its file says so under the buttons") do
    score = heard_shared_score()
    visit("/s/#{score.share_token}")
    # The browser refuses to make the file.
    evaluate("URL.createObjectURL = () => { throw new Error('no room for it'); }")
    click("[data-score-midi]")
    assert_text("The MIDI file could not be made: no room for it")
  end

  test("a Play that cannot start says so, and closes the sound its click opened") do
    score = heard_shared_score()
    visit("/s/#{score.share_token}")
    # No source to play in the browser, and the server's file out of reach.
    evaluate("(() => { const button = document.querySelector('[data-score-play]');"
    + " button.removeAttribute('data-src'); button.setAttribute('data-midi', '/no-such.mid');"
    + " const fetched = window.fetch; window.fetch = (url, ...rest) => String(url).includes('no-such')"
    + " ? Promise.reject(new Error('offline')) : fetched(url, ...rest);"
    + " const Made = window.AudioContext; window.madeContexts = [];"
    + " window.AudioContext = class extends Made {"
    + " constructor(...a) { super(...a); window.madeContexts.push(this); } }; })()")
    click("[data-score-play]")
    assert_text("The player could not be loaded.")
    heard_wait("window.madeContexts.length === 1 && window.madeContexts[0].state === 'closed'")
    assert_eq(evaluate("document.querySelector('[data-score-play]').textContent.trim()"), "▶ Play")
  end

  test("an example's player speaks French at /fr") do
    visit("/fr/examples/piano/waltz")
    heard_sounds()
    assert_eq(evaluate("document.querySelector('[data-score-play]').textContent.trim()"), "▶ Lecture")
    click("[data-score-play]")
    wait_for(".score-progress", {"timeout": 30})
    assert_eq(evaluate("document.querySelector('.score-progress').getAttribute('aria-label')"), "Lecture en cours")
    assert_eq(evaluate("document.querySelector('[data-score-play]').textContent.trim()"), "■ Stop")
    click("[data-score-play]")
    heard_wait("document.querySelector('.score-progress') === null")
    assert_eq(evaluate("document.querySelector('[data-score-play]').textContent.trim()"), "▶ Lecture")
    assert_no_page_errors()
  end

  test("the read page's parts are named in the page's language") do
    # A staff of no name, on an instrument the editor does not list: "Staff 1" in English.
    score = heard_shared_score("\\new Staff \\with { midiInstrument = \"kalimba\" } { c'4 d' }\n")
    visit("/s/#{score.share_token}")
    evaluate("document.documentElement.lang = 'fr'")
    click("[data-read-parts]")
    wait_for("[data-read-part]:not([hidden])")
    assert_eq(evaluate("document.querySelector('[data-read-part-staff] option').textContent"), "Portée 1")
  end
end
