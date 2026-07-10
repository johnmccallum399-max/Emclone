/*
 * IR protocol encoders + audio waveform renderer.
 *
 * Every encoder returns { frequency, durations } where `frequency` is the IR
 * carrier in Hz and `durations` is a flat array of microseconds alternating
 * mark (IR on), space (IR off), mark, ... always starting with a mark.
 *
 * Hex codes are interpreted the way they circulate in LIRC configs and
 * public code databases: the written value is transmitted MSB-first
 * (e.g. Samsung power = E0E040BF, LG power = 20DF10EF, Sony power = A90).
 *
 * renderWaveform() turns the duration list into stereo PCM for audio-jack
 * IR blasters: two anti-parallel IR LEDs across L/R conduct on alternate
 * half-cycles, so a sine at carrier/2 with the right channel inverted
 * produces IR pulses at the full carrier frequency.
 */
const IR = (() => {
  function bitsMSB(value, count) {
    const bits = [];
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    return bits;
  }

  function parseHex(str, maxBits) {
    const clean = String(str).trim().replace(/^0x/i, "").replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]+$/.test(clean)) {
      throw new Error("Invalid hex code: " + str);
    }
    const value = parseInt(clean, 16);
    if (!Number.isFinite(value) || value >= 2 ** maxBits) {
      throw new Error("Code does not fit in " + maxBits + " bits: " + str);
    }
    return value;
  }

  // Pulse-distance encoding shared by NEC and Samsung.
  function pulseDistance32(hex, header) {
    const value = parseHex(hex, 32);
    const durations = [...header];
    for (const bit of bitsMSB(value, 32)) {
      durations.push(560, bit ? 1690 : 560);
    }
    durations.push(560); // trailer mark
    return durations;
  }

  function encodeNEC({ code }) {
    return { frequency: 38000, durations: pulseDistance32(code, [9000, 4500]) };
  }

  function encodeSamsung32({ code }) {
    return { frequency: 38000, durations: pulseDistance32(code, [4500, 4500]) };
  }

  // Sony SIRC: pulse-width encoding, 40 kHz. Frames should be sent at least
  // 3x, padded to a 45 ms frame period (handled via repeatGap below).
  function encodeSIRC({ code, bits }) {
    const nbits = Number(bits) || 12;
    if (![12, 15, 20].includes(nbits)) {
      throw new Error("SIRC bits must be 12, 15 or 20");
    }
    const value = parseHex(code, nbits);
    const durations = [2400];
    const bitArr = bitsMSB(value, nbits);
    bitArr.forEach((bit, i) => {
      durations.push(600, bit ? 1200 : 600);
    });
    return { frequency: 40000, durations, minRepeats: 3, framePeriod: 45000 };
  }

  // Philips RC5 (extended): 36 kHz Manchester, 889 us half-bits, 14 bits:
  // start, field (inverted command bit 6), toggle, 5 addr, 6 cmd.
  function encodeRC5({ address, command, toggle }) {
    const addr = Number(address);
    const cmd = Number(command);
    if (!(addr >= 0 && addr <= 31)) throw new Error("RC5 address must be 0-31");
    if (!(cmd >= 0 && cmd <= 127)) throw new Error("RC5 command must be 0-127");
    const bits = [
      1,
      cmd >= 64 ? 0 : 1,
      toggle ? 1 : 0,
      ...bitsMSB(addr, 5),
      ...bitsMSB(cmd & 0x3f, 6),
    ];
    // Manchester: logical 1 = space then mark, logical 0 = mark then space.
    const HALF = 889;
    const states = []; // [isMark, duration]
    for (const bit of bits) {
      if (bit) states.push([false, HALF], [true, HALF]);
      else states.push([true, HALF], [false, HALF]);
    }
    // Drop leading space (IR is idle anyway), merge adjacent equal states.
    while (states.length && !states[0][0]) states.shift();
    const durations = [];
    for (const [isMark, dur] of states) {
      const expectMark = durations.length % 2 === 0;
      if (durations.length && isMark !== expectMark) {
        durations[durations.length - 1] += dur;
      } else {
        durations.push(dur);
      }
    }
    // Trailing space carries no information.
    if (durations.length % 2 === 0) durations.pop();
    return { frequency: 36000, durations, framePeriod: 113778 };
  }

  function encodeRaw({ frequency, durations }) {
    let list = durations;
    if (typeof list === "string") {
      list = list
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
    }
    if (!list.length || list.some((d) => !Number.isFinite(d) || d <= 0)) {
      throw new Error("Raw durations must be positive numbers (microseconds)");
    }
    if (list.length % 2 === 0) list = list.slice(0, -1); // end on a mark
    const freq = Number(frequency) || 38000;
    return { frequency: freq, durations: list };
  }

  // Pronto hex learned format ("0000 006D 0022 0000 015B ...").
  function encodePronto({ code }) {
    const words = String(code)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((w) => parseInt(w, 16));
    if (words.length < 6 || words.some((w) => !Number.isFinite(w))) {
      throw new Error("Invalid Pronto hex");
    }
    if (words[0] !== 0) throw new Error("Only raw Pronto (0000) is supported");
    const frequency = Math.round(1000000 / (words[1] * 0.241246));
    const usPerUnit = 1000000 / frequency;
    const oneShotPairs = words[2];
    const repeatPairs = words[3];
    // Prefer the one-shot burst; fall back to the repeat burst (both start
    // right after the 4-word preamble).
    const pairCount = oneShotPairs || repeatPairs;
    const units = words.slice(4, 4 + pairCount * 2);
    if (units.length < 2) throw new Error("Pronto code has no burst data");
    let durations = units.map((u) => Math.round(u * usPerUnit));
    if (durations.length % 2 === 0) durations = durations.slice(0, -1);
    return { frequency, durations };
  }

  const PROTOCOLS = {
    nec: { label: "NEC (32-bit hex)", encode: encodeNEC },
    samsung32: { label: "Samsung (32-bit hex)", encode: encodeSamsung32 },
    sirc: { label: "Sony SIRC (hex)", encode: encodeSIRC },
    rc5: { label: "Philips RC5 (addr/cmd)", encode: encodeRC5 },
    raw: { label: "Raw (microseconds)", encode: encodeRaw },
    pronto: { label: "Pronto hex", encode: encodePronto },
  };

  function encode(protocol, params) {
    const p = PROTOCOLS[protocol];
    if (!p) throw new Error("Unknown protocol: " + protocol);
    return p.encode(params || {});
  }

  /*
   * Render a duration list to stereo PCM.
   *
   * opts:
   *   sampleRate  audio sample rate (Hz)
   *   invertRight true (default) for dual anti-parallel LED dongles
   *   repeats     how many times to send the frame (>= 1)
   *   repeatGap   space between frames in us (used when no framePeriod)
   *   leadInMs    silence before the first mark (lets audio routing settle)
   */
  function renderWaveform(encoded, opts = {}) {
    const sampleRate = opts.sampleRate || 48000;
    const invertRight = opts.invertRight !== false;
    const framePeriod = encoded.framePeriod || 0;
    const repeats = Math.max(
      1,
      Math.round(opts.repeats || encoded.minRepeats || 1)
    );
    const repeatGap = Math.max(1000, Math.round(opts.repeatGap || 40000));
    const leadInMs = opts.leadInMs == null ? 80 : opts.leadInMs;

    const frameUs = encoded.durations.reduce((a, b) => a + b, 0);
    const gapUs = framePeriod
      ? Math.max(10000, framePeriod - frameUs)
      : repeatGap;

    const full = [];
    for (let r = 0; r < repeats; r++) {
      full.push(...encoded.durations);
      if (r < repeats - 1) full.push(gapUs);
    }

    const toneHz = encoded.frequency / 2;
    if (toneHz >= sampleRate / 2) {
      throw new Error(
        "Sample rate " + sampleRate + " too low for carrier " + encoded.frequency
      );
    }

    const leadIn = Math.round((leadInMs / 1000) * sampleRate);
    const tail = Math.round(0.1 * sampleRate);
    const totalUs = full.reduce((a, b) => a + b, 0);
    const totalSamples =
      leadIn + Math.ceil((totalUs / 1e6) * sampleRate) + tail;

    const left = new Float32Array(totalSamples);
    const right = new Float32Array(totalSamples);

    let cursorUs = 0;
    for (let i = 0; i < full.length; i++) {
      const isMark = i % 2 === 0;
      if (isMark) {
        const startSample = leadIn + Math.round((cursorUs / 1e6) * sampleRate);
        const endSample =
          leadIn + Math.round(((cursorUs + full[i]) / 1e6) * sampleRate);
        const w = (2 * Math.PI * toneHz) / sampleRate;
        for (let s = startSample; s < endSample && s < totalSamples; s++) {
          const v = Math.sin(w * (s - startSample));
          left[s] = v;
          right[s] = invertRight ? -v : v;
        }
      }
      cursorUs += full[i];
    }
    return { left, right, sampleRate };
  }

  return { PROTOCOLS, encode, renderWaveform };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = IR;
}
