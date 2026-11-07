# A score's link (#s=…, the playground's Share) opened in a real browser
# (#688): over a draft of another score it asks before replacing it, and a
# link that unfolds past what a score can be is refused, read no further.

const SHARE_DRAFT = "\\header { title = \"My draft\" }\n{ \\time 4/4 c'4 d' e' f' | g'1 }"
const SHARE_SENT = "\\header { title = \"Sent to me\" }\n{ \\time 3/4 a'4 b' c'' | d''2. }"

# The playground opened by a link that holds `text`, by a full load, as a
# link clicked elsewhere opens it.
def share_open(text)
  share_open_made(JSON.stringify(text))
end

# The same, the text made in the page by the script `made`.
def share_open_made(made)
  visit("/pricing")
  code = evaluate("(async () => { const bytes = new Uint8Array(await new Response(new Blob([#{made}])"
  + ".stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); let binary = '';"
  + " for (const b of bytes) binary += String.fromCharCode(b);"
  + " return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); })()")
  visit("/playground#s=#{code}")
  wait_for("[data-source]")
end

# The playground's draft set to `text`, as writing it there leaves it.
def share_keep_draft(text)
  visit("/playground")
  wait_for("[data-source]")
  evaluate("localStorage.setItem('eui-score-studio-draft', #{JSON.stringify(text)})")
end

def share_source
  evaluate("document.querySelector('[data-source]').value")
end

def share_draft
  evaluate("localStorage.getItem('eui-score-studio-draft')")
end

def text_of_ask(selector)
  evaluate("document.querySelector(#{JSON.stringify(selector)}).textContent")
end

def share_asking?
  evaluate("Boolean(document.querySelector('[data-shared-ask]')?.open)")
end

# Waits for the editor to have read what it opened: its status says so.
def share_wait_said(words)
  wait_for_text(words)
  sleep(0.3)
end

describe("A shared link in the playground, in a browser") do
  before_each() do
    visit("/playground")
    wait_for("[data-source]")
    evaluate("localStorage.removeItem('eui-score-studio-draft')")
  end

  test("over a draft of another score, it asks; kept, the draft stays as it was") do
    share_keep_draft(SHARE_DRAFT)
    share_open(SHARE_SENT)
    wait_for("[data-shared-ask][open]")
    assert_eq(text_of_ask("[data-shared-ask-shared]"), "Sent to me")
    assert_eq(text_of_ask("[data-shared-ask-draft]"), "My draft")
    # Until answered, the draft is what is open, and what is kept.
    assert_contains(share_source(), "My draft")
    assert_eq(share_draft(), SHARE_DRAFT)
    # The link has left the address bar: a reload opens the draft.
    assert_eq(evaluate("location.hash"), "")
    click("[data-shared-keep]")
    share_wait_said("Your draft is kept: the shared score was not opened.")
    assert_not(share_asking?())
    assert_contains(share_source(), "My draft")
    assert_eq(share_draft(), SHARE_DRAFT)
    assert_no_page_errors()
  end

  test("opened, the shared score replaces the draft, and Undo brings the draft back") do
    share_keep_draft(SHARE_DRAFT)
    share_open(SHARE_SENT)
    wait_for("[data-shared-ask][open]")
    click("[data-shared-open]")
    share_wait_said("A shared score.")
    assert_not(share_asking?())
    assert_contains(share_source(), "Sent to me")
    assert_contains(share_draft(), "Sent to me")
    evaluate("document.querySelector(\"[data-act='undo']\").click()")
    sleep(0.5)
    assert_contains(share_source(), "My draft")
    assert_no_page_errors()
  end

  test("with no draft, or the same score, it opens without asking") do
    share_open(SHARE_SENT)
    share_wait_said("A shared score.")
    assert_not(share_asking?())
    assert_contains(share_source(), "Sent to me")
    assert_contains(share_draft(), "Sent to me")
    same = share_draft()
    share_open(same)
    share_wait_said("A shared score.")
    assert_not(share_asking?())
    assert_no_page_errors()
  end

  test("a link that unfolds past what a score can be is refused; the draft stays") do
    share_keep_draft(SHARE_DRAFT)
    # Three million letters: a link of a few kilobytes, past the two million bytes read.
    share_open_made("'c'.repeat(3000000)")
    share_wait_said("That link holds no score: here is your last one.")
    assert_not(share_asking?())
    assert_contains(share_source(), "My draft")
    assert_eq(share_draft(), SHARE_DRAFT)
    assert_no_page_errors()
  end
end
