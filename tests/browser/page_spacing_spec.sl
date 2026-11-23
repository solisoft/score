# Margins and spacing (#1025), in a real browser (soli test --browser): the
# dialog opened from the score's properties, a margin and a space set and
# applied — written in the text's \paper and \layout, the preview's page
# redrawn — found again on reopening, refused with a clear sentence when out
# of range (nothing written), undone in one step.

const PS_SOURCE = "\\header { title = \"Margins\" }\n"
+ "<< \\new Staff { \\time 4/4 c''4 d'' e'' f'' | g''1 } \\new Staff { \\clef bass c4 d e f | g1 } >>\n"

# The playground opened on the two staves, the score focused.
def ps_open
  visit("/playground")
  wait_for("[data-source]")
  sleep(1)
  evaluate("(() => { const box = document.querySelector('[data-source]'); box.value = #{JSON.stringify(PS_SOURCE)};"
  + " box.dispatchEvent(new Event('input', { bubbles: true })); })()")
  sleep(0.6)
  evaluate("document.querySelector('[data-source]').dispatchEvent(new Event('change', { bubbles: true }))")
  sleep(0.6)
end

def ps_text
  evaluate("document.querySelector('[data-source]').value")
end

# File ▸ Score properties, then its Margins and spacing button, as a click does.
def ps_dialog
  click(".studio-dropdown:first-child > summary")
  click(".studio-dropdown-items [data-act=\"properties\"]")
  sleep(0.3)
  click("[data-properties] [data-act=\"page-spacing\"]")
  sleep(0.6)
end

# Types `value` in the dialog's field `name`.
def ps_type(name, value)
  evaluate("(() => { const field = document.querySelector('[data-spacing=\"#{name}\"]');"
  + " field.value = #{JSON.stringify(value)}; field.dispatchEvent(new Event('input', { bubbles: true })); })()")
end

def ps_field(name)
  evaluate("document.querySelector('[data-spacing=\"#{name}\"]').value")
end

def ps_status
  evaluate("document.querySelector('[data-page-spacing-status]').textContent")
end

# Where the preview's music stands inside its page, in px: [left, right].
def ps_inset
  evaluate("(() => { const page = document.querySelector('.studio-spacing-page').getBoundingClientRect();"
  + " const music = document.querySelector('.studio-spacing-music').getBoundingClientRect();"
  + " return [Math.round(music.left - page.left), Math.round(page.right - music.right)]; })()")
end

def ps_close_all
  click("[data-page-spacing-close]")
  click("[data-properties-close]")
  sleep(0.2)
end

describe("Margins and spacing (#1025)") do
  test("a margin and a space set from the dialog: written, previewed, found again, undone in one step") do
    ps_open
    before = ps_text()
    ps_dialog
    assert(evaluate("document.querySelector('[data-page-spacing]').open"), "the dialog is open")
    # Each field empty, the default shown in it; the music inside the page's default margins (10 mm).
    assert_eq(ps_field("left"), "")
    assert_eq(evaluate("document.querySelector('[data-spacing=\"left\"]').placeholder"), "default: 10")
    assert_eq(evaluate("document.querySelector('[data-spacing=\"systems\"]').placeholder"), "default: 10")
    assert(evaluate("Boolean(document.querySelector('.studio-spacing-music svg'))"), "the page's music drawn")
    inset = ps_inset()
    ps_type("left", "30")
    ps_type("staves", "14")
    click("[data-page-spacing-form] button[type=submit]")
    sleep(0.6)
    assert_contains(ps_status(), "Margins and spacing set.")
    text = ps_text()
    assert_contains(text, "\\paper { left-margin = 30\\mm }")
    assert_contains(text, "VerticalAxisGroup.staff-staff-spacing = #'((basic-distance . 14)")
    # The preview's music moved in from the left: 20 mm more, at 320 px for 210 mm.
    assert(ps_inset()[0] > inset[0] + 25, "the left margin shown wider: #{ps_inset()} after #{inset}")
    # Closed and opened again: the values as set.
    ps_close_all
    ps_dialog
    assert_eq(ps_field("left"), "30")
    assert_eq(ps_field("staves"), "14")
    assert_eq(ps_field("right"), "")
    # One undo: the text as it was, and the dialog says the default again.
    ps_close_all
    evaluate("document.querySelector('.studio-sheet').focus()")
    press("Ctrl+z")
    sleep(0.6)
    assert_eq(ps_text(), before)
    ps_dialog
    assert_eq(ps_field("left"), "")
    assert_no_page_errors()
  end

  test("out of range, or margins that leave no room: refused in the dialog, nothing written; All by default clears") do
    ps_open
    before = ps_text()
    ps_dialog
    ps_type("top", "75")
    click("[data-page-spacing-form] button[type=submit]")
    sleep(0.4)
    assert_contains(ps_status(), "The top margin is 0 to 60 mm")
    assert(evaluate("document.querySelector('[data-page-spacing-status]').classList.contains('studio-error')"))
    assert_eq(ps_field("top"), "75")
    assert_eq(ps_text(), before)
    ps_type("top", "")
    ps_type("left", "60")
    ps_type("right", "60")
    click("[data-page-spacing-form] button[type=submit]")
    sleep(0.4)
    assert_contains(ps_status(), "leave the music 75 mm across the page")
    assert_eq(ps_text(), before)
    # A comma for the decimal point, as French writes it.
    ps_type("left", "12,5")
    ps_type("right", "")
    click("[data-page-spacing-form] button[type=submit]")
    sleep(0.4)
    assert_contains(ps_text(), "left-margin = 12.5\\mm")
    assert_eq(ps_field("left"), "12.5")
    click("[data-page-spacing-defaults]")
    sleep(0.4)
    assert_eq(ps_text(), before)
    assert_eq(ps_field("left"), "")
    assert_no_page_errors()
  end
end
