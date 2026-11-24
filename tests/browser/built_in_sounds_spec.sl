# The built-in orchestra (#1040), in a real browser (soli test --browser): a
# score played on a built-in instrument, its articulations following the
# marks; a bank the site does not have, and the staff on General MIDI all the
# same; the score set to General MIDI in the mixer, and nothing asked of the
# site; and the credit the piano's licence asks for, where the sounds are
# chosen.
#
# The instrument played is the specs' own (tests/fixtures/sounds/, 9 kB: a
# sine that holds, one that dies away), given to the page in place of the
# site's banks — which are not in git.

const ORCH_FIXTURES = "tests/fixtures/sounds"
const ORCH_TUNE = "\\new Staff \\with { midiInstrument = \"acoustic grand\" }"
+ " { \\time 4/4 \\tempo 4 = 60 c''4-. d'' e''-. f'' | g''1 }"

# The page given the fixture's manifest, and its bank in place of what the
# site would send (`missing`: a 404 instead): every address asked for under
# /soundfonts/orchestra/ is kept in window.orchAsked. Nothing of it is left
# in the browser's Cache Storage from another test.
const ORCH_SETUP = """
(async (manifest, encoded, missing) => {
  const url = performance.getEntriesByType('resource').map((e) => e.name)
    .find((n) => n.includes('/eui-score/orchestra.js'));
  const O = await import(url);
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  window.orchAsked = [];
  const real = window.fetch;
  window.fetch = (input, init) => {
    const address = String(input?.url ?? input);
    if (!address.includes('/soundfonts/orchestra/')) return real(input, init);
    window.orchAsked.push(address);
    return Promise.resolve(missing ? new Response('', { status: 404 }) : new Response(bytes.slice()));
  };
  try {
    const cache = await caches.open('eui-score-sounds');
    for (const kept of await cache.keys()) if (kept.url.includes('/soundfonts/orchestra/')) await cache.delete(kept);
  } catch (error) {}
  const read = await O.useManifest(manifest);
  return read.instruments.map((i) => i.id + ':' + i.offset).join(',');
})
"""

# What channel 0 plays while the piece does, as player.js `patchOf` says:
# every preset seen in four seconds, in order, as "bank:program:name".
const ORCH_PATCHES = """
(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name)
    .find((n) => n.includes('/eui-score/player.js'));
  const P = await import(url);
  const seen = [];
  for (let i = 0; i < 400; i++) {
    const studio = document.querySelector('#studio').studio;
    if (studio.playing?.handle) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (let i = 0; i < 50; i++) {
    const patch = P.patchOf(0);
    const said = patch ? patch.bankMSB + ':' + patch.program + ':' + patch.name : 'none';
    if (seen.at(-1) !== said) seen.push(said);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return JSON.stringify({ seen, playing: Boolean(document.querySelector('#studio').studio.playing?.handle) });
})()
"""

# Replaces the source box's text as typing does, then leaves it.
def orch_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.4)
end

def orch_setup(missing)
  manifest = File.read("#{ORCH_FIXTURES}/orchestra.json")
  file = JSON.parse(manifest)["instruments"][0]["file"]
  encoded = Base64.encode(slurp("#{ORCH_FIXTURES}/#{file}", "binary"))
  evaluate("(#{ORCH_SETUP.trim})(#{manifest}, #{JSON.stringify(encoded)}, #{missing})")
end

# Play pressed, and what channel 0 played: {"seen": [...], "playing": true}.
def orch_play
  evaluate("document.querySelector('.studio-play').scrollIntoView({ behavior: 'auto', block: 'center' })")
  click(".studio-play")
  heard = JSON.parse(evaluate(ORCH_PATCHES))
  # Stop, back to the start: the Play button alone would only pause.
  evaluate("document.querySelector('[data-act=\"stop\"]').click()")
  sleep(0.3)
  heard
end

# The mixer opened, as its menu entry opens it.
def orch_mixer
  evaluate("document.querySelector('[data-act=\"mixer\"]').click()")
  sleep(0.5)
end

def orch_asked
  JSON.parse(evaluate("JSON.stringify(window.orchAsked)"))
end

# The object on the text's `%% eui-score` line.
def orch_meta
  JSON.parse(evaluate("(() => { const line = document.querySelector('[data-source]').value"
  + ".match(/^%% eui-score (.*)$/m);"
  + " return line ? line[1] : '{}'; })()"))
end

# Play needs the General MIDI sounds (public/soundfonts/MuseScore_General.sf3,
# 38 MB, not in git: deploy/soundfont.sh fetches it). Without them, a test
# that plays is pending, not passed.
def orch_needs_sounds
  served = evaluate("fetch('/soundfonts/MuseScore_General.sf3?v=0.2')"
  + ".then((r) => { r.body?.cancel(); return r.ok; }, () => false)")
  pending("the General MIDI sounds are not in public/soundfonts/ (deploy/soundfont.sh)") unless served
end

describe("The built-in orchestra, in a browser") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
  end

  test("a staff plays its built-in instrument, staccato where a dot says so; the bank is fetched once and kept") do
    orch_needs_sounds()
    assert_eq(orch_setup(false), "test-tone:32")
    orch_source(ORCH_TUNE)
    heard = orch_play()
    assert(heard["playing"], "the piece played")
    # On the instrument's bank (32, the first slot), never the General MIDI piano's.
    heard["seen"].each do |patch|
      assert_contains(patch, "32:", patch)
    end
    # The first note has a dot, the second none, the third a dot again.
    assert(heard["seen"].includes?("32:1:Test tone staccato"), heard["seen"].join(" | "))
    assert(heard["seen"].includes?("32:0:Test tone sustain"), heard["seen"].join(" | "))
    asked = orch_asked()
    assert_eq(asked.length, 1, "one request for the bank")
    file = JSON.parse(File.read("#{ORCH_FIXTURES}/orchestra.json"))["instruments"][0]["file"]
    assert_contains(asked[0], "/soundfonts/orchestra/#{file}?v=")
    kept = evaluate("caches.open('eui-score-sounds').then((c) => c.keys())"
    + ".then((keys) => keys.filter((k) => k.url.includes('/soundfonts/orchestra/')).length)")
    assert_eq(kept, 1, "kept in the browser, with the default sounds")
    # Played again: from this tab, nothing asked of the site.
    again = orch_play()
    assert(again["seen"].includes?("32:1:Test tone staccato"), again["seen"].join(" | "))
    assert_eq(orch_asked().length, 1)
    # The mixer says what the staff plays, and whom the sounds are owed to.
    orch_mixer()
    chosen = evaluate("document.querySelector('.studio-mixer [data-inst=\"kind\"]').selectedOptions[0].textContent")
    assert_eq(chosen, "Built-in · Test tone")
    credit = evaluate("document.querySelector('.studio-mixer [data-sounds-credit]').textContent")
    assert_contains(credit, "Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0)")
    assert_contains(credit, "VSCO 2 Community Edition")
    # Nothing of it on the score's meta line: the built-in sounds are the default.
    assert(orch_meta()["sounds"].nil?)
    assert(orch_meta()["orchestra"].nil?)
  end

  test("a bank the site does not have: the staff plays its General MIDI sound, and the music plays") do
    orch_needs_sounds()
    orch_setup(true)
    orch_source(ORCH_TUNE)
    heard = orch_play()
    assert(heard["playing"], "the piece played")
    assert_eq(orch_asked().length, 1, "asked for, and not there")
    heard["seen"].each do |patch|
      assert_contains(patch, "0:0:", patch)
    end
    assert_not(heard["seen"].join(" ").contains("Test tone"))
    kept = evaluate("caches.open('eui-score-sounds').then((c) => c.keys())"
    + ".then((keys) => keys.filter((k) => k.url.includes('/soundfonts/orchestra/')).length)")
    assert_eq(kept, 0, "nothing kept of a bank that did not come")
  end

  test("General MIDI chosen for the score in the mixer: kept on its meta line, and no bank is asked for") do
    orch_needs_sounds()
    orch_setup(false)
    orch_source(ORCH_TUNE)
    orch_mixer()
    assert_eq(evaluate("document.querySelector('.studio-mixer [data-inst=\"sounds\"]').value"), "orchestra")
    evaluate("(() => { const box = document.querySelector('.studio-mixer [data-inst=\"sounds\"]'); box.value = 'gm';"
    + " box.dispatchEvent(new Event('change', { bubbles: true })); })()")
    sleep(0.5)
    assert_eq(orch_meta()["sounds"], "gm")
    chosen = evaluate("document.querySelector('.studio-mixer [data-inst=\"kind\"]').selectedOptions[0].textContent")
    assert_eq(chosen, "General MIDI")
    evaluate("document.querySelector('.studio-mixer [data-mixer-close]').click()")
    heard = orch_play()
    assert(heard["playing"], "the piece played")
    heard["seen"].each do |patch|
      assert_contains(patch, "0:0:", patch)
    end
    assert_eq(orch_asked().length, 0)
    # Back to the built-in sounds: the key goes from the line.
    orch_mixer()
    evaluate("(() => { const box = document.querySelector('.studio-mixer [data-inst=\"sounds\"]');"
    + " box.value = 'orchestra'; box.dispatchEvent(new Event('change', { bubbles: true })); })()")
    sleep(0.5)
    assert(orch_meta()["sounds"].nil?)
  end
end
