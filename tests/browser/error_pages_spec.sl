# The error pages in a real browser (#1034): an unknown address in English
# and in French, the way on by its search and its links, and a phone's
# width, on the layout's 404 and on a page the framework renders itself.

describe("The error pages, in a browser") do
  test("an unknown address: the page that rests, its search, and the way home") do
    visit("/no-such-page")
    wait_for(".error-page")
    assert_text("This page is taking a rest")
    assert_eq(evaluate("document.title"), "This page is taking a rest · Score")
    assert_eq(evaluate("document.querySelector('meta[name=robots]').content"), "noindex")
    # The bar is drawn: an engraving, wider than it is tall.
    assert(evaluate("document.querySelector('.error-figure-svg').getBoundingClientRect().width") > 150, "the figure")
    fill_in("#error-search-q", "waltz")
    click(".error-search button")
    wait_for(".section-lib-how")
    assert_page_path("/sections")
    assert_eq(evaluate("new URLSearchParams(location.search).get('q')"), "waltz")
    visit("/no-such-page")
    wait_for(".error-page")
    click(".error-links a.error-home")
    wait_for(".hero-app")
    assert_page_path("/")
    assert_no_page_errors()
  end

  test("under /fr, in French, its links to the French pages") do
    visit("/fr/pas-de-page")
    wait_for(".error-page")
    assert_text("Cette page fait une pause")
    assert_eq(evaluate("document.documentElement.lang"), "fr")
    click(".error-links a[href='/fr/guide']")
    wait_for(".page-head")
    assert_page_path("/fr/guide")
    assert_no_page_errors()
  end

  context("on a phone") do
    viewport("mobile")

    test("each page fits the screen, in both languages, the layout's and the framework's") do
      ["/no-such-page", "/fr/pas-de-page", "/error-pages/500", "/fr/error-pages/403", "/error-pages/503"].each do |path|
        visit(path)
        wait_for(".error-page")
        assert_eq(evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true, path)
        right = evaluate("document.querySelector('.error-figure').getBoundingClientRect().right")
        assert(right <= evaluate("window.innerWidth"), "#{path}: the figure within the screen, #{right}")
      end
      # The ways on, each within the screen.
      rightmost = evaluate("Math.max(...[...document.querySelectorAll('.error-links a')]"
      + ".map((a) => a.getBoundingClientRect().right))")
      assert(rightmost <= evaluate("window.innerWidth"), "the links within the screen: #{rightmost}")
      assert_text("Intermission")
      assert_no_page_errors()
    end
  end
end
