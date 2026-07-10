/*
 * Tests for the Flipper Zero .ir importer (public/ir/flipper.js).
 * Conversions are validated against well-known published codes: the same
 * device must yield the same 32-bit hex whether entered directly or
 * imported from Flipper's address/command byte representation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const flipperPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/ir/flipper.js"
);

interface ImportedButton {
  label: string;
  color: string;
  protocol: string;
  params: Record<string, unknown>;
  repeat: number;
}

interface FlipperModule {
  parse(text: string): { buttons: ImportedButton[]; skipped: string[] };
}

function loadFlipper(): FlipperModule {
  const sandbox: { module: { exports: unknown } } = { module: { exports: {} } };
  createContext(sandbox);
  runInContext(readFileSync(flipperPath, "utf8"), sandbox);
  return sandbox.module.exports as FlipperModule;
}

const FlipperIR = loadFlipper();

const SAMPLE = `Filetype: IR signals file
Version: 1
#
name: Power
type: parsed
protocol: NEC
address: 04 00 00 00
command: 08 00 00 00
#
name: Samsung_Power
type: parsed
protocol: Samsung32
address: 07 00 00 00
command: 02 00 00 00
#
name: Sony_Power
type: parsed
protocol: SIRC
address: 01 00 00 00
command: 15 00 00 00
#
name: Philips_Mute
type: parsed
protocol: RC5
address: 00 00 00 00
command: 0D 00 00 00
#
name: Necext_Btn
type: parsed
protocol: NECext
address: 83 55 00 00
command: 90 00 00 00
#
name: Raw_Blast
type: raw
frequency: 38000
duty_cycle: 0.330000
data: 9000 4500 560 560 560
#
name: Fancy_RC6
type: parsed
protocol: RC6
address: 00 00 00 00
command: 0C 00 00 00
`;

describe("Flipper .ir importer", () => {
  const { buttons, skipped } = FlipperIR.parse(SAMPLE);
  const byLabel = Object.fromEntries(buttons.map((b) => [b.label, b]));

  it("converts NEC address/command bytes to the published 32-bit hex", () => {
    // LG TV power: Flipper stores address 0x04, command 0x08 → 20DF10EF
    expect(byLabel["Power"].protocol).toBe("nec");
    expect(byLabel["Power"].params.code).toBe("20DF10EF");
  });

  it("converts Samsung32 records", () => {
    // Samsung TV power: address 0x07, command 0x02 → E0E040BF
    expect(byLabel["Samsung Power"].protocol).toBe("samsung32");
    expect(byLabel["Samsung Power"].params.code).toBe("E0E040BF");
  });

  it("converts SIRC records with a repeat of 3", () => {
    // Sony TV power: address 1, command 21 → A90 (12-bit)
    expect(byLabel["Sony Power"].protocol).toBe("sirc");
    expect(byLabel["Sony Power"].params.code).toBe("A90");
    expect(byLabel["Sony Power"].params.bits).toBe(12);
    expect(byLabel["Sony Power"].repeat).toBe(3);
  });

  it("converts RC5 records to address/command params", () => {
    expect(byLabel["Philips Mute"].protocol).toBe("rc5");
    expect(byLabel["Philips Mute"].params).toMatchObject({
      address: 0,
      command: 13,
    });
  });

  it("converts NECext records using both address bytes", () => {
    // addr LE 0x83,0x55 cmd 0x90,0x00 → rev8 each: C1 AA 09 00
    expect(byLabel["Necext Btn"].params.code).toBe("C1AA0900");
  });

  it("passes raw records through with frequency and durations", () => {
    expect(byLabel["Raw Blast"].protocol).toBe("raw");
    expect(byLabel["Raw Blast"].params).toMatchObject({
      frequency: 38000,
      durations: "9000 4500 560 560 560",
    });
  });

  it("skips unsupported protocols with a reason instead of failing", () => {
    expect(buttons.map((b) => b.label)).not.toContain("Fancy RC6");
    expect(skipped.length).toBe(1);
    expect(skipped[0]).toContain("Fancy_RC6");
    expect(skipped[0]).toContain("RC6");
  });

  it("colors power buttons red", () => {
    expect(byLabel["Power"].color).toBe("red");
  });

  it("returns nothing for garbage input", () => {
    const empty = FlipperIR.parse("hello\nworld");
    expect(empty.buttons.length).toBe(0);
    expect(empty.skipped.length).toBe(0);
  });
});
