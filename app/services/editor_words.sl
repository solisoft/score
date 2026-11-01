# The score editor's words in the app's language (#508), for the editor's
# page to hand its modules (public/eui-score/words.js reads them as
# `globalThis.EUI_WORDS`). The modules write their sentences in English and
# look them up here: one JSON file a part of the editor, English sentence =>
# its translation, in config/editor_words/<locale>/. English has none.
const EDITOR_WORD_LOCALES = ["fr"]
const EDITOR_WORD_GROUPS = [
  "commands",
  "model",
  "patterns",
  "audio",
  "panels"
]

class EditorWords
  static cached: Hash = {}

  # English sentence => `locale`'s, every group merged; {} in English.
  static def of(locale)
    return {} unless EDITOR_WORD_LOCALES.includes?(locale)
    return EditorWords.cached[locale] unless EditorWords.cached[locale].nil?

    words = {}
    for group in EDITOR_WORD_GROUPS
      part = JSON.parse(slurp("config/editor_words/#{locale}/#{group}.json")) rescue {}
      for english in part.keys
        words[english] = part[english]
      end
    end
    EditorWords.cached[locale] = words if getenv("APP_ENV") == "production"
    words
  end
end
