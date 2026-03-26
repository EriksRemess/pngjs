import fs from "node:fs";
import path from "node:path";
import { Stream } from "node:stream";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import constants from "../lib/constants.js";
import Packer from "../lib/packer.js";
import { prepareWriteOptions } from "../lib/write-options.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(__dirname, "png.wasm");
const wasmTargetPath = path.join(
  __dirname,
  "target/wasm32-unknown-unknown/release/pngjs_wasm.wasm",
);

const memoryViewCache = {
  u8: null,
  u32: null,
  buffer: null,
};

function normalizeInputBuffer(input) {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }

  return Buffer.from(input);
}

function createApi(instance) {
  const { exports } = instance;
  let inputPtr = 0;
  let inputCap = 0;

  function refreshViews() {
    if (memoryViewCache.buffer !== exports.memory.buffer) {
      memoryViewCache.buffer = exports.memory.buffer;
      memoryViewCache.u8 = new Uint8Array(exports.memory.buffer);
      memoryViewCache.u32 = new Uint32Array(exports.memory.buffer);
    }
  }

  function ensureInputCapacity(len) {
    const allocLen = Math.max(1, len);
    if (allocLen <= inputCap) {
      return inputPtr;
    }

    if (inputPtr !== 0) {
      exports.dealloc(inputPtr, inputCap);
    }

    inputPtr = exports.alloc(allocLen);
    inputCap = allocLen;
    refreshViews();
    return inputPtr;
  }

  function copyIntoWasm(buffer) {
    refreshViews();
    const ptr = ensureInputCapacity(buffer.length);
    memoryViewCache.u8.set(buffer, ptr);
    return ptr;
  }

  function copyFromWasm(ptr, len) {
    refreshViews();
    return Buffer.copyBytesFrom(memoryViewCache.u8, ptr, len);
  }

  function viewFromWasm(ptr, len) {
    refreshViews();
    return Buffer.from(exports.memory.buffer, ptr, len);
  }

  function readResult(ptr) {
    refreshViews();
    const wordOffset = ptr >>> 2;
    const status = memoryViewCache.u32[wordOffset];
    const field1 = memoryViewCache.u32[wordOffset + 1];
    const field2 = memoryViewCache.u32[wordOffset + 2];
    const field3 = memoryViewCache.u32[wordOffset + 3];
    const field4 = memoryViewCache.u32[wordOffset + 4];
    const field5 = memoryViewCache.u32[wordOffset + 5];
    const field6 = memoryViewCache.u32[wordOffset + 6];
    const payloadLen = memoryViewCache.u32[wordOffset + 7];
    const payload = copyFromWasm(ptr + 32, payloadLen);
    exports.dealloc(ptr, payloadLen + 32);
    return { status, field1, field2, field3, field4, field5, field6, payload };
  }

  function readResultView(ptr) {
    refreshViews();
    const wordOffset = ptr >>> 2;
    return {
      status: memoryViewCache.u32[wordOffset],
      payloadLen: memoryViewCache.u32[wordOffset + 7],
    };
  }

  function callRead(input, options = {}) {
    const buffer = normalizeInputBuffer(input);
    const inputPtr = copyIntoWasm(buffer);
    const resultPtr = exports.png_sync_read(
      inputPtr,
      buffer.length,
      Number(options.checkCRC === false),
    );
    const result = readResult(resultPtr);

    if (result.status !== 0) {
      throw new Error(result.payload.toString("utf8"));
    }

    const flags = result.field5;
    const bpp = result.field6 >>> 24;
    const gammaScaled = result.field6 & 0x00ff_ffff;

    return {
      width: result.field1,
      height: result.field2,
      depth: result.field3,
      colorType: result.field4,
      interlace: Boolean(flags & (1 << 3)),
      palette: Boolean(flags & (1 << 2)),
      color: Boolean(flags & (1 << 0)),
      alpha: Boolean(flags & (1 << 1)),
      bpp,
      gamma: gammaScaled / 100000,
      data: result.payload,
    };
  }

  function normalizeWriteOptions(png, options = {}) {
    const packer = new Packer(prepareWriteOptions(png, options));
    const normalizedOptions = packer._options;
    const bitDepth = normalizedOptions.bitDepth;
    const bgColor = normalizedOptions.bgColor || {};
    const filterType =
      !("filterType" in normalizedOptions) ||
      normalizedOptions.filterType === -1
        ? [0, 1, 2, 3, 4]
        : typeof normalizedOptions.filterType === "number"
          ? [normalizedOptions.filterType]
          : Array.isArray(normalizedOptions.filterType)
            ? normalizedOptions.filterType.slice()
            : null;

    if (!filterType) {
      throw new Error("unrecognised filter types");
    }

    let filterMask = 0;
    for (const filter of filterType) {
      if (!Number.isInteger(filter) || filter < 0 || filter > 4) {
        throw new Error("unrecognised filter types");
      }
      filterMask |= 1 << filter;
    }

    return {
      packer,
      width: png.width,
      height: png.height,
      gamma: png.gamma || 0,
      gammaScaled: Math.max(0, Math.floor((png.gamma || 0) * 100000)),
      colorType: normalizedOptions.colorType,
      bitDepth,
      inputColorType: normalizedOptions.inputColorType,
      inputHasAlpha: normalizedOptions.inputHasAlpha,
      bgRed: bgColor.red ?? (bitDepth === 16 ? 65535 : 255),
      bgGreen: bgColor.green ?? (bitDepth === 16 ? 65535 : 255),
      bgBlue: bgColor.blue ?? (bitDepth === 16 ? 65535 : 255),
      filterMask,
      fastFilter: normalizedOptions.fastFilter === true,
    };
  }

  function callWrite(png, options) {
    if (!png.data?.length) {
      throw new Error("No data provided");
    }

    const meta = normalizeWriteOptions(png, options);
    const data = Buffer.isBuffer(png.data) ? png.data : Buffer.from(png.data);
    const dataPtr = copyIntoWasm(data);
    const resultPtr = exports.png_filter_pack(
      dataPtr,
      data.length,
      meta.width,
      meta.height,
      meta.gammaScaled,
      meta.colorType,
      meta.bitDepth,
      meta.inputColorType,
      Number(meta.inputHasAlpha),
      meta.bgRed,
      meta.bgGreen,
      meta.bgBlue,
      meta.filterMask,
      Number(meta.fastFilter),
    );
    const result = readResultView(resultPtr);

    if (result.status !== 0) {
      const err = readResult(resultPtr);
      throw new Error(err.payload.toString("utf8"));
    }

    const filtered = viewFromWasm(resultPtr + 32, result.payloadLen);
    const compressed = deflateSync(filtered, meta.packer.getDeflateOptions());
    exports.dealloc(resultPtr, result.payloadLen + 32);
    if (!compressed?.length) {
      throw new Error("bad png - invalid compressed data response");
    }

    const chunks = [
      Buffer.from(constants.PNG_SIGNATURE),
      meta.packer.packIHDR(meta.width, meta.height),
    ];

    if (meta.gamma) {
      chunks.push(meta.packer.packGAMA(meta.gamma));
    }

    chunks.push(meta.packer.packIDAT(compressed));
    chunks.push(meta.packer.packIEND());
    return Buffer.concat(chunks);
  }

  return { callRead, callWrite };
}

async function loadWasm() {
  let bytes;
  try {
    bytes = await fs.promises.readFile(wasmPath);
  } catch (err) {
    try {
      bytes = await fs.promises.readFile(wasmTargetPath);
    } catch {
      throw new Error(
        `Missing wasm binary at ${wasmPath}. Build it with: npm run build:wasm`,
        { cause: err },
      );
    }
  }

  const { instance } = await WebAssembly.instantiate(bytes, {});
  return createApi(instance);
}

const wasm = await loadWasm();

class PNG extends Stream {
  constructor(options) {
    super();

    const pngOptions = options || {};
    this.width = pngOptions.width | 0;
    this.height = pngOptions.height | 0;
    this.data =
      this.width > 0 && this.height > 0
        ? Buffer.alloc(4 * this.width * this.height)
        : null;
    if (pngOptions.fill && this.data) {
      this.data.fill(0);
    }

    this.gamma = 0;
    this.readable = true;
    this.writable = true;
    this._options = pngOptions;
    this._chunks = [];
  }

  pack() {
    if (!this.data?.length) {
      this.emit("error", new Error("No data provided"));
      return this;
    }

    process.nextTick(() => {
      try {
        const encoded = wasm.callWrite(this, this._options);
        this.emit("data", encoded);
        this.emit("end");
      } catch (err) {
        this.emit("error", err);
      }
    });

    return this;
  }

  parse(data, callback) {
    if (callback) {
      process.nextTick(() => {
        try {
          const png = this._parseSync(data);
          callback(null, png);
        } catch (err) {
          callback(err, null);
        }
      });
      return this;
    }

    return new Promise((resolve, reject) => {
      process.nextTick(() => {
        try {
          resolve(this._parseSync(data));
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  write(data) {
    this._chunks.push(Buffer.from(data));
    return true;
  }

  end(data) {
    if (data?.length) {
      this.write(data);
    }

    process.nextTick(() => {
      try {
        this._parseSync(Buffer.concat(this._chunks));
      } catch (err) {
        this.emit("error", err);
      }
    });

    return this;
  }

  _parseSync(data) {
    const parsed = PNG.sync.read(data, this._options);
    this.width = parsed.width;
    this.height = parsed.height;
    this.gamma = parsed.gamma;
    this.colorType = parsed.colorType;
    this.depth = parsed.depth;
    this.interlace = parsed.interlace;
    this.palette = parsed.palette;
    this.color = parsed.color;
    this.alpha = parsed.alpha;
    this.bpp = parsed.bpp;
    this.data = parsed.data;
    this.emit("metadata", parsed);
    this.emit("parsed", this.data);
    this.emit("close");
    return this;
  }

  bitblt(dst, srcX, srcY, width, height, deltaX, deltaY) {
    PNG.bitblt(this, dst, srcX, srcY, width, height, deltaX, deltaY);
    return this;
  }

  adjustGamma() {
    PNG.adjustGamma(this);
  }

  toBuffer() {
    return new Promise((resolve, reject) => {
      try {
        resolve(PNG.sync.write(this, this._options));
      } catch (err) {
        reject(err);
      }
    });
  }

  static bitblt(src, dst, srcX, srcY, width, height, deltaX, deltaY) {
    srcX |= 0;
    srcY |= 0;
    width |= 0;
    height |= 0;
    deltaX |= 0;
    deltaY |= 0;

    if (
      srcX > src.width ||
      srcY > src.height ||
      srcX + width > src.width ||
      srcY + height > src.height
    ) {
      throw new Error("bitblt reading outside image");
    }

    if (
      deltaX > dst.width ||
      deltaY > dst.height ||
      deltaX + width > dst.width ||
      deltaY + height > dst.height
    ) {
      throw new Error("bitblt writing outside image");
    }

    for (let y = 0; y < height; y++) {
      src.data.copy(
        dst.data,
        ((deltaY + y) * dst.width + deltaX) << 2,
        ((srcY + y) * src.width + srcX) << 2,
        ((srcY + y) * src.width + srcX + width) << 2,
      );
    }
  }

  static adjustGamma(src) {
    if (src.gamma) {
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const idx = (src.width * y + x) << 2;
          for (let i = 0; i < 3; i++) {
            let sample = src.data[idx + i] / 255;
            sample = Math.pow(sample, 1 / 2.2 / src.gamma);
            src.data[idx + i] = Math.round(sample * 255);
          }
        }
      }
      src.gamma = 0;
    }
  }

  static parse(buffer, options) {
    return new PNG(options).parse(buffer);
  }

  static fromBuffer(buffer, options) {
    return PNG.parse(buffer, options);
  }
}

PNG.sync = {
  read(buffer, options) {
    return wasm.callRead(buffer, options);
  },

  write(png, options) {
    return wasm.callWrite(png, options);
  },
};

export { PNG };
export default PNG;
