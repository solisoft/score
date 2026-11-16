# Browser specs — running them on your machine

CI runs `soli test tests/browser --browser` in a clean browser. On a
developer's machine the same command can fail specs that pass in CI, for
reasons that have nothing to do with the app. Run them through the wrapper:

```bash
bin/test-browser                                     # every browser spec
bin/test-browser tests/browser/playground_spec.sl    # one of them
SPEC_BROWSER=/path/to/browser bin/test-browser       # another browser
```

It starts the browser through `bin/spec-browser`, which sets two things right.

## No extension

An extension installed for every profile (on Linux, a file under
`/usr/share/chromium/extensions/`, or a `--load-extension` line in
`~/.config/chromium-flags.conf`) is loaded in the spec's fresh profile too.
One that opens its own sign-in tab does so about two seconds after the
browser starts, and that tab takes the front. From then on the spec's page is
`document.visibilityState === "hidden"`: it gets **no animation frame**, and
whatever the editor draws on one never comes.

What it looks like (#923) — four files, always the same tests, while every
spec that does not wait for a frame stays green:

| Spec | Failing test |
|---|---|
| `note_input_pen_spec.sl` | the pen and the ghost note (`pen_on?` false, ghost `null`) |
| `long_scores_spec.sl` | "playing lights the notes over the drawing" |
| `patterns_spec.sl` | "the drum grid writes a drum bar…" |
| `share_link_spec.sl` | "over a draft of another score, it asks" |

To check: `evaluate("document.visibilityState")` in the failing test. If it
answers `hidden`, look at what else is open in that browser
(`curl http://127.0.0.1:<remote-debugging-port>/json`) before touching the
spec or the app.

`bin/spec-browser` passes `--disable-extensions`, and prefers the browser's
own binary to Arch's `chromium` launcher, which adds the flags file.

## In English

The site has `/fr` (#471): a browser asking for French is sent to
`/fr/signup`, and every spec that signs up times out waiting for "Check your
inbox". `bin/spec-browser` passes `--lang=en-US --accept-lang=en-US`.

## Still to know

- A very large score redrawn under `soli test --browser` can freeze the page
  (`Runtime.evaluate` times out at 30 s): keep browser specs on short scores.
- Restart nothing by hand: the runner starts its own servers. Old ones left
  by an interrupted run can be found with `pgrep -af "soli serve"`.
