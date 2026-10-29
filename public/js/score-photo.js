// A photo of a score, read into LilyPond on the person's own AI key (POST /app/readings,
// then GET /app/readings/:id until it is done). Used by the app's Start page
// and its editor; no state of its own, so instant navigation needs nothing.

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// The photo as the models take it: a JPEG at most 2576 pixels on its long side, as base64.
export async function shrunk(file) {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, 2576 / Math.max(image.width, image.height));
  const canvas = Object.assign(document.createElement("canvas"), {
    width: Math.round(image.width * scale),
    height: Math.round(image.height * scale),
  });
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

// How long a reading has taken, as people read it: "45 s", "3 min 20 s".
export function took(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

// What the page says of a reading going on (#435), from its news: waiting for
// the AI, the AI reading the photo (it thinks before it writes, often for
// minutes), the AI writing the music.
export function readingSays(news) {
  const time = took(news?.seconds);
  if (news?.phase === "writing") return `The AI is writing the music… ${time}`;
  if (news?.phase === "thinking") return `The AI is reading the photo… ${time}. It thinks before it writes, often for several minutes.`;
  return `Waiting for the AI… ${time}`;
}

// Sends `file`, calls `started()` once the server took it, tells `progress`
// how the reading goes ({phase: "waiting" | "thinking" | "writing", draft:
// the LilyPond so far, seconds}), and resolves to {source, svg}; rejects with
// an Error whose message the page can show (and, when it is the AI key or the
// plan, its `link` and `linkText`: the account's AI section or the Pricing
// page, #396). A model may think for many minutes: the page waits as long as
// the server says the reading goes on (#435), followed live (events) and
// asked after every few seconds.
export async function readPhoto(file, { readings = "/app/readings", started = () => {}, progress = () => {} } = {}) {
  let sent;
  try {
    sent = await fetch(readings, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ picture: await shrunk(file) }),
    });
  } catch (problem) {
    throw new Error("The photo could not be sent. Check your connection and try again.");
  }
  const answer = await sent.json();
  if (sent.status !== 202) throw Object.assign(new Error(answer.error), { link: answer.link, linkText: answer.link_text });
  started();
  const at = `${readings}/${answer.id}`;
  // Live: each piece of news as it comes, and "done" to ask after it at once.
  let wake = () => {};
  let events = null;
  try {
    events = new EventSource(`${at}/events`);
    events.addEventListener("progress", (event) => {
      try {
        progress(JSON.parse(event.data));
      } catch (error) {}
    });
    events.addEventListener("done", () => wake());
  } catch (error) {}
  try {
    // An hour at most: the server fails a reading with no news for ten minutes long before.
    for (let tries = 0; tries < 1200; tries++) {
      await Promise.race([wait(3000), new Promise((done) => (wake = done))]);
      const reading = await (await fetch(at, { headers: { Accept: "application/json" } })).json();
      if (reading.state === "done") return reading;
      if (reading.state === "failed") throw new Error(reading.error);
      progress(reading);
    }
    throw new Error("No answer after an hour. Try again in a moment.");
  } finally {
    events?.close();
  }
}
