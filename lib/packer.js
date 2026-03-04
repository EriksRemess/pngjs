import bitPacker from "#lib/bitpacker";
import constants from "#lib/constants";
import filter from "#lib/filter-pack";
import { crc32, createDeflate, constants as zlibconstants } from "node:zlib";

const SUPPORTED_COLOR_TYPES = [
  constants.COLORTYPE_GRAYSCALE,
  constants.COLORTYPE_COLOR,
  constants.COLORTYPE_COLOR_ALPHA,
  constants.COLORTYPE_ALPHA,
];

class Packer {
  constructor(options = {}) {
    let normalizedOptions = { ...options };

    normalizedOptions.deflateChunkSize =
      normalizedOptions.deflateChunkSize || 32 * 1024;
    normalizedOptions.deflateLevel =
      normalizedOptions.deflateLevel != null
        ? normalizedOptions.deflateLevel
        : 6;
    normalizedOptions.deflateStrategy =
      normalizedOptions.deflateStrategy != null
        ? normalizedOptions.deflateStrategy
        : zlibconstants.Z_RLE;
    normalizedOptions.inputHasAlpha =
      normalizedOptions.inputHasAlpha != null
        ? normalizedOptions.inputHasAlpha
        : true;
    normalizedOptions.deflateFactory =
      normalizedOptions.deflateFactory || createDeflate;
    normalizedOptions.bitDepth = normalizedOptions.bitDepth || 8;
    normalizedOptions.fastFilter =
      normalizedOptions.fastFilter == null
        ? true
        : normalizedOptions.fastFilter === true;
    // This is outputColorType
    normalizedOptions.colorType =
      typeof normalizedOptions.colorType === "number"
        ? normalizedOptions.colorType
        : constants.COLORTYPE_COLOR_ALPHA;
    normalizedOptions.inputColorType =
      typeof normalizedOptions.inputColorType === "number"
        ? normalizedOptions.inputColorType
        : constants.COLORTYPE_COLOR_ALPHA;

    this._options = normalizedOptions;

    if (!SUPPORTED_COLOR_TYPES.includes(normalizedOptions.colorType)) {
      throw new Error(
        "option color type:" +
          normalizedOptions.colorType +
          " is not supported at present",
      );
    }
    if (!SUPPORTED_COLOR_TYPES.includes(normalizedOptions.inputColorType)) {
      throw new Error(
        "option input color type:" +
          normalizedOptions.inputColorType +
          " is not supported at present",
      );
    }
    if (normalizedOptions.bitDepth !== 8 && normalizedOptions.bitDepth !== 16) {
      throw new Error(
        "option bit depth:" +
          normalizedOptions.bitDepth +
          " is not supported at present",
      );
    }
  }

  getDeflateOptions() {
    return {
      chunkSize: this._options.deflateChunkSize,
      level: this._options.deflateLevel,
      strategy: this._options.deflateStrategy,
    };
  }

  createDeflate() {
    return this._options.deflateFactory(this.getDeflateOptions());
  }

  filterData(data, width, height) {
    // convert to correct format for filtering (e.g. right bpp and bit depth)
    let packedData = bitPacker(data, width, height, this._options);

    // filter pixel data
    let bpp = constants.COLORTYPE_TO_BPP_MAP[this._options.colorType];
    let filteredData = filter(packedData, width, height, this._options, bpp);
    return filteredData;
  }

  _packChunk(type, data) {
    let len = data ? data.length : 0;
    let buf = Buffer.alloc(len + 12);

    buf.writeUInt32BE(len, 0);
    buf.writeUInt32BE(type, 4);

    if (data) {
      data.copy(buf, 8);
    }

    buf.writeUInt32BE(crc32(buf.subarray(4, buf.length - 4)), buf.length - 4);
    return buf;
  }

  packGAMA(gamma) {
    let buf = Buffer.alloc(4);
    buf.writeUInt32BE(Math.floor(gamma * constants.GAMMA_DIVISION), 0);
    return this._packChunk(constants.TYPE_gAMA, buf);
  }

  packIHDR(width, height) {
    let buf = Buffer.alloc(13);
    buf.writeUInt32BE(width, 0);
    buf.writeUInt32BE(height, 4);
    buf[8] = this._options.bitDepth; // Bit depth
    buf[9] = this._options.colorType; // colorType
    buf[10] = 0; // compression
    buf[11] = 0; // filter
    buf[12] = 0; // interlace

    return this._packChunk(constants.TYPE_IHDR, buf);
  }

  packIDAT(data) {
    return this._packChunk(constants.TYPE_IDAT, data);
  }

  packIEND() {
    return this._packChunk(constants.TYPE_IEND, null);
  }
}

export default Packer;
