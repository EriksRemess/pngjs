import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";
import test from "node:test";

import { PNG as LocalPNG } from "#lib/png";
import { PNG as WasmPNG } from "../wasm/png.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(
  path.join(__dirname, "png-parse-data", "truecolor.png"),
);

test("wasm sync.read matches local pixel output", () => {
  const local = LocalPNG.sync.read(fixture);
  const wasm = WasmPNG.sync.read(fixture);

  assert.equal(wasm.width, local.width);
  assert.equal(wasm.height, local.height);
  assert.equal(wasm.gamma, local.gamma);
  assert.ok(wasm.data.equals(local.data));
});

test("wasm async parse callback returns PNG instance", async () => {
  const parsed = await new Promise((resolve, reject) => {
    new WasmPNG().parse(fixture, (err, png) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(png);
    });
  });

  assert.ok(parsed instanceof WasmPNG);
  assert.equal(parsed.width, 16);
  assert.equal(parsed.height, 16);
  assert.equal(parsed.data.length, 16 * 16 * 4);
});

test("wasm toBuffer round-trips through local parser", async () => {
  const parsed = await WasmPNG.parse(fixture);
  const encoded = await parsed.toBuffer();
  const reparsed = LocalPNG.sync.read(encoded);

  assert.equal(reparsed.width, parsed.width);
  assert.equal(reparsed.height, parsed.height);
  assert.ok(reparsed.data.equals(parsed.data));
});
