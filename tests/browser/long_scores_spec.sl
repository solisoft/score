# Long scores in the editor, in a real browser (soli test --browser, #689):
# an edit engraves the score once — the drawing it is checked with is the
# one shown — and while the music plays, the notes are lit over the
# drawing as it stands: the score is not written, engraved and put on the
# page again for each note.

# Four staves of eighth notes, `bars` long, quick enough to light many notes a second.
def long_score(bars)
  bar = "c'8 d' e' f' g' a' b' c'' | "
  music = (0 .. bars).map do |_|
    bar
  end.join("")
  staff = "\\new Staff { #{music} }"
  first = "\\new Staff { \\tempo 4 = 240 #{music} }"
  "\\header { title = \"Long\" }\n<< #{first} #{staff} #{staff} #{staff} >>\n"
end

# Replaces the source box's text as typing does, then leaves it.
def long_type_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(1)
end

# Waits (`seconds` at most) for a JavaScript condition to hold.
def long_wait(condition, seconds = 10)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < seconds * 5 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < seconds * 5, "waited for: #{condition}")
end

def engravings
  evaluate("document.querySelector('#studio').studio.engravings ?? 0")
end

# A SoundFont of one silent sample, put in the cache player.js reads its
# sounds from: Play loads it at once, and plays nothing (editor_leave_spec's).
const LONG_SOUNDS = """
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

describe("A long score in the editor (#689)") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
    long_type_source(long_score(40))
  end

  test("an edit engraves the score once: the drawing it is checked with is the one shown") do
    # A note selected on the score, then moved a step up from the keyboard.
    evaluate("(() => { const box = document.querySelector('[data-source]');"
    + " const at = box.value.indexOf(\"e'8\"); box.focus(); box.setSelectionRange(at + 1, at + 1);"
    + " box.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()")
    sleep(0.5)
    evaluate("document.querySelector('.studio-sheet').focus()")
    before_text = evaluate("document.querySelector('[data-source]').value")
    before = engravings()
    press("ArrowUp")
    long_wait("document.querySelector('[data-source]').value !== #{JSON.stringify(before_text)}")
    sleep(0.5)
    assert_eq(engravings() - before, 1, "engraved once for the edit")
    after_text = evaluate("document.querySelector('[data-source]').value")
    assert_eq(after_text.split("f'8").length - before_text.split("f'8").length, 1, "the e moved up to an f")
    # And the drawing shows it: the selected note, lit, is the one moved.
    assert_text("Note F4")
    # Undone: back as it was.
    press("Ctrl+z")
    long_wait("document.querySelector('[data-source]').value === #{JSON.stringify(before_text)}")
    assert_no_page_errors()
  end

  test("playing lights the notes over the drawing as it stands: the score is not drawn again for each note") do
    assert(evaluate("(#{LONG_SOUNDS.trim})()") > 100, "the silent sounds in the cache")
    click(".studio-play[data-act=\"play\"]")
    long_wait("document.querySelector('#studio').studio.playing?.handle?.playing === true")
    # Drawn once as it is while playing; then the notes lit, one after another.
    long_wait("(document.querySelector('#studio').studio.playing?.lit ?? -1) >= 0")
    sleep(0.3)
    evaluate("window.drawnSvg = document.querySelector('.studio-svg svg')")
    first_lit = evaluate("document.querySelector('#studio').studio.playing.lit")
    started = engravings()
    long_wait("(document.querySelector('#studio').studio.playing?.lit ?? -1) > #{first_lit + 8}")
    # Many notes lit since, on the same picture: no new engraving, no picture swapped in.
    assert(evaluate("document.querySelector('.studio-svg svg') === window.drawnSvg"), "the same picture")
    assert(engravings() - started <= 1, "at most the one engraving of the notes' coloured copies")
    lit = evaluate("[...document.querySelectorAll('.studio-svg svg > .studio-playing [fill]')]"
    + ".map((e) => e.getAttribute('fill'))")
    assert(lit.length > 0, "the notes playing drawn over the score")
    assert(lit.all?(&{ |fill|
      fill == "#0f9d47"
    }), "in the colour of the notes playing")
    # One group only, the notes before it no longer lit.
    assert_eq(evaluate("document.querySelectorAll('.studio-svg svg > .studio-playing').length"), 1)
    # The band over what sounds follows them.
    assert_not(evaluate("document.querySelector('.studio-playhead').hidden"))
    evaluate("document.querySelector('[data-act=\"stop\"]').click()")
    long_wait("document.querySelector('#studio').studio.playing === null")
    sleep(0.3)
    assert_eq(
      evaluate("document.querySelectorAll('.studio-svg svg .studio-playing').length"),
      0,
      "unlit once stopped"
    )
    assert_no_page_errors()
  end
end
