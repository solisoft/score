# The read page in a real browser (soli test --browser): its buttons stay in
# sight over a long score (#830), and Written pitch draws it as its players
# read it, the address following, a link opening in it (#831).

const READ_PASSWORD = "correct horse battery"

# A score open to whoever has its link.
def read_shared_score(source)
  owner = User.new()
  owner.email = "read-#{uuid_v4}@example.com"
  owner.set_password(READ_PASSWORD)
  owner.confirmed_at = DateTime.utc.to_unix
  owner.save
  score = Score.start(owner, source)
  score.make_visible("link")
  score
end

# A clarinet's line long enough to scroll, in C major as it sounds.
def read_clarinet_source
  bars = (1 .. 161).map do |i|
    "c'4 d' e' f'"
  end.join(" | ")
  "\\header { title = \"Clarinet line\" }\n\\new Staff \\with { instrumentName = \"Clarinet\" "
  + "midiInstrument = \"clarinet\" } { \\key c \\major #{bars} }\n"
end

# Waits (`seconds` at most) for a JavaScript condition to hold.
def read_wait(condition, seconds = 15)
  tries = 0
  check = "(() => { try { return Boolean(#{condition}); } catch (e) { return false; } })()"
  while tries < seconds * 5 && evaluate(check) != true
    sleep(0.2)
    tries = tries + 1
  end
  assert(tries < seconds * 5, "waited for: #{condition}")
end

describe("The read page in a browser (#830, #831)") do
  before_each() do
    logout()
  end

  test("Play stays in sight while a long score scrolls") do
    score = read_shared_score(read_clarinet_source())
    visit("/s/#{score.share_token}")
    assert_eq(evaluate("getComputedStyle(document.querySelector('.score-actions-top')).position"), "sticky")
    # Far enough for the score's top to be gone; a short scroll, which the
    # test server's dev tools take in their stride.
    evaluate("window.scrollTo(0, 700)")
    read_wait("window.scrollY >= 600")
    top = evaluate("document.querySelector('[data-score-play]').getBoundingClientRect().top")
    assert_gt(top, 0)
    assert_lt(top, 200, "under the header, not scrolled away with the score")
    assert_lt(
      evaluate("document.querySelector('.score-sheet').getBoundingClientRect().top"),
      0,
      "the score's top is gone"
    )
    assert_no_page_errors()
  end

  test("Written pitch redraws the score as its players read it, and back; the address follows") do
    score = read_shared_score(read_clarinet_source())
    visit("/s/#{score.share_token}")
    evaluate("window.concert = document.querySelector('.score-sheet').innerHTML")
    click("[data-score-written]")
    read_wait("document.querySelector('.score-figure').dataset.pitch === 'written'")
    assert_eq(evaluate("document.querySelector('[data-score-written]').getAttribute('aria-pressed')"), "true")
    assert_eq(evaluate("location.search"), "?pitch=written")
    assert(evaluate("document.querySelector('.score-sheet svg') !== null"), "a score drawn")
    assert(evaluate("document.querySelector('.score-sheet').innerHTML !== window.concert"), "drawn anew")
    click("[data-score-written]")
    read_wait("document.querySelector('.score-figure').dataset.pitch === undefined")
    assert(evaluate("document.querySelector('.score-sheet').innerHTML === window.concert"), "the concert score back")
    assert_eq(evaluate("location.search"), "")
    assert_eq(evaluate("document.querySelector('[data-score-written]').getAttribute('aria-pressed')"), "false")
    assert_no_page_errors()
  end

  test("a link with ?pitch=written opens in it, a tone up for the clarinet, and prints that") do
    score = read_shared_score(read_clarinet_source())
    visit("/s/#{score.share_token}?pitch=written")
    read_wait("document.querySelector('.score-figure').dataset.pitch === 'written'")
    assert_eq(evaluate("document.querySelector('[data-score-written]').getAttribute('aria-pressed')"), "true")
    # The source the PDF is printed from while it is shown: a tone up, as a B♭ clarinet reads it.
    written = evaluate("document.querySelector('.score-figure').__writtenSrc")
    assert_contains(written, "\\transpose c d {")
    assert_no_page_errors()
  end

  test("a flute's score offers no Written pitch, whatever the link asks") do
    score = read_shared_score("\\new Staff \\with { midiInstrument = \"flute\" } { c''1 }")
    visit("/s/#{score.share_token}?pitch=written")
    assert(evaluate("document.querySelector('[data-score-written]') === null"), "no button")
    assert(evaluate("document.querySelector('.score-figure').dataset.pitch === undefined"), "concert pitch")
    assert_no_page_errors()
  end
end
