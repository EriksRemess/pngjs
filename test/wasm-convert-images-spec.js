import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PNGWasm as PNG } from "#lib/png";

const wasmTest = (name, ...args) => test(`wasm: ${name}`, ...args);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inDir = path.join(__dirname, "in");
const outDir = path.join(os.tmpdir(), "pngjs-wasm-test", "out");
const outSyncDir = path.join(os.tmpdir(), "pngjs-wasm-test", "outsync");

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(outSyncDir, { recursive: true });

let files = fs.readdirSync(inDir).filter(function (file) {
  return Boolean(file.match(/\.png$/i));
});

console.log("Converting images");

function parseFileAsync(filename) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filename)
      .once("error", reject)
      .pipe(new PNG())
      .on("error", reject)
      .on("parsed", function () {
        resolve(this);
      });
  });
}

function packToFile(png, filename) {
  return new Promise((resolve, reject) => {
    let out = fs.createWriteStream(filename);
    out.once("error", reject);
    png.pack().once("error", reject).pipe(out);
    once(out, "finish").then(resolve, reject);
  });
}

files.forEach(function (file) {
  let expectedError = false;
  if (file.match(/^x/)) {
    expectedError = true;
  }

  wasmTest("convert sync - " + file, { timeout: 1000 * 60 * 5 }, async () => {
    let data = fs.readFileSync(path.join(inDir, file));
    let png;
    try {
      png = PNG.sync.read(data);
    } catch (e) {
      if (!expectedError) {
        assert.fail(
          "Unexpected error parsing.." +
            file +
            "\n" +
            e.message +
            "\n" +
            e.stack,
        );
      } else {
        return;
      }
    }

    if (expectedError) {
      assert.fail("Sync: Error expected, parsed fine .. - " + file);
    }

    let outpng = new PNG();
    outpng.gamma = png.gamma;
    outpng.data = png.data;
    outpng.width = png.width;
    outpng.height = png.height;
    await packToFile(outpng, path.join(outSyncDir, file));
  });

  wasmTest("convert async - " + file, { timeout: 1000 * 60 * 5 }, async () => {
    let png;
    try {
      png = await parseFileAsync(path.join(inDir, file));
    } catch (err) {
      if (!expectedError) {
        assert.fail(
          "Async: Unexpected error parsing.." +
            file +
            "\n" +
            err.message +
            "\n" +
            err.stack,
        );
      } else {
        return;
      }
    }

    if (expectedError) {
      assert.fail("Async: Error expected, parsed fine .." + file);
    }

    await packToFile(png, path.join(outDir, file));
  });
});
