# Score

Score is a score editor that runs in the browser. A score is its LilyPond source: the title lives in `\header`, so the library and the engraving are the same document. [eui-score](https://github.com/solisoft/eui) engraves that source to SVG, MIDI and PDF in the page, as WebAssembly (~200 KB gzipped). Nothing is sent anywhere to engrave, play or print. The editor edits what the engraver drew.

The Soli app around the engraver is the site [score.solisoft.net](https://score.solisoft.net): accounts, the library, sharing, comments, live co-editing, practice, billing, and an MCP server so an agent can read and write the scores of an account. The same site explains the engraver — guide, syntax, how to embed it, what it refuses, and a gallery. French is under `/fr`.

`/playground` opens the editor with no account. Saved scores live under `/app`, which needs a SoliDB. With none configured, `/app` shows its setup page and the rest of the site still runs.

## Run

```bash
soli serve . --dev
```

The site is at [http://localhost:5011](http://localhost:5011).

Playback uses MuseScore General (38 MB, MIT). It is not in git; fetch it once:

```bash
deploy/soundfont.sh
```

Tailwind is compiled by `soli` itself. There is no `package.json` and no `node_modules`. `soli serve . --dev` rebuilds `public/css/application.css` from `app/assets/css/application.css`. The theme is CSS-first (`@theme` in that file), so there is no `tailwind.config.js` either.

## Embed the engraver

Any page can load it. LilyPond goes in a `<script type="text/x-lilypond">` because the source is full of `<` and `>`, which a browser would read as tags:

```html
<script type="module" src="https://score.solisoft.net/eui-score/eui-score.js"></script>

<eui-score>
  <script type="text/x-lilypond">
    \relative c' { \key g \major \time 3/4 g'4( a b) | d2. \bar "|." }
  </script>
</eui-score>
```

`render`, `toMidi`, `toPdf` and `check` are exported from the same module. See `public/eui-score/eui-score.js`.

## Layout

| Path | What it is |
| --- | --- |
| `public/eui-score/` | The engraver in the browser, and the studio around it: the editor, the piano roll, the mixer, practice, import and export. The WebAssembly output is committed, so serving the site needs no Rust. |
| `wasm/` | The crate that pins `eui-score` and builds that output. |
| `app/` | The Soli app: controllers, models, views, jobs, mail. A score's rules live on the `Score` model and on `app/policies/`. |
| `config/routes.sl` | The site, `/app`, sharing, sections, MCP and OAuth. |
| `scores/` | The gallery, one `.ly` per piece, engraved when the page is shown. |
| `tests/` | Soli specs, browser specs, and the studio's `tests/js/*.test.mjs`. |
| `docs/` | The Soli framework reference, refreshed by `soli update docs`. Score's own guide is the site (`/guide`, `/syntax`, `/limits`). |

## Rebuild the engraver

When the `eui-score` revision in `wasm/Cargo.toml` changes:

```bash
wasm/build.sh
```

That needs the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.126 (the versions are in the script's header). It writes `public/eui-score/` and stamps the digest the page fetches, so a new engraver is never served from the cache of an old one.

## Database

```bash
soli db:migrate up       # run pending migrations
soli db:migrate status
soli db:seed             # idempotent; seeds re-run every time
```

A new migration is `soli db:migrate generate <name>`.

## Tests

```bash
soli fmt
soli lint
soli test
soli test --coverage --coverage-min 90.0
node --test tests/js/*.test.mjs
```

CI runs these on every push and pull request. How a push to `main` reaches the server is in [deploy/README.md](deploy/README.md).

## License

MIT
