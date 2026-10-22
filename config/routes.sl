# Routes of the eui-score site: a guide to the engraver, the syntax it reads,
# a gallery of engraved examples, how to embed it, and a playground.

# The browser engraver (public/eui-score/) is meant to be loaded by any
# site: a module script and the WebAssembly it fetches are CORS requests.
# So are the gallery's .ly sources, which `<eui-score src="…">` fetches.
cors(
  "/eui-score*",
  {"origins": "*", "methods": ["GET"]}
)
cors(
  "/examples/*",
  {"origins": "*", "methods": ["GET"]}
)

get("/eui-score.js", "assets#element")
get("/eui-score-editor.js", "assets#editor")

get("/", "home#index", name: "root")
get("/health", "home#health")

get("/guide", "pages#guide", name: "guide")
get("/syntax", "pages#syntax", name: "syntax")
get("/embed", "pages#embed", name: "embed")
get("/limits", "pages#limits", name: "limits")
get("/changelog", "pages#changelog", name: "changelog")

get("/examples", "examples#index", name: "examples")
get("/examples/:category", "examples#category", name: "example_category")
get("/examples/:category/:slug", "examples#show", name: "example")
get("/examples/:category/:slug/score.pdf", "examples#pdf", name: "example_pdf")
get("/examples/:category/:slug/preview.svg", "examples#preview", name: "example_preview")
get("/examples/:category/:slug/source.ly", "examples#source", name: "example_source")

get("/playground", "playground#show", name: "playground")
