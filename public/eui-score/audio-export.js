// The sound to files, besides the WAV: an MP3, and the stems — one WAV a
// staff, in a zip.
//
// MP3, not OGG. The piece is rendered on an OfflineAudioContext, faster
// than it plays, through the mixer (player.js `renderAudio`); an
// OfflineAudioContext cannot feed a MediaRecorder (a MediaStreamDestination
// is a live context's), so OGG/Opus would mean playing the whole piece out
// in real time, and its support differs from browser to browser (Safari
// records no Opus). lamejs encodes the rendered samples as they are, at
// several times the speed of the music, in every browser. It is loaded the
// first time an MP3 is saved, from jsdelivr at an exact version, checked
// by its digest (SRI): that one time needs the network (156 KB); the
// browser's cache keeps it after that.
//
// The zip is written here, store-only (WAVs hardly compress): local file
// headers, a central directory, CRC-32. No DOM in the zip and the encoder:
// tests/js/audio_export.test.mjs.

export const LAME_URL = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";
export const LAME_SRI = "sha384-xuasJXVcyv3hZq0eYpelEkBC8l4yufatZXDsKuyCU2rqfhDCb+ftuE/mSfZAteiK";

// ---- CRC-32 and the zip ----------------------------------------------------------------

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The CRC-32 of `bytes` (zip's, PNG's). */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A date as MS-DOS time and date, as a zip keeps them. */
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [time, day];
}

/**
 * `files` ([{ name, bytes }]) as a zip, stored (not compressed): a
 * Uint8Array. Names are UTF-8 (bit 11 set).
 */
export function zip(files, date = new Date(2026, 0, 1)) {
  const encoder = new TextEncoder();
  const [time, day] = dosTime(date);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // made by
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, part) => s + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, part) => s + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A staff's name as a file's: what a file system takes, never empty. */
export function fileSafe(name, fallback = "staff") {
  const safe = String(name ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return safe || fallback;
}

/** Each stem's file name, numbered so they sort as the staves do: "01 Piano.wav". */
export function stemNames(names) {
  const width = String(names.length).length < 2 ? 2 : String(names.length).length;
  return names.map((name, k) => `${String(k + 1).padStart(width, "0")} ${fileSafe(name, `Staff ${k + 1}`)}.wav`);
}

// ---- MP3 -----------------------------------------------------------------------------------

/** Float samples (−1…1) as 16-bit ones. */
export function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

/**
 * An AudioBuffer (or { sampleRate, numberOfChannels, getChannelData })
 * encoded as MP3 with `lame` (lamejs): the file's parts, for a Blob.
 * Stereo, or mono for one channel; `kbps` the bit rate. The work is cut in
 * slices, the page given back between them; `onProgress(fraction)`.
 */
export async function encodeMp3(buffer, lame, { kbps = 192, onProgress, slice = 1152 * 64 } = {}) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const encoder = new lame.Mp3Encoder(channels, buffer.sampleRate, kbps);
  const left = toInt16(buffer.getChannelData(0));
  const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : null;
  const parts = [];
  for (let i = 0; i < left.length; i += slice) {
    for (let j = i; j < Math.min(left.length, i + slice); j += 1152) {
      const end = Math.min(left.length, j + 1152, i + slice);
      const part = right ? encoder.encodeBuffer(left.subarray(j, end), right.subarray(j, end)) : encoder.encodeBuffer(left.subarray(j, end));
      if (part.length) parts.push(new Uint8Array(part.buffer, part.byteOffset, part.length));
    }
    onProgress?.(Math.min(1, (i + slice) / left.length));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const last = encoder.flush();
  if (last.length) parts.push(new Uint8Array(last.buffer, last.byteOffset, last.length));
  return parts;
}

let lameLoading = null;

/** lamejs, loaded once from its CDN (a script, checked by its digest). */
export function loadLame(doc = globalThis.document) {
  if (globalThis.lamejs?.Mp3Encoder) return Promise.resolve(globalThis.lamejs);
  lameLoading ??= new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = LAME_URL;
    script.integrity = LAME_SRI;
    script.crossOrigin = "anonymous";
    script.onload = () => (globalThis.lamejs?.Mp3Encoder ? resolve(globalThis.lamejs) : reject(new Error("the MP3 encoder did not start")));
    script.onerror = () => reject(new Error("the MP3 encoder could not be loaded: it needs the network the first time"));
    doc.head.append(script);
  });
  lameLoading.catch(() => {
    lameLoading = null;
  });
  return lameLoading;
}

// ---- In the studio ---------------------------------------------------------------------

/**
 * Save the sound as MP3: `midi` (what Play plays), `muted` (its channels
 * left out), rendered through the mixer and encoded. `P` is player.js.
 */
export async function saveMp3({ P, midi, muted, name, say, download }) {
  say("Making the MP3 file…");
  try {
    const [lame, buffer] = await Promise.all([loadLame(), P.renderAudio(midi, { muted, onProgress: (f) => say(`Loading the sounds… ${Math.round(100 * f)} % (38 MB, once)`) })]);
    const parts = await encodeMp3(buffer, lame, { onProgress: (f) => say(`Making the MP3 file… ${Math.round(100 * f)} %`) });
    const blob = new Blob(parts, { type: "audio/mpeg" });
    download(blob, `${name}.mp3`, "audio/mpeg");
    say(`${name}.mp3 saved — ${(blob.size / 1048576).toFixed(1)} MB`);
    return blob;
  } catch (error) {
    say(`The MP3 file could not be made: ${error.message ?? error}`, true);
    return null;
  }
}

/**
 * Save the stems: each staff of `tracks` ([{ lane, channel, name }]) alone,
 * the others muted, rendered through the mixer (`alone(lane)` sets the mixer
 * heard to that staff alone, `alone(null)` back), each a WAV, in one zip.
 */
export async function saveStems({ P, midi, tracks, alone, name, say, download }) {
  if (!tracks.length) return say("No staff to save.", true);
  const names = stemNames(tracks.map((t) => t.name));
  const files = [];
  try {
    for (const [k, track] of tracks.entries()) {
      say(`Making the stems… ${k + 1} of ${tracks.length}: ${track.name}`);
      alone(track.lane);
      const muted = tracks.filter((t) => t.channel !== track.channel).map((t) => t.channel);
      const wav = await P.renderWav(midi, { muted, onProgress: (f) => say(`Loading the sounds… ${Math.round(100 * f)} % (38 MB, once)`) });
      files.push({ name: names[k], bytes: new Uint8Array(await wav.arrayBuffer()) });
    }
  } catch (error) {
    say(`The stems could not be made: ${error.message ?? error}`, true);
    return null;
  } finally {
    alone(null);
  }
  const bytes = zip(files);
  download(new Blob([bytes], { type: "application/zip" }), `${name} - stems.zip`, "application/zip");
  say(`${name} - stems.zip saved — ${files.length} WAV files, ${(bytes.length / 1048576).toFixed(1)} MB`);
  return bytes;
}
