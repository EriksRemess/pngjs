#!/usr/bin/env node

import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PNG, PNGWasm } from "#lib/png";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(os.tmpdir(), "pngjs-wasm-test");
const tmpFile = path.join(tmpDir, "bg.png");

function packToFile(png, filename) {
  return new Promise((resolve, reject) => {
    let out = fs.createWriteStream(filename);
    out.once("error", reject);
    png.pack().once("error", reject).pipe(out);
    once(out, "finish").then(resolve, reject);
  });
}

const wasmTest = (name, ...args) => test(`wasm: ${name}`, ...args);

wasmTest(
  "outputs background, created from scratch",
  { timeout: 1000 * 60 * 5 },
  async () => {
    fs.mkdirSync(tmpDir, { recursive: true });

    let png = new PNGWasm({
      width: 10,
      height: 10,
      filterType: -1,
    });

    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        let idx = (png.width * y + x) << 2;
        let col = (x < png.width >> 1) ^ (y < png.height >> 1) ? 0xe5 : 0xff;

        png.data[idx] = col;
        png.data[idx + 1] = col;
        png.data[idx + 2] = col;
        png.data[idx + 3] = 0xff;
      }
    }

    await packToFile(png, tmpFile);

    let out = fs.readFileSync(tmpFile);
    let ref = fs.readFileSync(path.join(__dirname, "bg-ref.png"));
    let outParsed = PNG.sync.read(out);
    let refParsed = PNG.sync.read(ref);

    assert.strictEqual(outParsed.width, refParsed.width);
    assert.strictEqual(outParsed.height, refParsed.height);
    assert.ok(
      outParsed.data.equals(refParsed.data),
      "decoded pixels should match",
    );
  },
);

wasmTest("toBuffer packs png to a buffer", async () => {
  let png = new PNGWasm({
    width: 1,
    height: 1,
  });

  png.data[0] = 255;
  png.data[1] = 0;
  png.data[2] = 0;
  png.data[3] = 255;

  let out = await png.toBuffer();

  assert.ok(Buffer.isBuffer(out));
  assert.strictEqual(out.readUInt32BE(0), 0x89504e47);
});
