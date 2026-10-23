// What the tests hear of a MIDI file: when its notes start.

/** A MIDI file's note-ons, in seconds from its start, through its tempo changes. */
export function onsetSeconds(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const ppq = v.getUint16(12);
  const ons = [];
  const tempos = [];
  for (let i = 14; i < bytes.length; i += 8 + v.getUint32(i + 4)) {
    let p = i + 8;
    const end = p + v.getUint32(i + 4);
    let t = 0;
    let status = 0;
    const vlq = () => {
      let x = 0;
      for (;;) {
        const b = bytes[p++];
        x = (x << 7) | (b & 127);
        if (!(b & 128)) return x;
      }
    };
    while (p < end) {
      t += vlq();
      if (bytes[p] === 0xff) {
        const type = bytes[p + 1];
        p += 2;
        const len = vlq();
        if (type === 0x51) tempos.push([t, (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]]);
        p += len;
        continue;
      }
      if (bytes[p] & 128) status = bytes[p++];
      if ((status & 0xf0) === 0x90 && bytes[p + 1] > 0) ons.push(t);
      p += (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
    }
  }
  tempos.sort((a, b) => a[0] - b[0]);
  const sec = (tick) => {
    let s = 0;
    let last = 0;
    let us = 500000;
    for (const [at, u] of tempos) {
      if (at >= tick) break;
      s += ((at - last) * us) / ppq / 1e6;
      last = at;
      us = u;
    }
    return s + ((tick - last) * us) / ppq / 1e6;
  };
  return [...new Set(ons)].sort((a, b) => a - b).map(sec);
}
