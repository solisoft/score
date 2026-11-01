# The editor's words (#508): the French of every group of modules, merged,
# for the editor's page; none in English or a language the app does not
# speak.

describe("EditorWords") do
  test("French: every group's sentences, English => French") do
    words = EditorWords.of("fr")
    for group in EDITOR_WORD_GROUPS
      part = JSON.parse(slurp("config/editor_words/fr/#{group}.json"))
      for english in part.keys
        assert_eq(words[english], part[english], "#{group}: #{english}")
      end
    end
  end

  test("English, and a language the app does not speak, have none") do
    assert_eq(EditorWords.of("en"), {})
    assert_eq(EditorWords.of("de"), {})
    assert_eq(EditorWords.of(""), {})
  end
end
