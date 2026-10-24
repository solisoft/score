# Past fifteen staves and grace notes, in a real browser (soli test
# --browser, #389): the MIDI saved from the playground gives each staff a
# channel of its own (a second MIDI port past fifteen), and its grace notes
# are played as their kind asks.

const WIDE_SOUNDS = [
  "acoustic grand",
  "violin",
  "viola",
  "cello",
  "flute",
  "oboe",
  "clarinet",
  "bassoon",
  "trumpet",
  "trombone",
  "french horn",
  "tuba",
  "orchestral harp",
  "marimba",
  "vibraphone",
  "celesta",
  "church organ",
  "acoustic guitar (nylon)",
  "electric bass (finger)",
  "choir aahs"
]

# Twenty staves, each its own instrument, and a drum kit.
def wide_score
  staves = WIDE_SOUNDS.map do |sound|
    "\\new Staff \\with { midiInstrument = \"#{sound}\" } { c'4 d' e' f' }"
  end
  "<< " + staves.join(" ") + " \\new DrumStaff \\drummode { bd4 sn bd sn } >> "
end

# Replaces the source box's text as typing does, then leaves it.
def wide_type_source(text)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(text)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.8)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
end

# Save as MIDI, the file caught as it is made: window.savedBlob.
def wide_save_midi
  evaluate("(() => { window.savedBlob = null; const made = URL.createObjectURL;"
  + " URL.createObjectURL = (blob) => { window.savedBlob = blob; return made(blob); };"
  + " HTMLAnchorElement.prototype.click = function () {}; })()")
  evaluate("document.querySelector('[data-act=\"save-midi\"]').click()")
  sleep(1.2)
end

# The saved MIDI file read: { division, tracks: [{ port, channels, programs, ons: [[tick, key]] }] }, as JSON.
const WIDE_READ = """
(async () => {
  const b = new Uint8Array(await window.savedBlob.arrayBuffer());
  const division = (b[12] << 8) | b[13];
  const tracks = [];
  let at = 14;
  while (at < b.length) {
    const end = at + 8 + ((b[at + 4] << 24) | (b[at + 5] << 16) | (b[at + 6] << 8) | b[at + 7]);
    let q = at + 8, running = 0, tick = 0;
    const track = { port: 0, channels: [], programs: [], ons: [] };
    const number = () => { let v = 0, x; do { x = b[q++]; v = (v << 7) | (x & 127); } while (x & 128); return v; };
    while (q < end) {
      tick += number();
      let status = b[q];
      if (status & 128) q++; else status = running;
      running = status;
      if (status === 0xff) {
        const type = b[q++];
        const size = number();
        if (type === 0x21) track.port = b[q];
        q += size;
      }
      else if (status === 0xf0 || status === 0xf7) { const size = number(); q += size; }
      else {
        const kind = status & 0xf0;
        if (!track.channels.includes(status & 15)) track.channels.push(status & 15);
        const first = b[q++];
        const second = kind === 0xc0 || kind === 0xd0 ? 0 : b[q++];
        if (kind === 0xc0) track.programs.push(first);
        if (kind === 0x90 && second > 0) track.ons.push([tick, first]);
      }
    }
    tracks.push(track);
    at = end;
  }
  return JSON.stringify({ division, tracks });
})()
"""

def wide_read
  JSON.parse(evaluate(WIDE_READ))
end

describe("Twenty staves and grace notes, saved as MIDI from the playground") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    sleep(1)
  end

  test("twenty staves and a kit: a channel each, a second port, the kit on the tenth, each its instrument") do
    wide_type_source(wide_score())
    evaluate("document.querySelector('.tool-mixer').click()")
    wait_for(".studio-mixer[open]")
    assert_eq(
      evaluate("document.querySelectorAll('.studio-mixer .mixer-strip').length"),
      22,
      "twenty-one staves and the master"
    )
    wide_save_midi()
    midi = wide_read()
    tracks = midi["tracks"]
    assert_eq(tracks.length, 21)
    places = tracks.map do |track|
      "#{track["port"]}:#{track["channels"].join(",")}"
    end
    assert_eq(places.uniq.length, 21, "no two staves on one channel: #{places.join(" ")}")
    assert_eq(places[20], "0:9", "the kit on the tenth channel of the first port")
    assert_eq(tracks.filter(&{ |track|
      track["port"] == 1
    }).length, 5, "the five past fifteen on a second port")
    assert_eq(tracks.filter(&{ |track|
      track["port"] == 1 && track["channels"].includes?(9)
    }).length, 0)
    # Each staff keeps its own instrument: twenty programs, all different.
    programs = tracks.slice(0, 20).map do |track|
      track["programs"][0]
    end
    assert_eq(programs.uniq.length, 20)
    assert_no_page_errors()
  end

  test("an acciaccatura before the beat, an appoggiatura half its note") do
    wide_type_source("{ \\tempo 4 = 100 c'4 \\acciaccatura d'8 e'4 \\appoggiatura d'8 e'4 r4 }")
    wide_save_midi()
    midi = wide_read()
    quarter = midi["division"]
    ons = midi["tracks"][0]["ons"]
    assert_eq(ons.map(&{ |on|
      on[1]
    }), [60, 62, 64, 62, 64])
    # 60 ms at 100 a quarter is a tenth of a quarter: the grace note that much before the beat.
    assert_eq(ons[1][0], quarter - quarter / 10)
    assert_eq(ons[2][0], quarter, "the note on its beat")
    assert_eq(ons[3][0], 2 * quarter, "the appoggiatura on the beat")
    assert_eq(ons[4][0], 2 * quarter + quarter / 2, "its note half a quarter late")
    assert_no_page_errors()
  end
end
