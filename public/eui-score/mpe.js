// MPE — MIDI Polyphonic Expression (#391): a keyboard that plays each note
// on a channel of its own (a "member" channel), so that each note has its
// own pitch bend, pressure and slide.
//
// The zone is found from the MPE Configuration Message the keyboard sends
// (RPN 6 on the zone's manager channel: channel 1 for the lower zone,
// channel 16 for the upper; its value the member channels, 0 turning the
// zone off), or set by hand ("MPE keyboard": a lower zone of 15). The
// members' pitch-bend range is 48 semitones unless the keyboard says
// otherwise (RPN 0 on a member sets it for all the zone's members); the
// manager's own bend, which moves every note, is 2 unless set (RPN 0 on it).
//
// `MpeInput.message(data)` reads one message and answers what it means:
//
//   { type: "zone", zone: "lower", members: 15 }
//   { type: "noteOn", channel, key, velocity } / { type: "noteOff", channel, key }
//   { type: "bend", key, semitones }        — a member's note
//   { type: "bend", key: null, semitones }  — the manager's: every note
//   { type: "pressure", key, value }        — channel pressure on a member
//   { type: "slide", key, value }           — CC 74 on a member
//
// What is kept while recording is a staff's curves (automation.js), not a
// note's: `staffBend` and `staffPressure` fold the notes held into one
// value — the bend of the note struck last, and the hardest pressure.
//
// No DOM here: tests/js/mpe.test.mjs.

/** A member channel's pitch-bend range, by default (the MPE specification's). */
export const MEMBER_RANGE = 48;
/** A manager channel's pitch-bend range, by default. */
export const MANAGER_RANGE = 2;
/** The bend range of a staff's curve (automation.js "bend"): General MIDI's ±2 semitones. */
export const STAFF_RANGE = 2;

/** The MPE Configuration Message for a zone: three controller messages on its manager channel. */
export function configurationMessage(members, zone = "lower") {
  const manager = zone === "upper" ? 15 : 0;
  return [
    [0xb0 | manager, 101, 0],
    [0xb0 | manager, 100, 6],
    [0xb0 | manager, 6, members],
  ];
}

export class MpeInput {
  /** `manual`: a lower zone of fifteen members from the start, whatever the keyboard says. */
  constructor({ manual = false } = {}) {
    this.zones = { lower: manual ? 15 : 0, upper: 0 };
    this.manual = manual;
    this.rpn = new Map();
    this.ranges = new Map();
    this.notes = new Map();
    this.order = [];
    this.pressures = new Map();
    this.bends = new Map();
  }

  /** True when there is a zone: an MPE keyboard is playing. */
  get active() {
    return this.zones.lower > 0 || this.zones.upper > 0;
  }

  /** The zone channel `channel` (0–15) is the manager of, or null. */
  managerOf(channel) {
    if (channel === 0 && this.zones.lower) return "lower";
    if (channel === 15 && this.zones.upper) return "upper";
    return null;
  }

  /** The zone channel `channel` is a member of, or null. */
  zoneOf(channel) {
    if (this.zones.lower && channel >= 1 && channel <= this.zones.lower) return "lower";
    if (this.zones.upper && channel <= 14 && channel >= 15 - this.zones.upper) return "upper";
    return null;
  }

  /** A channel's pitch-bend range: a member's, as set for its zone's members (48 unless said); a manager's own (2). */
  rangeOf(channel) {
    const zone = this.zoneOf(channel);
    if (!zone) return this.ranges.get(channel) ?? MANAGER_RANGE;
    return this.ranges.get(`${zone} members`) ?? MEMBER_RANGE;
  }

  /** Reads one MIDI message (bytes); answers what it means, as a list (empty for what MPE does not mean). */
  message(data) {
    const status = data[0];
    if (status >= 0xf0) return [];
    const kind = status & 0xf0;
    const channel = status & 15;
    if (kind === 0xb0) return this.controller(channel, data[1], data[2] ?? 0);
    const zone = this.zoneOf(channel);
    if (kind === 0x90 && data[2] > 0) {
      if (!zone) return [];
      this.notes.set(channel, data[1]);
      this.order = [...this.order.filter((c) => c !== channel), channel];
      this.bends.set(channel, 0);
      this.pressures.set(channel, 0);
      return [{ type: "noteOn", channel, key: data[1], velocity: data[2] }];
    }
    if (kind === 0x80 || kind === 0x90) {
      if (!zone || this.notes.get(channel) !== data[1]) return [];
      this.notes.delete(channel);
      this.order = this.order.filter((c) => c !== channel);
      this.bends.delete(channel);
      this.pressures.delete(channel);
      return [{ type: "noteOff", channel, key: data[1] }];
    }
    if (kind === 0xe0) {
      const raw = ((data[2] << 7) | data[1]) - 8192;
      if (zone) {
        const semitones = (raw / 8192) * this.rangeOf(channel);
        this.bends.set(channel, semitones);
        return this.notes.has(channel) ? [{ type: "bend", key: this.notes.get(channel), semitones }] : [];
      }
      if (this.managerOf(channel)) return [{ type: "bend", key: null, semitones: (raw / 8192) * (this.ranges.get(channel) ?? MANAGER_RANGE) }];
      return [];
    }
    if (kind === 0xd0 && zone) {
      this.pressures.set(channel, data[1]);
      return this.notes.has(channel) ? [{ type: "pressure", key: this.notes.get(channel), value: data[1] }] : [];
    }
    return [];
  }

  /** A controller: the RPNs that set the zones and the bend ranges, and a member's slide (CC 74). */
  controller(channel, number, value) {
    if (number === 101 || number === 100) {
      const now = this.rpn.get(channel) ?? { msb: 127, lsb: 127 };
      this.rpn.set(channel, number === 101 ? { ...now, msb: value } : { ...now, lsb: value });
      return [];
    }
    if (number === 6) {
      const rpn = this.rpn.get(channel);
      if (!rpn || rpn.msb !== 0) return [];
      if (rpn.lsb === 6 && (channel === 0 || channel === 15)) {
        const zone = channel === 0 ? "lower" : "upper";
        const members = Math.max(0, Math.min(15, value));
        this.zones[zone] = members;
        // The two zones share sixteen channels: the one set last wins what they would share.
        const other = zone === "lower" ? "upper" : "lower";
        this.zones[other] = Math.min(this.zones[other], Math.max(0, 14 - members));
        return [{ type: "zone", zone, members }];
      }
      if (rpn.lsb === 0) {
        // On a member, the range of every member of its zone; on the manager, its own.
        const zone = this.zoneOf(channel);
        this.ranges.set(zone ? `${zone} members` : channel, value);
        return [];
      }
      return [];
    }
    if (number === 74 && this.zoneOf(channel) && this.notes.has(channel)) return [{ type: "slide", key: this.notes.get(channel), value }];
    return [];
  }

  /** The bend a staff's curve keeps, −8192 to 8191 at ±2 semitones: the note struck last's, beyond ±2 held at the end. */
  staffBend() {
    const last = this.order.at(-1);
    const semitones = last == null ? 0 : (this.bends.get(last) ?? 0);
    return Math.max(-8192, Math.min(8191, Math.round((semitones / STAFF_RANGE) * 8192)));
  }

  /** The pressure a staff's curve keeps: the hardest of the notes held. */
  staffPressure() {
    return Math.max(0, ...this.pressures.values());
  }
}
