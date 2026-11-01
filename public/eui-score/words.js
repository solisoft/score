// The editor's words in the app's language (#508). English is the key: a
// sentence a module shows is written in English, through `tr`, and looked
// up in the page's dictionary — `globalThis.EUI_WORDS`, which the editor's
// page sets from config/editor_words/<locale>/ (EditorWords) when the app
// is not in English. Without one (English, the playground, the tests) the
// English comes back as it is.
//
// `{name}` in the sentence is replaced by `vars.name`, in either language:
//   tr("Bar {n}", { n: 4 })  // "Bar 4", or "Mesure 4"

/** `text` in the page's language, its `{name}`s filled from `vars`. */
export function tr(text, vars) {
  const words = globalThis.EUI_WORDS;
  let said = (words && Object.prototype.hasOwnProperty.call(words, text) && words[text]) || text;
  if (vars) {
    for (const name of Object.keys(vars)) said = said.split(`{${name}}`).join(String(vars[name]));
  }
  return said;
}

/** The page's language: "fr", or "en" when it has no dictionary. */
export function language() {
  return globalThis.EUI_WORDS_LOCALE || "en";
}
