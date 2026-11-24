# The built-in orchestra (#1040) as the site serves it: the manifest and a
# bank as static files — immutable once asked for with their version — the
# credit the piano's licence asks for, and the deploy that puts the banks in
# a release without ever uploading them with it.
#
# The banks themselves are not in git (scripts/sounds/build.py makes them):
# the bank served here is the specs' 9 kB instrument, copied into public/ for
# the time of a test.

const SOUNDS_FIXTURE = "tests/fixtures/sounds"
const SOUNDS_PUBLIC = "public/soundfonts/orchestra"

# The fixture's instrument, as its manifest names it.
def sounds_fixture
  JSON.parse(File.read("#{SOUNDS_FIXTURE}/orchestra.json"))["instruments"][0]
end

describe("the built-in orchestra's manifest") do
  test("is served, and names each instrument's file by its digest") do
    response = get("/soundfonts/orchestra.json")
    assert_eq(res_status(response), 200)
    assert_contains(res_header(response, "Content-Type"), "json")
    manifest = JSON.parse(res_body(response))
    assert(manifest["instruments"].length >= 20, "the instruments")
    manifest["instruments"].each do |instrument|
      assert_eq(instrument["sha256"].length, 64, instrument["id"])
      assert_eq(instrument["file"], "#{instrument["id"]}.#{instrument["sha256"].substring(0, 16)}.sf3")
      assert(instrument["size"] > 0, instrument["id"])
      assert(instrument["articulations"].includes?("sustain"), instrument["id"])
    end
    assert_eq(manifest["base"], "/soundfonts/orchestra/")
  end

  test("is kept for good under its version, and five minutes without one") do
    versioned = get("/soundfonts/orchestra.json?v=#{ScoreAssets.version}")
    assert_eq(res_status(versioned), 200)
    assert_contains(res_header(versioned, "Cache-Control"), "immutable")
    assert_contains(res_header(versioned, "Cache-Control"), "max-age=31536000")
    plain = res_header(get("/soundfonts/orchestra.json"), "Cache-Control")
    assert_not(plain.contains("immutable"))
    assert_contains(plain, "max-age=300")
  end

  test("is part of the version the players ask for it under: a bank made again is another address") do
    assert(ScoreAssets.parts.includes?("../soundfonts/orchestra.json"))
    ScoreAssets.parts.each do |name|
      assert(File.exists("public/eui-score/#{name}"), name)
    end
    assert_contains(File.read("public/eui-score/orchestra.js"), "../soundfonts/orchestra.json${V}")
  end

  test("names the two libraries, their checksums and licences; the piano's asks for its credit") do
    sources = JSON.parse(File.read("public/soundfonts/orchestra.json"))["sources"]
    assert_eq(sources.keys.sort, ["salamander", "vsco2ce"])
    assert_eq(sources["vsco2ce"]["license"], "CC0-1.0")
    assert_eq(sources["vsco2ce"]["version"], "1.1.0")
    assert_eq(sources["salamander"]["license"], "CC-BY-3.0")
    assert_eq(sources["salamander"]["credit"], "Alexander Holm")
    sources.keys.each do |id|
      assert_eq(sources[id]["sha256"].length, 64, id)
      assert_contains(sources[id]["url"], "https://github.com/")
    end
  end
end

describe("a built-in instrument's bank") do
  before_each() do
    mkdir_p(SOUNDS_PUBLIC)
    instrument = sounds_fixture()
    barf("#{SOUNDS_PUBLIC}/#{instrument["file"]}", slurp("#{SOUNDS_FIXTURE}/#{instrument["file"]}", "binary"))
  end

  after_each() do
    File.delete("#{SOUNDS_PUBLIC}/#{sounds_fixture()["file"]}")
  end

  test("is served whole from public/, immutable under its digest") do
    instrument = sounds_fixture()
    response = get("/soundfonts/orchestra/#{instrument["file"]}?v=#{instrument["sha256"].substring(0, 16)}")
    assert_eq(res_status(response), 200)
    assert_eq(res_header(response, "Content-Length").to_s, instrument["size"].to_s)
    assert_contains(res_header(response, "Cache-Control"), "immutable")
    assert_contains(res_header(response, "Cache-Control"), "max-age=31536000")
    assert_contains(res_header(response, "Accept-Ranges"), "bytes")
    # The file itself: a SoundFont, the fixture's bytes.
    assert_eq(res_body(response).substring(0, 4), "RIFF")
    served = slurp("#{SOUNDS_PUBLIC}/#{instrument["file"]}", "binary")
    assert_eq(served.length, instrument["size"])
    assert_eq(served, slurp("#{SOUNDS_FIXTURE}/#{instrument["file"]}", "binary"))
  end

  test("a bank the server does not have is a 404: its instrument plays General MIDI") do
    assert_eq(res_status(get("/soundfonts/orchestra/flute.0123456789abcdef.sf3?v=0123456789abcdef")), 404)
    assert_eq(res_status(get("/soundfonts/orchestra/")), 404)
  end

  test("nothing outside public/ is reached through it") do
    assert_eq(res_status(get("/soundfonts/orchestra/..%2F..%2F..%2Fconfig%2Froutes.sl")), 404)
    assert_eq(res_status(get("/soundfonts/orchestra/../../../config/routes.sl")), 404)
  end
end

describe("the credits of the built-in sounds") do
  test("are on every page's last line, in English and in French") do
    english = res_body(get("/"))
    assert_contains(english, "Salamander Grand Piano by Alexander Holm")
    assert_contains(english, "https://creativecommons.org/licenses/by/3.0/")
    assert_contains(english, "VSCO 2 Community Edition by Versilian Studios")
    assert_contains(english, "/soundfonts/orchestra_License.txt")
    french = res_body(get("/fr"))
    assert_contains(french, "Salamander Grand Piano d'Alexander Holm")
    assert_contains(french, "https://creativecommons.org/licenses/by/3.0/")
  end

  test("the licence notice is served: both libraries, and what was changed") do
    response = get("/soundfonts/orchestra_License.txt")
    assert_eq(res_status(response), 200)
    notice = res_body(response)
    assert_contains(notice, "Alexander Holm")
    assert_contains(notice, "CC BY 3.0")
    assert_contains(notice, "CC0 1.0")
    assert_contains(notice, "What was changed")
  end

  test("the guide says what plays, in both languages; the changelog has the day's entry") do
    assert_contains(res_body(get("/guide")), "built-in orchestra")
    assert_contains(res_body(get("/fr/guide")), "orchestre intégré")
    assert_contains(res_body(get("/changelog")), "An orchestra built in")
  end

  test("the editor's French has every instrument's name") do
    words = EditorWords.of("fr")
    JSON.parse(File.read("public/soundfonts/orchestra.json"))["instruments"].each do |instrument|
      assert(words[instrument["name"]].present?, instrument["name"])
    end
    assert_eq(words["Built-in orchestra"], "Orchestre intégré")
  end
end

describe("the deploy of the built-in sounds") do
  test("no bank is in git, nor uploaded with a release: a release links those on the server") do
    ignored = File.read(".gitignore")
    assert_contains(ignored, "/public/soundfonts/orchestra/")
    release = File.read("deploy/release.sh")
    linked = release.index_of("  link_sounds \"$release\"")
    switch = release.index_of("point_site_at \"$release\" ||")
    assert(linked > 0, "the banks linked into the release")
    assert(switch > linked, "before the site is switched to it")
    upload = File.read("deploy/sounds-upload.sh")
    assert_contains(upload, "sha256sum -c")
    assert_contains(upload, "--ignore-existing")
    assert_not(upload.contains("--delete"))
    assert_contains(File.read(".github/workflows/deploy.yml"), "tests/deploy/release_test.sh")
  end
end
