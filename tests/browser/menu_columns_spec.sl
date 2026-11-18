# The editor's grouped menus in a real browser (#974): on a wide screen,
# Edit and Insert are two columns, and an item — its label with its
# shortcut or its hint — keeps to its own column, in English and in French,
# whose labels are longer. Before, "Ctrl+Shift+V" ran into "Arpeggiate the
# selected chords…" and a French hint under the next column's label.

const COLUMNS_PASSWORD = "correct horse battery"

# A signed-in user, in `locale`, on a score of theirs, on a wide screen.
def columns_open(locale)
  user = User.new()
  user.email = "columns-#{uuid_v4}@example.com"
  user.set_password(COLUMNS_PASSWORD)
  user.confirmed_at = DateTime.utc.to_unix
  user.locale = locale
  user.save
  score = Score.start(user, "\\header { title = \"Menus\" }\n{ c'4 d' e' f' }\n")
  login(user.email, COLUMNS_PASSWORD)
  # The app speaks the `locale` cookie's language before the account's
  # (AppLocale.pick), and the browser keeps cookies from one test to the
  # next: set it, so the spec does not depend on the test before.
  set_request_cookie("locale", locale)
  visit("/app/scores/#{score._key}")
  wait_for("[data-act=undo]")
end

# For each two-column menu opened in turn, the items whose content runs
# past their own box, or into the other column: "label: by N px".
const COLUMNS_OUT = """
(() => [...document.querySelectorAll('.studio-dropdown-columns')].flatMap((menu) => {
  const details = menu.closest('details');
  details.open = true;
  const found = [...menu.querySelectorAll(':scope > button')].flatMap((item) => {
    if (item.offsetParent === null) return [];
    const box = item.getBoundingClientRect();
    const right = Math.max(...[...item.childNodes].map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().right;
    }));
    const out = Math.round(Math.max(right - box.right, item.scrollWidth - item.clientWidth));
    const name = item.textContent.trim().replace(/\\s+/g, ' ');
    // The label starts at the left, after its icon if it has one: never
    // pushed to the middle of the row.
    const label = [...item.childNodes].find((node) => node.nodeType === 3 && node.textContent.trim());
    const range = document.createRange();
    if (label) range.selectNodeContents(label);
    const icon = item.querySelector(':scope > svg')?.getBoundingClientRect().width ?? 0;
    const indent = label ? Math.round(range.getBoundingClientRect().left - box.left - icon) : 0;
    if (indent > 30) return [name + ': its label starts ' + indent + ' px in'];
    return out > 1 ? [name + ': by ' + out + ' px'] : [];
  });
  details.open = false;
  return found;
}))()
"""

describe("The editor's two-column menus") do
  # Cookies outlive a test: the French one must not leave the specs after
  # it in French.
  after_each() do
    set_request_cookie("locale", "en")
  end

  test("keep every item to its column, in English") do
    columns_open("en")
    assert_eq(evaluate("document.querySelectorAll('.studio-dropdown-columns').length"), 2)
    assert_eq(evaluate(COLUMNS_OUT), [])
  end

  test("keep every item to its column, in French") do
    columns_open("fr")
    assert_contains(evaluate("document.querySelector('[data-act=insert-copied]').textContent"), "Insérer")
    assert_eq(evaluate(COLUMNS_OUT), [])
  end
end
