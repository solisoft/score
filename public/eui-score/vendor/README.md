# Vendored: SpessaSynth

The sound of the players (`../player.js`): a SoundFont synthesizer that runs
in an AudioWorklet and reads SF2 and SF3 files. Apache-2.0, see
`SPESSASYNTH_LICENSE`; https://github.com/spessasus/spessasynth_lib.

- `spessasynth.js` — `WorkletSynthesizer`, `Sequencer` and
  `audioBufferToWav` from spessasynth_lib 4.3.14, and `BasicMIDI` from
  spessasynth_core 4.3.20 (the core its processor was built with), bundled
  into one ES module — the last two for rendering a piece to a WAV file:

  ```sh
  npm i spessasynth_lib@4.3.14 spessasynth_core@4.3.20
  printf '%s\n' 'export { WorkletSynthesizer, Sequencer, audioBufferToWav } from "spessasynth_lib";' \
    'export { BasicMIDI } from "spessasynth_core";' > entry.js
  npx esbuild@0.24.0 entry.js --bundle --format=esm --minify --outfile=spessasynth.js
  ```

- `spessasynth_processor.min.js` — the AudioWorklet processor, as
  spessasynth_lib 4.3.14 ships it (`dist/`), source-map line removed.

Upgrade the two together: the processor and the library talk through
messages, and their versions must match.
