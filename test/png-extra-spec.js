import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { PNG } from "#lib/png";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fixtureBuffer(relPath) {
  return fs.readFileSync(path.join(__dirname, relPath));
}

function createPngObject(width, height) {
  let png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let idx = (width * y + x) << 2;
      png.data[idx] = (x * 70) & 0xff;
      png.data[idx + 1] = (y * 90) & 0xff;
      png.data[idx + 2] = (x ^ y) & 0xff;
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

function parseChunks(buffer) {
  assert.ok(buffer.subarray(0, 8).equals(PNG_SIGNATURE));
  let offset = 8;
  let chunks = [];

  while (offset + 12 <= buffer.length) {
    let length = buffer.readUInt32BE(offset);
    let type = buffer.toString("ascii", offset + 4, offset + 8);
    let dataStart = offset + 8;
    let dataEnd = dataStart + length;
    let crc = buffer.readUInt32BE(dataEnd);

    chunks.push({
      type,
      data: buffer.subarray(dataStart, dataEnd),
      crc,
    });

    offset = dataEnd + 4;
    if (type === "IEND") {
      break;
    }
  }

  return chunks;
}

function encodeChunk(type, data = Buffer.alloc(0)) {
  let buf = Buffer.alloc(12 + data.length);
  buf.writeUInt32BE(data.length, 0);
  buf.write(type, 4, 4, "ascii");
  data.copy(buf, 8);
  buf.writeUInt32BE(crc32(buf.subarray(4, buf.length - 4)), buf.length - 4);
  return buf;
}

function rebuildPng(chunks) {
  return Buffer.concat([
    PNG_SIGNATURE,
    ...chunks.map((chunk) => encodeChunk(chunk.type, chunk.data)),
  ]);
}

function corruptIhdrCrc(buffer) {
  let out = Buffer.from(buffer);
  // Signature(8) + Length(4) + Type(4) + IHDR data(13) = CRC offset
  out[29] ^= 0xff;
  return out;
}

function removeIdatChunks(buffer) {
  let chunks = parseChunks(buffer).filter((chunk) => chunk.type !== "IDAT");
  return rebuildPng(chunks);
}

function splitIdatChunks(buffer) {
  let chunks = parseChunks(buffer);
  let combinedIdat = [];
  let out = [];
  let inserted = false;

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (chunk.type === "IDAT") {
      combinedIdat.push(chunk.data);
      continue;
    }

    if (!inserted && combinedIdat.length > 0) {
      let idatData = Buffer.concat(combinedIdat);
      let splitAt = Math.max(1, Math.floor(idatData.length / 2));
      if (splitAt >= idatData.length) {
        splitAt = idatData.length - 1;
      }
      out.push({ type: "IDAT", data: idatData.subarray(0, splitAt) });
      out.push({ type: "IDAT", data: idatData.subarray(splitAt) });
      inserted = true;
    }

    out.push(chunk);
  }

  if (!inserted) {
    let idatChunks = chunks.filter((chunk) => chunk.type === "IDAT");
    assert.ok(idatChunks.length > 0, "source png should contain IDAT");
    let idatData = Buffer.concat(idatChunks.map((chunk) => chunk.data));
    let splitAt = Math.max(1, Math.floor(idatData.length / 2));
    if (splitAt >= idatData.length) {
      splitAt = idatData.length - 1;
    }
    let firstIEND = out.findIndex((chunk) => chunk.type === "IEND");
    out.splice(firstIEND, 0, {
      type: "IDAT",
      data: idatData.subarray(0, splitAt),
    });
    out.splice(firstIEND + 1, 0, {
      type: "IDAT",
      data: idatData.subarray(splitAt),
    });
  }

  return rebuildPng(out);
}

async function parseAsync(buffer, options) {
  return PNG.parse(buffer, options);
}

test("CRC check can be disabled (sync and async)", async () => {
  let src = createPngObject(2, 2);
  let buf = PNG.sync.write(src);
  let corrupt = corruptIhdrCrc(buf);

  assert.throws(
    () => PNG.sync.read(corrupt),
    /(Crc error|Unrecognised content at end of stream)/,
  );

  let syncParsed = PNG.sync.read(corrupt, { checkCRC: false });
  assert.strictEqual(syncParsed.width, 2);
  assert.strictEqual(syncParsed.height, 2);

  await assert.rejects(parseAsync(corrupt), /Crc error/);

  let asyncParsed = await parseAsync(corrupt, { checkCRC: false });
  assert.strictEqual(asyncParsed.width, 2);
  assert.strictEqual(asyncParsed.height, 2);
  assert.ok(asyncParsed.data.equals(syncParsed.data));
});

test("PNG.pack emits Error object when no data is provided", async () => {
  let png = new PNG();

  let errorPromise = new Promise((resolve) => {
    png.once("error", resolve);
  });

  png.pack();
  let err = await errorPromise;

  assert.ok(err instanceof Error);
  assert.match(err.message, /No data provided/);
});

test("PNG.parse emits Error object when PNG has no IDAT chunks", async () => {
  let src = createPngObject(1, 1);
  let buf = PNG.sync.write(src);
  let noIdat = removeIdatChunks(buf);

  await assert.rejects(parseAsync(noIdat), (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /No Inflate block/);
    return true;
  });
});

test("promise APIs reject on invalid input", async () => {
  await assert.rejects(new PNG().parse(Buffer.alloc(0)), (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /Unexpected end of input/);
    return true;
  });

  await assert.rejects(new PNG().toBuffer(), (err) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, /No data provided/);
    return true;
  });
});

test("sync and async parsing produce identical output for a small fixture", async () => {
  let buf = fixtureBuffer("in/basi0g01.png");

  let syncPng = PNG.sync.read(buf);
  let asyncPng = await parseAsync(buf);

  assert.strictEqual(asyncPng.width, syncPng.width);
  assert.strictEqual(asyncPng.height, syncPng.height);
  assert.ok(asyncPng.data.equals(syncPng.data));
});

test("sync and async parsing produce identical output for an interlaced fixture", async () => {
  let buf = fixtureBuffer("in/s01i3p01.png");

  let syncPng = PNG.sync.read(buf);
  let asyncPng = await parseAsync(buf);

  assert.strictEqual(asyncPng.width, syncPng.width);
  assert.strictEqual(asyncPng.height, syncPng.height);
  assert.ok(asyncPng.data.equals(syncPng.data));
});

test("parser handles PNGs with multiple IDAT chunks", async () => {
  let src = createPngObject(4, 4);
  let singleIdat = PNG.sync.write(src);
  let multiIdat = splitIdatChunks(singleIdat);
  let multiIdatChunks = parseChunks(multiIdat).filter(
    (chunk) => chunk.type === "IDAT",
  );

  assert.ok(multiIdatChunks.length >= 2);

  let syncPng = PNG.sync.read(multiIdat);
  let asyncPng = await parseAsync(multiIdat);

  assert.strictEqual(syncPng.width, 4);
  assert.strictEqual(syncPng.height, 4);
  assert.ok(syncPng.data.equals(asyncPng.data));
});
