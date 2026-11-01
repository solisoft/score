# A value written as JSON inside a <script> (#537): it must not close the
# script, nor break the line where a browser ends one.

describe("json_for_script") do
  test("cannot close the script it is written in") do
    json = json_for_script({"word": "</script><script>alert(1)</script>"})
    assert_not(json.contains("</script>"))
    assert_not(json.contains("<"))
    assert_contains(json, "\\u003c/script>\\u003cscript>alert(1)\\u003c/script>")
  end

  test("escapes the line and paragraph separators") do
    json = json_for_script(["a\u2028b", "c\u2029d"])
    assert_not(json.contains("\u2028"))
    assert_not(json.contains("\u2029"))
    assert_contains(json, "a\\u2028b")
    assert_contains(json, "c\\u2029d")
  end

  test("reads back as the value it was") do
    value = {
      "word": "</script> & \"quoted\"\u2028",
      "count": 3,
      "list": [1, "two"]
    }
    assert_eq(JSON.parse(json_for_script(value)), value)
  end

  test("is what the views write their scripts' words with") do
    views = [
      "app/views/layouts/app.html.slv",
      "app/views/app/home/index.html.slv",
      "app/views/app/scores/show.html.slv",
      "app/views/app/account/show.html.slv",
      "app/views/app/score_readings/watch.html.slv",
      "app/views/shared/_studio.html.slv"
    ]
    views.each do |view|
      template = File.read(view)
      assert_not(template.contains(".to_json %>"), view)
      assert_not(template.contains(".to_json :"), view)
      assert(template.contains("<%- json_for_script("), view)
    end
  end

  test("writes a plain value as to_json does") do
    assert_eq(json_for_script({"Play": "Lecture"}), {"Play": "Lecture"}.to_json)
    assert_eq(json_for_script(nil), "null")
  end
end
