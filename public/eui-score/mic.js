// The microphone (#390): asked for on a press of a button, never before;
// its sound recorded block by block (mic-worklet.js) for a take, or listened
// to frame by frame for the tuner and the score following (pitch.js).
//
//   const stream = await openMic();          // inside a click; throws a sentence
//   const rec = await capture(ctx, stream, ({ samples, time }) => …);
//   rec.stop();
//   const ear = listen(ctx, stream, ({ t, freq, clarity, rms }) => …);
//   ear.stop();
//   closeMic(stream);

const V = new URL(import.meta.url).search;
const Pi = await import(`./pitch.js${V}`);

/** What to tell the person when the browser gives no microphone: `error` as getUserMedia threw it. */
export function refusal(error) {
  const name = error?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "The microphone was refused. Allow it for this site in the browser (the icon at the left of the address), then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "No microphone was found: plug one in, or choose one in the system's sound settings.";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "The microphone is busy: another program or tab is using it.";
  return `The microphone could not be opened${error?.message ? `: ${error.message}` : "."}`;
}

/**
 * The microphone's stream, the browser asking the person the first time.
 * Call it from a click. Raw sound: no echo cancelling, noise suppression
 * or automatic gain, which would bend a note's pitch and its loudness.
 * Throws an Error whose message says what went wrong, in words.
 */
export async function openMic() {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    throw new Error("This browser gives no microphone here: it needs a secure page (https) and a recent browser.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (error) {
    throw new Error(refusal(error));
  }
}

/** Lets the microphone go: its light in the browser goes out. */
export function closeMic(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

/** How late the microphone's sound reaches the page, as the browser says it (seconds). */
export function inputLatency(stream) {
  const latency = stream?.getAudioTracks?.()[0]?.getSettings?.().latency;
  return Number.isFinite(latency) ? latency : 0;
}

const loadedOn = new WeakSet();

/**
 * Records `stream` on `ctx`: `onBlock({ samples, time })` for each block,
 * `time` the audio clock's time of its first sample. Answers `{ stop() }`.
 */
export async function capture(ctx, stream, onBlock) {
  if (!loadedOn.has(ctx)) {
    await ctx.audioWorklet.addModule(new URL(`mic-worklet.js${V}`, import.meta.url));
    loadedOn.add(ctx);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "eui-mic-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
  // Pulled by the graph, heard by no one.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  node.port.onmessage = (event) => onBlock(event.data);
  return {
    stop() {
      node.port.postMessage("stop");
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
        mute.disconnect();
      } catch (error) {}
    },
  };
}

/**
 * Listens to `stream` on `ctx`: every `interval` ms, the last `frame`
 * samples' pitch — `onFrame({ t, freq, clarity, rms })`, `t` the audio
 * clock's time, `freq` null when none. Answers `{ stop() }`.
 */
export function listen(ctx, stream, onFrame, { interval = 25, frame = Pi.FRAME, minFreq = 55, maxFreq = 1800 } = {}) {
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = frame;
  source.connect(analyser);
  const samples = new Float32Array(frame);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const loud = Pi.rms(samples);
    const found = loud >= Pi.GATE ? Pi.yin(samples, ctx.sampleRate, { minFreq, maxFreq }) : null;
    onFrame({ t: ctx.currentTime, freq: found?.freq ?? null, clarity: found?.clarity ?? 0, rms: loud });
  }, interval);
  return {
    stop() {
      clearInterval(timer);
      try {
        source.disconnect();
        analyser.disconnect();
      } catch (error) {}
    },
  };
}
