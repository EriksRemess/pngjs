import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import bitPacker from "#lib/bitpacker";
import ChunkStream from "#lib/chunkstream";
import { getInflatedImageSize, getInflatedRowSize } from "#lib/inflate-size";
import Packer from "#lib/packer";
import PackerAsync from "#lib/packer-async";
import Parser from "#lib/parser";
import * as PNGSync from "#lib/png-sync";

function createParserDependencies() {
  let noop = () => {};
  return {
    read: noop,
    error: noop,
    metadata: noop,
    gamma: noop,
    transColor: noop,
    palette: noop,
    parsed: noop,
    inflateData: noop,
    finished: noop,
    simpleTransparency: noop,
  };
}

function createPixelData(width, height) {
  let data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  return data;
}

function createPatternData(width, height) {
  let data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let idx = (width * y + x) << 2;
      data[idx] = (x * 73 + y * 19) & 0xff;
      data[idx + 1] = (x * 11 + y * 131) & 0xff;
      data[idx + 2] = (x * 197 + y * 23) & 0xff;
      data[idx + 3] = 0xff - ((x * 17 + y * 29) & 0xff);
    }
  }
  return data;
}

function packWithPackerAsync(packer, data, width, height, gamma = 0) {
  return new Promise((resolve, reject) => {
    let chunks = [];

    let onData = (chunk) => {
      chunks.push(chunk);
    };

    let onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    let onError = (err) => {
      cleanup();
      reject(err);
    };

    let cleanup = () => {
      packer.removeListener("data", onData);
      packer.removeListener("end", onEnd);
      packer.removeListener("error", onError);
    };

    packer.on("data", onData);
    packer.once("end", onEnd);
    packer.once("error", onError);
    packer.pack(data, width, height, gamma);
  });
}

test("Packer constructor does not mutate options", () => {
  let options = Object.freeze({
    deflateChunkSize: 2048,
    deflateLevel: 1,
    deflateStrategy: 3,
    inputHasAlpha: false,
    bitDepth: 8,
    colorType: 6,
    inputColorType: 6,
    fastFilter: true,
  });

  assert.doesNotThrow(() => {
    new Packer(options);
  });
});

test("Packer fastFilter defaults to true and can be disabled", () => {
  assert.strictEqual(new Packer()._options.fastFilter, true);
  assert.strictEqual(
    new Packer({ fastFilter: false })._options.fastFilter,
    false,
  );
});

test("bitPacker fast path validates input length", () => {
  assert.throws(
    () =>
      bitPacker(Buffer.alloc(15), 2, 2, {
        bitDepth: 8,
        colorType: 6,
        inputColorType: 6,
        inputHasAlpha: true,
      }),
    /input data length mismatch: expected 16 bytes, got 15/,
  );
});

test("bitPacker uses fast opaque RGBA to RGB conversion", () => {
  let packed = bitPacker(
    Buffer.from([11, 22, 33, 255, 44, 55, 66, 255]),
    2,
    1,
    {
      bitDepth: 8,
      colorType: 2,
      inputColorType: 6,
      inputHasAlpha: true,
      bgColor: { red: 0, green: 0, blue: 0 },
    },
  );

  assert.ok(packed.equals(Buffer.from([11, 22, 33, 44, 55, 66])));
});

test("bitPacker still blends non-opaque RGBA to RGB", () => {
  let packed = bitPacker(Buffer.from([100, 150, 200, 128]), 1, 1, {
    bitDepth: 8,
    colorType: 2,
    inputColorType: 6,
    inputHasAlpha: true,
  });

  assert.ok(packed.equals(Buffer.from([177, 202, 227])));
});

test("PNG.sync.write fastFilter preserves pixel data", () => {
  let width = 9;
  let height = 7;
  let data = createPatternData(width, height);

  let encoded = PNGSync.write(
    {
      width,
      height,
      data,
    },
    { fastFilter: true, filterType: -1 },
  );
  let decoded = PNGSync.read(encoded);

  assert.strictEqual(decoded.width, width);
  assert.strictEqual(decoded.height, height);
  assert.ok(decoded.data.equals(data));
});

test("Parser constructor does not mutate options", () => {
  let options = Object.freeze({ checkCRC: false });

  assert.doesNotThrow(() => {
    new Parser(options, createParserDependencies());
  });
});

test("inflate-size helpers compute expected row and image sizes", () => {
  assert.strictEqual(getInflatedRowSize({ width: 1, bpp: 1, depth: 1 }), 2);
  assert.strictEqual(
    getInflatedImageSize({ width: 1, height: 3, bpp: 1, depth: 1 }),
    6,
  );

  assert.strictEqual(getInflatedRowSize({ width: 16, bpp: 4, depth: 8 }), 65);
  assert.strictEqual(
    getInflatedImageSize({ width: 16, height: 10, bpp: 4, depth: 8 }),
    650,
  );

  assert.strictEqual(getInflatedRowSize({ width: 1, bpp: 4, depth: 16 }), 9);
});

test("ChunkStream reads exact length across writes", async () => {
  let stream = new ChunkStream();
  let got;

  let readDone = new Promise((resolve) => {
    stream.read(4, (buf) => {
      got = buf;
      resolve();
    });
  });

  stream.write(Buffer.from("ab"));
  stream.write(Buffer.from("cd"));

  await readDone;
  assert.strictEqual(got.toString(), "abcd");
});

test("ChunkStream allowLess read returns available bytes on end", async () => {
  let stream = new ChunkStream();
  let got;

  let readDone = new Promise((resolve) => {
    stream.read(-10, (buf) => {
      got = buf;
      resolve();
    });
  });

  let closeDone = once(stream, "close");
  stream.end(Buffer.from("abc"));

  await readDone;
  await closeDone;

  assert.strictEqual(got.toString(), "abc");
});

test("ChunkStream emits error when ending with unsatisfied read", async () => {
  let stream = new ChunkStream();
  stream.read(5, () => {
    assert.fail("read callback should not be called");
  });

  let errorPromise = once(stream, "error");
  stream.end(Buffer.from("ab"));

  let [err] = await errorPromise;
  assert.ok(err instanceof Error);
  assert.match(err.message, /Unexpected end of input/);
});

test("ChunkStream.end writes empty buffer payload", async () => {
  class CountingChunkStream extends ChunkStream {
    constructor() {
      super();
      this.writeCalls = 0;
    }

    write(data, encoding) {
      this.writeCalls++;
      return super.write(data, encoding);
    }
  }

  let stream = new CountingChunkStream();
  let closeDone = once(stream, "close");

  stream.end(Buffer.alloc(0));
  await closeDone;

  assert.strictEqual(stream.writeCalls, 1);
});

test("PackerAsync emits error when pack called concurrently", async () => {
  let packer = new PackerAsync();
  let data = createPixelData(1, 1);

  packer.on("data", () => {});
  let errorPromise = once(packer, "error");
  packer.pack(data, 1, 1, 0);
  packer.pack(data, 1, 1, 0);

  let [err] = await errorPromise;
  assert.ok(err instanceof Error);
  assert.match(err.message, /already running/);
});

test("PackerAsync can be reused sequentially", async () => {
  let packer = new PackerAsync();
  let data = createPixelData(2, 2);

  let first = await packWithPackerAsync(packer, data, 2, 2, 0);
  let second = await packWithPackerAsync(packer, data, 2, 2, 0);

  assert.ok(first.equals(second));
  assert.strictEqual(first.readUInt32BE(0), 0x89504e47);
});
