// The editor's undo history, kept in this browser (#387): a reload, or the
// score opened again tomorrow, can still undo.
//
// A step is `{ text, after, sel, input }`: the text before it, the text just
// after it, where the selection and the cursor were. While nobody else
// changes the score, a step's `after` is the next step's `text`; a change
// saved by someone else and merged in is not a step of this person's, and
// leaves the steps under it pointing at a text that is no longer there —
// Undo then takes the step back with a three-way merge (studio.js), never by
// putting the old text back over theirs.
//
// Kept per score in IndexedDB, as differences: the text the history ends at
// in full, then each step as the change from its neighbour (a common start,
// a common end, what is between). The oldest steps go when a score's
// history passes BUDGET, and the scores opened least recently when more
// than SCORES are kept. Every access to the storage is guarded: a private
// window, storage turned off or full, and the history simply stays in memory.

/** A score's history, in the browser, at most (the characters of its differences). */
export const BUDGET = 4 * 1024 * 1024;
/** The texts held in memory for Undo, at most (characters). */
export const MEMORY = 32 * 1024 * 1024;
/** How many scores' histories are kept: the ones opened most recently. */
export const SCORES = 20;
/** The steps nearest the present keep the editor's whole state (the model too), not only the text. */
export const FULL = 50;

/** From `a` to `b`: null when they are the same, else `[start, end, between]`. */
export function diff(a, b) {
  if (a === b) return null;
  const most = Math.min(a.length, b.length);
  let start = 0;
  while (start < most && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (end < most - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return [start, end, b.slice(start, b.length - end)];
}

/** `a` changed by `d` (from `diff(a, b)`): `b`. */
export function patch(a, d) {
  if (d == null) return a;
  const [start, end, between] = d;
  return a.slice(0, start) + between + a.slice(a.length - end);
}

const sizeOf = (d) => (d == null ? 1 : d[2].length + 12);

/** A step as it is kept: its text and its `after` as changes, from `ref` (the text above it). */
function packStep(step, ref) {
  const a = diff(ref, step.after);
  const b = diff(step.after, step.text);
  return { a, b, sel: step.sel ?? null, input: step.input ?? null };
}

/**
 * The history as it is kept: `{ end, past, future, size }`, `end` the text
 * it ends at (the score as this editor last had it). The steps nearest the
 * present are kept first; older ones are left out once `budget` is spent.
 */
export function encode({ end, past, future }, { budget = BUDGET } = {}) {
  let size = end.length;
  const pack = (steps) => {
    const kept = [];
    let ref = end;
    for (let i = steps.length - 1; i >= 0; i--) {
      const packed = packStep(steps[i], ref);
      const cost = sizeOf(packed.a) + sizeOf(packed.b) + 64;
      if (size + cost > budget) break;
      size += cost;
      kept.unshift(packed);
      ref = steps[i].text;
    }
    return kept;
  };
  // The steps to redo first (there are few), then as far back as fits.
  const keptFuture = pack(future);
  const keptPast = pack(past);
  return { end, past: keptPast, future: keptFuture, size };
}

/** The steps back from a record: `{ end, past, future }`, or null when it is not one. */
export function decode(record) {
  try {
    if (!record || typeof record.end !== "string") return null;
    const unpack = (packed) => {
      const steps = [];
      let ref = record.end;
      for (let i = packed.length - 1; i >= 0; i--) {
        const after = patch(ref, packed[i].a);
        const text = patch(after, packed[i].b);
        steps.unshift({ text, after, sel: packed[i].sel ?? null, input: packed[i].input ?? null });
        ref = text;
      }
      return steps;
    };
    return { end: record.end, past: unpack(record.past ?? []), future: unpack(record.future ?? []) };
  } catch (error) {
    return null;
  }
}

/** A step from a snapshot of the editor (studio.js's `snapshot()`), `after` the text it led to. */
export function stepOf(snap, after) {
  const s = JSON.parse(snap);
  return { snap, text: s.text, after, sel: s.sel ?? null, input: s.input ?? null };
}

/**
 * The history held in memory, kept within `memory`: the oldest steps go
 * first, then the farthest redo; below the `full` steps nearest the present,
 * a step keeps its text only. Changes `past` and `future` in place; answers
 * how many steps went.
 */
export function keepWithin(past, future, { memory = MEMORY, full = FULL } = {}) {
  for (let i = 0; i < past.length - full; i++) if (past[i].snap) delete past[i].snap;
  const weight = (step) => step.text.length + (step.snap?.length ?? 0);
  let total = 0;
  for (const step of past) total += weight(step);
  for (const step of future) total += weight(step);
  let dropped = 0;
  while (total > memory && past.length > 1) {
    total -= weight(past.shift());
    dropped++;
  }
  while (total > memory && future.length > 1) {
    total -= weight(future.shift());
    dropped++;
  }
  return dropped;
}

/** The histories that go so that at most `scores` are kept: the least recently used. */
export function evicted(used, scores = SCORES) {
  return Object.entries(used)
    .sort((a, b) => b[1] - a[1])
    .slice(scores)
    .map(([key]) => key);
}

/**
 * The histories over a storage `backend` — `{ get(name, key), put(name, key,
 * value), remove(name, key), all(name) }`, each a promise, over two stores:
 * "histories" and "used" (when each was last saved). Nothing here throws: a
 * refusal of the backend answers null or false, and the history stays in memory.
 */
export function historyStore(backend, { scores = SCORES, now = () => Date.now() } = {}) {
  return {
    async get(key) {
      try {
        return (await backend.get("histories", key)) ?? null;
      } catch (error) {
        return null;
      }
    },
    async put(key, record) {
      try {
        await backend.put("histories", key, record);
        await backend.put("used", key, now());
        const used = (await backend.all("used")) ?? {};
        for (const old of evicted(used, scores)) {
          await backend.remove("histories", old);
          await backend.remove("used", old);
        }
        return true;
      } catch (error) {
        // Full, most likely: this score's history goes rather than half of it staying.
        try {
          await backend.remove("histories", key);
        } catch (ignored) {}
        return false;
      }
    },
    async remove(key) {
      try {
        await backend.remove("histories", key);
        await backend.remove("used", key);
        return true;
      } catch (error) {
        return false;
      }
    },
  };
}

const request = (req) => new Promise((done, fail) => {
  req.onsuccess = () => done(req.result);
  req.onerror = () => fail(req.error);
});

/** IndexedDB as a backend for `historyStore`; null when the browser has none or refuses it. */
export async function indexedDbBackend(idb = globalThis.indexedDB, name = "eui-score-history", { wait = 2000 } = {}) {
  try {
    if (!idb) return null;
    const opening = idb.open(name, 1);
    opening.onupgradeneeded = () => {
      for (const store of ["histories", "used"]) if (!opening.result.objectStoreNames.contains(store)) opening.result.createObjectStore(store);
    };
    const db = await Promise.race([
      request(opening),
      new Promise((done, fail) => {
        opening.onblocked = () => fail(new Error("blocked"));
        setTimeout(() => fail(new Error("no answer")), wait);
      }),
    ]);
    const store = (storeName, mode) => db.transaction(storeName, mode).objectStore(storeName);
    const written = (tx) => new Promise((done, fail) => {
      tx.oncomplete = () => done();
      tx.onerror = tx.onabort = () => fail(tx.error ?? new Error("aborted"));
    });
    const write = (storeName, act) => {
      const tx = db.transaction(storeName, "readwrite");
      act(tx.objectStore(storeName));
      return written(tx);
    };
    return {
      get: (storeName, key) => request(store(storeName, "readonly").get(key)),
      put: (storeName, key, value) => write(storeName, (s) => s.put(value, key)),
      remove: (storeName, key) => write(storeName, (s) => s.delete(key)),
      async all(storeName) {
        const s = store(storeName, "readonly");
        const [keys, values] = await Promise.all([request(s.getAllKeys()), request(s.getAll())]);
        return Object.fromEntries(keys.map((key, i) => [key, values[i]]));
      },
    };
  } catch (error) {
    return null;
  }
}

/**
 * Saves a score's history a moment after it changes (`save(state)`, `state`
 * a function answering `{ end, past, future }`), and at once on `flush()`.
 */
export function keeper(store, key, { delay = 400, budget = BUDGET } = {}) {
  let timer = 0;
  let latest = null;
  const write = () => {
    clearTimeout(timer);
    timer = 0;
    if (!latest) return Promise.resolve(false);
    const state = latest();
    latest = null;
    let record;
    try {
      record = encode(state, { budget });
    } catch (error) {
      return Promise.resolve(false);
    }
    return store.put(key, record);
  };
  return {
    save(state) {
      latest = state;
      clearTimeout(timer);
      timer = setTimeout(write, delay);
    },
    flush: write,
  };
}
