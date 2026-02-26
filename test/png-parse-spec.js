import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PNG } from "#lib/png";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseFile(filename, readStreamOptions) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(
      path.join(__dirname, "png-parse-data", filename),
      readStreamOptions,
    )
      .once("error", reject)
      .pipe(new PNG())
      .on("error", reject)
      .on("parsed", function () {
        resolve(this);
      });
  });
}

function parseBuffer(buffer) {
  let bufferStream = new PassThrough();
  bufferStream.end(buffer);

  return new Promise((resolve, reject) => {
    bufferStream
      .pipe(new PNG({}))
      .on("error", reject)
      .on("parsed", function () {
        resolve(this);
      });
  });
}

function readMetadata(filename) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(path.join(__dirname, "in", filename))
      .once("error", reject)
      .pipe(new PNG())
      .on("error", reject)
      .on("metadata", resolve);
  });
}

function parseInputFile(filename, readStreamOptions) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(path.join(__dirname, "in", filename), readStreamOptions)
      .once("error", reject)
      .pipe(new PNG())
      .on("error", reject)
      .on("parsed", function () {
        resolve(this);
      });
  });
}

function getPixel(png, x, y) {
  return png.data.readUInt32BE((x + y * png.width) * 4);
}

test(
  "should correctly parse an 1-bit colormap png",
  { timeout: 5000 },
  async () => {
    let png = await parseFile("1bit.png");
    assert.strictEqual(png.width, 1024, "the width should be 1024");
    assert.strictEqual(png.height, 1024, "the height should be 1024");
    assert.strictEqual(png.data.length, 1024 * 1024 * 4);

    for (let y = 1023; y >= 0; y--) {
      for (let x = 1023; x >= 0; x--) {
        assert.strictEqual(
          getPixel(png, x, y),
          0x000000ff,
          `pixel does not match at (${x}, ${y})`,
        );
      }
    }
  },
);

test("should correctly parse an 8-bit grayscale png", async () => {
  let png = await parseFile("grayscale.png");
  assert.strictEqual(png.width, 16);
  assert.strictEqual(png.height, 16);
  assert.strictEqual(png.data.length, 16 * 16 * 4);

  for (let y = 15; y >= 0; y--) {
    for (let x = 15; x >= 0; x--) {
      assert.strictEqual(
        getPixel(png, x, y),
        (x ^ y) * 286331136 + 255,
        `pixel mismatch at (${x}, ${y})`,
      );
    }
  }
});

test("should correctly parse an 8-bit truecolor png", async () => {
  let png = await parseFile("truecolor.png");
  assert.strictEqual(png.width, 16);
  assert.strictEqual(png.height, 16);
  assert.strictEqual(png.data.length, 16 * 16 * 4);

  for (let y = 15; y >= 0; y--) {
    for (let x = 15; x >= 0; x--) {
      assert.strictEqual(
        getPixel(png, x, y),
        x * 285212672 + y * 1114112 + (x ^ y) * 4352 + 255,
        `pixel mismatch at (${x}, ${y})`,
      );
    }
  }
});

test("should correctly parse an 8-bit truecolor png with alpha", async () => {
  let png = await parseFile("truecoloralpha.png");
  assert.strictEqual(png.width, 16);
  assert.strictEqual(png.height, 16);
  assert.strictEqual(png.data.length, 16 * 16 * 4);

  for (let y = 15; y >= 0; y--) {
    for (let x = 15; x >= 0; x--) {
      assert.strictEqual(
        getPixel(png, x, y),
        x * 285212672 + y * 1114112 + (x ^ y) * 17,
        `pixel mismatch at (${x}, ${y})`,
      );
    }
  }
});

test("should correctly read image with scanline filter", async () => {
  let png = await parseFile("accum.png");
  assert.strictEqual(png.width, 1024);
  assert.strictEqual(png.height, 1024);
  assert.strictEqual(png.data.length, 1024 * 1024 * 4);

  assert.strictEqual(getPixel(png, 0, 0), 0xff0000ff);
  assert.strictEqual(getPixel(png, 1, 0), 0xff0000ff);
  assert.strictEqual(getPixel(png, 420, 308), 0xff0029ff);
  assert.strictEqual(getPixel(png, 433, 308), 0x0a299dff);
  assert.strictEqual(getPixel(png, 513, 308), 0x0066ffff);
  assert.strictEqual(getPixel(png, 728, 552), 0xff0047ff);
});

test("should correctly read an indexed color image", async () => {
  let png = await parseFile("indexed.png");
  assert.strictEqual(png.width, 16);
  assert.strictEqual(png.height, 16);
  assert.strictEqual(png.data.length, 16 * 16 * 4);

  for (let y = 15; y >= 0; y--) {
    for (let x = 15; x >= 0; x--) {
      let expected;
      if (x + y < 8) {
        expected = 0xff0000ff;
      } else if (x + y < 16) {
        expected = 0x00ff00ff;
      } else if (x + y < 24) {
        expected = 0x0000ffff;
      } else {
        expected = 0x000000ff;
      }

      assert.strictEqual(
        getPixel(png, x, y),
        expected,
        `pixel mismatch at (${x}, ${y})`,
      );
    }
  }
});

test("should correctly read an indexed color image with alpha", async () => {
  let png = await parseFile("indexedalpha.png");
  assert.strictEqual(png.width, 16);
  assert.strictEqual(png.height, 16);
  assert.strictEqual(png.data.length, 16 * 16 * 4);

  for (let y = 15; y >= 0; y--) {
    for (let x = 15; x >= 0; x--) {
      let expected;
      if (x >= 4 && x < 12) {
        expected = 0x00000000;
      } else if (x + y < 8) {
        expected = 0xff0000ff;
      } else if (x + y < 16) {
        expected = 0x00ff00ff;
      } else if (x + y < 24) {
        expected = 0x0000ffff;
      } else {
        expected = 0x000000ff;
      }

      assert.strictEqual(
        getPixel(png, x, y),
        expected,
        `pixel mismatch at (${x}, ${y})`,
      );
    }
  }
});

test("should correctly support crazily-filtered images", async () => {
  let png = await parseFile("paeth.png");
  assert.strictEqual(png.width, 512);
  assert.strictEqual(png.height, 512);
  assert.strictEqual(png.data.length, 512 * 512 * 4);

  assert.strictEqual(getPixel(png, 0, 0), 0xff000000);
  assert.strictEqual(getPixel(png, 1, 0), 0xff000000);
  assert.strictEqual(getPixel(png, 0, 1), 0xff000000);
  assert.strictEqual(getPixel(png, 2, 2), 0xff000000);
  assert.strictEqual(getPixel(png, 0, 50), 0xff000000);
  assert.strictEqual(getPixel(png, 219, 248), 0xff000d00);
  assert.strictEqual(getPixel(png, 220, 248), 0xff000d00);
  assert.strictEqual(getPixel(png, 215, 249), 0xff000c00);
  assert.strictEqual(getPixel(png, 216, 249), 0xff000c00);
  assert.strictEqual(getPixel(png, 217, 249), 0xff000d00);
  assert.strictEqual(getPixel(png, 218, 249), 0xff000d00);
  assert.strictEqual(getPixel(png, 219, 249), 0xff000e00);
  assert.strictEqual(getPixel(png, 220, 249), 0xff000e00);
  assert.strictEqual(getPixel(png, 263, 319), 0xff002100);
  assert.strictEqual(getPixel(png, 145, 318), 0x05535a00);
  assert.strictEqual(getPixel(png, 395, 286), 0x0007ff00);
  assert.strictEqual(getPixel(png, 152, 167), 0x052c3500);
  assert.strictEqual(getPixel(png, 153, 167), 0x04303600);
  assert.strictEqual(getPixel(png, 154, 167), 0x042f3700);
  assert.strictEqual(getPixel(png, 100, 168), 0xff000400);
  assert.strictEqual(getPixel(png, 120, 168), 0xff000900);
  assert.strictEqual(getPixel(png, 140, 168), 0xff001b00);
  assert.strictEqual(getPixel(png, 150, 168), 0x05313600);
  assert.strictEqual(getPixel(png, 152, 168), 0x04343c00);
  assert.strictEqual(getPixel(png, 153, 168), 0x03343f00);
  assert.strictEqual(getPixel(png, 154, 168), 0x03344100);
  assert.strictEqual(getPixel(png, 155, 168), 0x02344300);
  assert.strictEqual(getPixel(png, 156, 168), 0x02314400);
  assert.strictEqual(getPixel(png, 157, 168), 0x02323f00);
  assert.strictEqual(getPixel(png, 158, 168), 0x03313900);
});

test("should bail with an error given an invalid PNG", async () => {
  let buf = Buffer.from("I AM NOT ACTUALLY A PNG", "utf8");
  await assert.rejects(parseBuffer(buf), Error);
});

test("should bail with an error given an empty file", async () => {
  let buf = Buffer.from("");
  await assert.rejects(parseBuffer(buf), Error);
});

test("should bail with an error given a bad chunk type", async () => {
  await assert.rejects(parseFile("with_bad_type.png"), Error);
});

test("should bail with an error given a truncated PNG", async () => {
  let buf = Buffer.from("89504e470d0a1a0a000000", "hex");
  await assert.rejects(parseBuffer(buf), Error);
});

test("should return an error if a PNG is normal except for a missing IEND", async () => {
  let buf = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000100000001008000000003a98a0bd000000017352474200aece1ce90000002174455874536f6674776172650047726170686963436f6e7665727465722028496e74656c297787fa190000008849444154789c448e4111c020100363010b58c00216b080052c60010b58c0c259c00216ae4d3b69df99dd0d1062caa5b63ee6b27d1c012996dceae86b6ef38398106acb65ae3e8edbbef780564b5e73743fdb409e1ef2f4803c3de4e901797ac8d3f3f0f490a7077ffffd03f5f507eaeb0fd4d71fa8af3f505f7fa0befe7c7dfdb9000000ffff0300c0fd7f8179301408",
    "hex",
  );

  await assert.rejects(parseBuffer(buf), Error);
});

test("should set alpha=true in metadata for images with tRNS chunk", async () => {
  let metadata = await readMetadata("tbbn0g04.png");
  assert.ok(metadata.alpha, "Image should have alpha=true");
});

test("Should parse with low highWaterMark", async () => {
  await parseInputFile("tbbn0g04.png", { highWaterMark: 2 });
});

test("should support promise parse on instance", async () => {
  let buffer = fs.readFileSync(
    path.join(__dirname, "png-parse-data", "truecolor.png"),
  );
  let png = await new PNG().parse(buffer);

  assert.ok(png instanceof PNG);
  assert.strictEqual(png.width, 16);
  assert.strictEqual(png.height, 16);
});

test("should support static promise parse helpers", async () => {
  let buffer = fs.readFileSync(
    path.join(__dirname, "png-parse-data", "truecolor.png"),
  );
  let png1 = await PNG.parse(buffer);
  let png2 = await PNG.fromBuffer(buffer);

  assert.ok(png1 instanceof PNG);
  assert.ok(png2 instanceof PNG);
  assert.strictEqual(png1.width, 16);
  assert.strictEqual(png2.height, 16);
});
