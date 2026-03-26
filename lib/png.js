import { Stream } from "node:stream";
import Parser from "#lib/parser-async";
import Packer from "#lib/packer-async";
import * as PNGSync from "#lib/png-sync";
import { PNG as PNGWasm } from "../wasm/png.js";

class PNG extends Stream {
  constructor(options) {
    super();

    const pngOptions = options || {};

    // coerce pixel dimensions to integers (also coerces undefined -> 0):
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
    this.readable = this.writable = true;
    this._emitError = this.emit.bind(this, "error");
    this._emitData = this.emit.bind(this, "data");
    this._emitEnd = this.emit.bind(this, "end");
    this._onParserClose = this._handleClose.bind(this);
    this._onParserMetadata = this._metadata.bind(this);
    this._onParserGamma = this._gamma.bind(this);
    this._onParserParsed = (data) => {
      this.data = data;
      this.emit("parsed", data);
    };

    this._parser = new Parser(pngOptions);

    this._parser.on("error", this._emitError);
    this._parser.on("close", this._onParserClose);
    this._parser.on("metadata", this._onParserMetadata);
    this._parser.on("gamma", this._onParserGamma);
    this._parser.on("parsed", this._onParserParsed);

    this._packer = new Packer(pngOptions);
    this._packer.on("data", this._emitData);
    this._packer.on("end", this._emitEnd);
    this._packer.on("error", this._emitError);
  }

  pack() {
    if (!this.data || !this.data.length) {
      this.emit("error", new Error("No data provided"));
      return this;
    }

    process.nextTick(() => {
      this._packer.pack(this);
    });

    return this;
  }

  parse(data, callback) {
    if (callback) {
      let onParsed;
      let onError;

      onParsed = (parsedData) => {
        this.removeListener("error", onError);

        this.data = parsedData;
        callback(null, this);
      };

      onError = (err) => {
        this.removeListener("parsed", onParsed);

        callback(err, null);
      };

      this.once("parsed", onParsed);
      this.once("error", onError);
      this.end(data);
      return this;
    }

    return new Promise((resolve, reject) => {
      let onParsed;
      let onError;

      onParsed = () => {
        this.removeListener("error", onError);
        resolve(this);
      };

      onError = (err) => {
        this.removeListener("parsed", onParsed);
        reject(err);
      };

      this.once("parsed", onParsed);
      this.once("error", onError);

      this.end(data);
    });
  }

  write(data) {
    this._parser.write(data);
    return true;
  }

  end(data) {
    this._parser.end(data);
    return this;
  }

  _metadata(metadata) {
    this.width = metadata.width;
    this.height = metadata.height;
    this.colorType = metadata.colorType;
    this.depth = metadata.depth;
    this.interlace = metadata.interlace;
    this.palette = metadata.palette;
    this.color = metadata.color;
    this.alpha = metadata.alpha;
    this.bpp = metadata.bpp;

    this.emit("metadata", metadata);
  }

  _gamma(gamma) {
    this.gamma = gamma;
  }

  _handleClose() {
    if (!this._parser.writable && !this._packer.readable) {
      this.emit("close");
    }
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
        this.removeListener("data", onData);
        this.removeListener("end", onEnd);
        this.removeListener("error", onError);
      };

      this.on("data", onData);
      this.once("end", onEnd);
      this.once("error", onError);

      this.pack();
    });
  }

  static bitblt(src, dst, srcX, srcY, width, height, deltaX, deltaY) {
    // coerce pixel dimensions to integers (also coerces undefined -> 0):

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
          let idx = (src.width * y + x) << 2;

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

PNG.sync = PNGSync;

export { PNG };
export { PNGWasm };
export default PNG;
