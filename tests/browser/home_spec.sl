# The home page in a real browser (soli test --browser, #397): reached and
# left by links (instant navigation swaps the page: nothing of its own to
# set up again), its screenshots loaded, and nothing wider than a phone.

describe("The home page, in a browser") do
  test("reached by a link and left by one, its sections and pictures there each time") do
    visit("/guide")
    click("a.brand")
    wait_for(".hero-app")
    assert_page_path("/")
    assert_eq(evaluate("document.querySelectorAll('section.feature').length"), 8)
    # The hero's picture is loaded at once, and drawn.
    assert_eq(evaluate("document.querySelector('.app-shot-hero img').complete"), true)
    assert(evaluate("document.querySelector('.app-shot-hero img').naturalWidth") > 0, "the hero's picture")
    click(".feature-index a[href='#together']")
    sleep(0.4)
    click(".site-nav a[href='/changelog']")
    wait_for_text("Score is free")
    assert_page_path("/changelog")
    click("a.brand")
    wait_for(".hero-app")
    assert_eq(evaluate("document.querySelectorAll('section.feature').length"), 8)
    # The site is free (#699): an old link to Pricing lands on the home page.
    visit("/pricing")
    wait_for(".hero-app")
    assert_page_path("/")
    assert_eq(evaluate("document.querySelector('[data-home-free]') !== null"), true)
    assert_no_page_errors()
  end

  context("on a phone") do
    viewport("mobile")

    test("nothing is wider than the screen, and the header keeps Start free beside the brand") do
      visit("/")
      wait_for(".hero-app")
      assert_eq(evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true)
      brand_top = evaluate("Math.round(document.querySelector('a.brand').getBoundingClientRect().top)")
      start_top = evaluate("Math.round(document.querySelector('.nav-account .nav-cta').getBoundingClientRect().top)")
      assert(start_top - brand_top < 12 && brand_top - start_top < 12, "brand #{brand_top}, Start free #{start_top}")
      # Each picture fits its column.
      widest = evaluate("Math.max(...[...document.querySelectorAll('.app-shot img')]"
      + ".map((img) => img.getBoundingClientRect().right))")
      assert(widest <= evaluate("window.innerWidth"), "pictures within the screen: #{widest}")
      assert_no_page_errors()
    end
  end
end
