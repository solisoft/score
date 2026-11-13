# The app's forms in a real browser (soli test --browser, #832): a text box
# or a list takes the width of its column, never its own width of about
# twenty letters — on the home page's New score fields, three to a row, and
# in a library card's More, where it pushed the picture and the buttons out
# of the card.

const FIT_PASSWORD = "correct horse battery"

# A signed-in user with one score in their library.
def fit_sign_in
  user = User.new()
  user.email = "fit-#{uuid_v4}@example.com"
  user.set_password(FIT_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.save
  Score.start(user, "\\header { title = \"Scherzo\" composer = \"Johann Strauss\" }\n{ c'4 d' e' f' }\n")
  login(user.email, FIT_PASSWORD)
end

# What sticks out of its box, as "selector: by N px", for each element of
# `inner` inside its closest `outer`.
const FIT_OUT = """
(inner, outer) => [...document.querySelectorAll(inner)].flatMap((el) => {
  const box = el.closest(outer);
  if (!box || el.offsetParent === null) return [];
  const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  const out = Math.round(Math.max(a.right - b.right, b.left - a.left));
  return out > 1 ? [inner + ' in ' + outer + ': by ' + out + ' px at ' + innerWidth] : [];
})
"""

def fit_out(inner, outer)
  evaluate("JSON.stringify((#{FIT_OUT.trim})(#{JSON.stringify(inner)}, #{JSON.stringify(outer)}))")
end

describe("Text boxes keep to their column (#832)") do
  before_each() do
    logout()
  end

  test("the New score fields stay each in its own column, at every width") do
    fit_sign_in()
    [1280, 1100, 900, 390].each do |width|
      viewport(width, 800)
      visit("/app")
      wait_for("#new-title")
      assert_eq(fit_out("#new-score .field input, #new-score .field select", ".field"), "[]")
      assert_eq(fit_out("#new-score .field", ".start-card"), "[]")
    end
    assert_no_page_errors()
  end

  test("a library card's More keeps its title box, its buttons and the picture inside the card") do
    fit_sign_in()
    [1280, 390].each do |width|
      viewport(width, 800)
      visit("/app/scores")
      wait_for(".score-card-more summary")
      click(".score-card-more summary")
      wait_for(".score-card-rename input")
      inside = ".score-card-more input, .score-card-more .btn, .score-card-open img"
      assert_eq(fit_out(inside, ".score-card"), "[]")
    end
    assert_no_page_errors()
  end
end
