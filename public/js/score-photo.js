// A photo of a score, read into LilyPond by the server (POST /app/readings,
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

// Sends `file`, calls `started()` once the server took it, and resolves to
// {source, svg}; rejects with an Error whose message the page can show.
export async function readPhoto(file, { readings = "/app/readings", started = () => {} } = {}) {
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
  if (sent.status !== 202) throw new Error(answer.error);
  started();
  for (;;) {
    await wait(3000);
    const reading = await (await fetch(`${readings}/${answer.id}`, { headers: { Accept: "application/json" } })).json();
    if (reading.state === "done") return reading;
    if (reading.state === "failed") throw new Error(reading.error);
  }
}
