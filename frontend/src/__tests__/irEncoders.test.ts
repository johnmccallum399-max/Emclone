/*
 * Tests for the standalone IR Remote app's protocol encoders
 * (public/ir/encoders.js). The file is a plain browser script, so it is
 * evaluated in a sandbox instead of being imported as a module.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const encodersPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/ir/encoders.js"
);

interface Encoded {
  frequency: number;
  durations: number[];
  minRepeats?: number;
  framePeriod?: number;
}

interface IRModule {
  PROTOCOLS: Record<string, { label: string }>;
  encode(protocol: string, params: Record<string, unknown>): Encoded;
  renderWaveform(
    encoded: Encoded,
    opts?: Record<string, unknown>
  ): { left: Float32Array; right: Float32Array; sampleRate: number };
}

function loadIR(): IRModule {
  const sandbox: { module: { exports: unknown }; Math: Math } = {
    module: { exports: {} },
    Math,
  };
  createContext(sandbox);
  runInContext(readFileSync(encodersPath, "utf8"), sandbox);
  return sandbox.module.exports as IRModule;
}

const IR = loadIR();
const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

describe("IR encoders", () => {
  it("encodes NEC 32-bit codes MSB-first with standard timing", () => {
    const nec = IR.encode("nec", { code: "20DF10EF" });
    expect(nec.frequency).toBe(38000);
    // header pair + 32 bit pairs + trailer mark
    expect(nec.durations.length).toBe(67);
    expect(nec.durations.slice(0, 2)).toEqual([9000, 4500]);
    // 0x20DF10EF starts 0,0,1,0 MSB-first
    expect(nec.durations.slice(2, 8)).toEqual([560, 560, 560, 560, 560, 1690]);
    // 16 ones / 16 zeros -> deterministic total burst length
    expect(sum(nec.durations)).toBe(67980);
  });

  it("encodes Samsung with a 4.5ms/4.5ms header", () => {
    const sam = IR.encode("samsung32", { code: "E0E040BF" });
    expect(sam.durations.slice(0, 2)).toEqual([4500, 4500]);
    expect(sam.durations.length).toBe(67);
  });

  it("encodes Sony SIRC with pulse-width bits and 3 repeats", () => {
    const sirc = IR.encode("sirc", { code: "A90", bits: 12 });
    expect(sirc.frequency).toBe(40000);
    expect(sirc.durations[0]).toBe(2400);
    // 0xA90 starts with a 1 bit -> 600 space then 1200 mark
    expect(sirc.durations.slice(1, 5)).toEqual([600, 1200, 600, 600]);
    expect(sirc.minRepeats).toBe(3);
  });

  it("encodes RC5 Manchester with merged half-bits", () => {
    const rc5 = IR.encode("rc5", { address: 0, command: 12 });
    expect(rc5.frequency).toBe(36000);
    // leading + trailing spaces dropped: 28 halves - 2
    expect(sum(rc5.durations)).toBe(26 * 889);
    expect(rc5.durations.every((d) => d === 889 || d === 1778)).toBe(true);
    // durations alternate mark/space starting with a mark; S2 mark merges
    // with the toggle bit's mark
    expect(rc5.durations.slice(0, 3)).toEqual([889, 889, 1778]);
  });

  it("parses raw duration strings and drops a trailing space", () => {
    const raw = IR.encode("raw", {
      frequency: 38000,
      durations: "9000, 4500 560 560",
    });
    expect(raw.durations).toEqual([9000, 4500, 560]);
  });

  it("parses Pronto hex into carrier frequency and microseconds", () => {
    const pronto = IR.encode("pronto", {
      code: "0000 006D 0002 0000 015B 00AD 0016 0016",
    });
    expect(pronto.frequency).toBeGreaterThan(37500);
    expect(pronto.frequency).toBeLessThan(38500);
    expect(pronto.durations[0]).toBeGreaterThan(9000);
    expect(pronto.durations[0]).toBeLessThan(9250);
  });

  it("rejects invalid input", () => {
    expect(() => IR.encode("nec", { code: "XYZ" })).toThrow();
    expect(() => IR.encode("rc5", { address: 99, command: 12 })).toThrow();
    expect(() => IR.encode("sirc", { code: "A90", bits: 13 })).toThrow();
    expect(() => IR.encode("nope", {})).toThrow();
  });
});

describe("waveform renderer", () => {
  const nec = IR.encode("nec", { code: "20DF10EF" });

  it("renders a 19kHz tone during marks with the right channel inverted", () => {
    const wave = IR.renderWaveform(nec, {
      sampleRate: 48000,
      repeats: 1,
      leadInMs: 80,
    });
    const markStart = Math.round(0.08 * 48000);
    // lead-in silent
    expect(wave.left.slice(0, markStart - 1).every((v) => v === 0)).toBe(true);
    let energy = 0;
    let inverted = true;
    for (let i = markStart; i < markStart + 400; i++) {
      energy += Math.abs(wave.left[i]);
      if (wave.right[i] !== -wave.left[i]) inverted = false;
    }
    expect(energy).toBeGreaterThan(100);
    expect(inverted).toBe(true);
  });

  it("keeps spaces silent", () => {
    const wave = IR.renderWaveform(nec, { sampleRate: 48000, leadInMs: 0 });
    // header space: 9.2ms..13.3ms
    const start = Math.round(0.0092 * 48000);
    const end = Math.round(0.0133 * 48000);
    expect(wave.left.slice(start, end).every((v) => v === 0)).toBe(true);
  });

  it("pads SIRC frames to the 45ms frame period", () => {
    const sirc = IR.encode("sirc", { code: "A90", bits: 12 });
    const wave = IR.renderWaveform(sirc, { sampleRate: 48000, leadInMs: 0 });
    const frame = sum(sirc.durations);
    const totalUs = 3 * frame + 2 * Math.max(10000, 45000 - frame);
    expect(wave.left.length).toBe(
      Math.ceil((totalUs / 1e6) * 48000) + Math.round(0.1 * 48000)
    );
  });

  it("rejects carriers above what the sample rate can represent", () => {
    expect(() =>
      IR.renderWaveform(
        { frequency: 60000, durations: [1000] },
        { sampleRate: 44100 }
      )
    ).toThrow();
  });
});
