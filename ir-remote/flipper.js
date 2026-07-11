/*
 * Flipper Zero .ir file importer.
 *
 * Parses the plain-text format used by Flipper-IRDB and the Flipper's own
 * saved signals, and converts each record into a button using the protocols
 * in encoders.js. Flipper stores address/command as little-endian hex bytes
 * with LSB-first bit order on the wire; our NEC-family encoders transmit the
 * written 32-bit value MSB-first, so bytes are bit-reversed here.
 */
const FlipperIR = (() => {
  function rev8(byte) {
    let out = 0;
    for (let i = 0; i < 8; i++) out = (out << 1) | ((byte >> i) & 1);
    return out;
  }

  // Reverse the low `count` bits of value (LSB-first wire order -> MSB-first
  // written order).
  function revBits(value, count) {
    let out = 0;
    for (let i = 0; i < count; i++) out = (out << 1) | ((value >> i) & 1);
    return out;
  }

  function parseBytes(str) {
    return String(str)
      .trim()
      .split(/\s+/)
      .map((b) => parseInt(b, 16));
  }

  function hex32(...bytesMsbFirst) {
    return bytesMsbFirst
      .map((b) => (b & 0xff).toString(16).padStart(2, "0").toUpperCase())
      .join("");
  }

  function convertParsed(rec) {
    const proto = (rec.protocol || "").toLowerCase();
    const addr = parseBytes(rec.address || "0");
    const cmd = parseBytes(rec.command || "0");
    const a0 = addr[0] || 0;
    const a1 = addr[1] || 0;
    const c0 = cmd[0] || 0;
    const c1 = cmd[1] || 0;

    if (proto === "nec") {
      // frame: addr, ~addr, cmd, ~cmd (each LSB-first on the wire)
      return {
        protocol: "nec",
        params: { code: hex32(rev8(a0), rev8(~a0), rev8(c0), rev8(~c0)) },
      };
    }
    if (proto === "necext") {
      // frame: addrLo, addrHi, cmdLo, cmdHi
      return {
        protocol: "nec",
        params: { code: hex32(rev8(a0), rev8(a1), rev8(c0), rev8(c1)) },
      };
    }
    if (proto === "samsung32") {
      // frame: addr, addr, cmd, ~cmd
      return {
        protocol: "samsung32",
        params: { code: hex32(rev8(a0), rev8(a0), rev8(c0), rev8(~c0)) },
      };
    }
    if (proto === "sirc" || proto === "sirc15" || proto === "sirc20") {
      const bits = proto === "sirc" ? 12 : proto === "sirc15" ? 15 : 20;
      const addrBits = bits - 7;
      const addrVal = (a1 << 8) | a0;
      // wire order: command 7 bits LSB-first, then address LSB-first
      const value =
        (revBits(c0, 7) << addrBits) | revBits(addrVal, addrBits);
      return {
        protocol: "sirc",
        params: {
          code: value.toString(16).toUpperCase(),
          bits,
        },
      };
    }
    if (proto === "rc5" || proto === "rc5x") {
      return {
        protocol: "rc5",
        params: {
          address: a0 & 0x1f,
          command: proto === "rc5x" ? (c0 & 0x3f) | 0x40 : c0 & 0x7f,
        },
      };
    }
    throw new Error("unsupported protocol: " + rec.protocol);
  }

  function convertRaw(rec) {
    const durations = String(rec.data || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    if (!durations.length) throw new Error("raw record has no data");
    return {
      protocol: "raw",
      params: {
        frequency: Number(rec.frequency) || 38000,
        durations: durations.join(" "),
      },
    };
  }

  function guessColor(name) {
    const n = name.toLowerCase();
    if (/(^|[^a-z])(power|off|on)([^a-z]|$)/.test(n)) return "red";
    if (/vol|ch[+_\- ]|ch$|chan|bright/.test(n)) return "blue";
    if (/ok|enter|play/.test(n)) return "green";
    return "dark";
  }

  /*
   * Parse a .ir file. Returns { buttons, skipped } where `buttons` are
   * ready to insert into a remote (minus ids) and `skipped` lists
   * "name (reason)" strings for records that could not be converted.
   */
  function parse(text) {
    const records = [];
    let current = null;
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_ ]*):\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
      const value = m[2].trim();
      if (key === "name") {
        current = { name: value };
        records.push(current);
      } else if (current) {
        current[key] = value;
      }
    }

    const buttons = [];
    const skipped = [];
    for (const rec of records) {
      try {
        const type = (rec.type || "").toLowerCase();
        const converted =
          type === "raw"
            ? convertRaw(rec)
            : type === "parsed"
              ? convertParsed(rec)
              : (() => {
                  throw new Error("unknown type: " + (rec.type || "(none)"));
                })();
        const label = rec.name.replace(/_/g, " ").slice(0, 16);
        buttons.push({
          label,
          color: guessColor(rec.name),
          protocol: converted.protocol,
          params: converted.params,
          repeat: converted.protocol === "sirc" ? 3 : 1,
        });
      } catch (err) {
        skipped.push(rec.name + " (" + (err.message || err) + ")");
      }
    }
    return { buttons, skipped };
  }

  return { parse };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = FlipperIR;
}
