import path from "node:path";
import { createRequire } from "node:module";
import { Stream } from "node:stream";
import { fileURLToPath } from "node:url";
import Packer from "../lib/packer.js";
import { prepareWriteOptions } from "../lib/write-options.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getLinuxLibc() {
  if (process.platform !== "linux") {
    return null;
  }

  const report = process.report?.getReport?.();
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
}

function getBinaryName() {
  if (process.platform === "linux" && process.arch === "x64") {
    return `pngjs-native-linux-x64-${getLinuxLibc()}.node`;
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "pngjs-native-darwin-arm64.node";
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return "pngjs-native-darwin-x64.node";
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return "pngjs-native-win32-x64-msvc.node";
  }

  throw new Error(
    `Unsupported native target ${process.platform}-${process.arch}.`,
  );
}

const binaryName = getBinaryName();
const nativePath = path.join(__dirname, binaryName);

function normalizeInputBuffer(input) {
  if (Buffer.isBuffer(input)) {
    return input;
  }

  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }

  return Buffer.from(input);
}

function loadNative() {
  try {
    return require(nativePath);
  } catch (err) {
    throw new Error(
      `Missing native addon ${binaryName} at ${nativePath}. Check in the matching binary or build it with: npm run build:native`,
      { cause: err },
    );
  }
}

const native = loadNative();

function normalizeWriteOptions(png, options = {}) {
  const packer = new Packer(prepareWriteOptions(png, options));
  const normalizedOptions = packer._options;
  const bitDepth = normalizedOptions.bitDepth;
  const bgColor = normalizedOptions.bgColor || {};
  const filterType =
    !("filterType" in normalizedOptions) || normalizedOptions.filterType === -1
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
    deflateLevel:
      normalizedOptions.deflateLevel != null
        ? normalizedOptions.deflateLevel
        : 6,
    deflateStrategy:
      normalizedOptions.deflateStrategy != null
        ? normalizedOptions.deflateStrategy
        : 3,
  };
}

function callRead(input, options = {}) {
  return native.syncRead(
    normalizeInputBuffer(input),
    options.checkCRC !== false,
  );
}

function callWrite(png, options) {
  if (!png.data?.length) {
    throw new Error("No data provided");
  }

  const meta = normalizeWriteOptions(png, options);
  const data = normalizeInputBuffer(png.data);
  return native.syncWrite(
    data,
    meta.width,
    meta.height,
    meta.gammaScaled,
    meta.colorType,
    meta.bitDepth,
    meta.inputColorType,
    meta.inputHasAlpha,
    meta.bgRed,
    meta.bgGreen,
    meta.bgBlue,
    meta.filterMask,
    meta.fastFilter,
    meta.deflateLevel,
    meta.deflateStrategy,
  );
}

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
        const encoded = callWrite(this, this._options);
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
    return callRead(buffer, options);
  },

  write(png, options) {
    return callWrite(png, options);
  },
};

export { PNG };
export default PNG;
