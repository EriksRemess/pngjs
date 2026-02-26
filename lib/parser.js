import { crc32 } from "node:zlib";
import constants from "#lib/constants";

const NOOP = () => {};

class Parser {
  constructor(options = {}, dependencies) {
    this._options = {
      ...options,
      checkCRC: options.checkCRC !== false,
    };

    this._hasIHDR = false;
    this._hasIEND = false;
    this._emittedHeadersFinished = false;
    this._crc = 0;

    // input flags/metadata
    this._palette = [];
    this._colorType = 0;

    this._chunks = Object.create(null);
    this._chunks[constants.TYPE_IHDR] = this._handleIHDR.bind(this);
    this._chunks[constants.TYPE_IEND] = this._handleIEND.bind(this);
    this._chunks[constants.TYPE_IDAT] = this._handleIDAT.bind(this);
    this._chunks[constants.TYPE_PLTE] = this._handlePLTE.bind(this);
    this._chunks[constants.TYPE_tRNS] = this._handleTRNS.bind(this);
    this._chunks[constants.TYPE_gAMA] = this._handleGAMA.bind(this);
    this._parseSignatureBound = this._parseSignature.bind(this);
    this._parseChunkBeginBound = this._parseChunkBegin.bind(this);
    this._skipChunkBound = this._skipChunk.bind(this);
    this._parseChunkEndBound = this._parseChunkEnd.bind(this);
    this._parseIHDRBound = this._parseIHDR.bind(this);
    this._parsePLTEBound = this._parsePLTE.bind(this);
    this._parseTRNSBound = this._parseTRNS.bind(this);
    this._parseGAMABound = this._parseGAMA.bind(this);
    this._parseIENDBound = this._parseIEND.bind(this);

    this.read = dependencies.read;
    this.error = dependencies.error;
    this.metadata = dependencies.metadata;
    this.gamma = dependencies.gamma;
    this.transColor = dependencies.transColor;
    this.palette = dependencies.palette;
    this.parsed = dependencies.parsed;
    this.inflateData = dependencies.inflateData;
    this.finished = dependencies.finished;
    this.simpleTransparency = dependencies.simpleTransparency;
    this.headersFinished = dependencies.headersFinished || NOOP;
  }

  start() {
    this.read(constants.PNG_SIGNATURE.length, this._parseSignatureBound);
  }

  _parseSignature(data) {
    let signature = constants.PNG_SIGNATURE;

    for (let i = 0; i < signature.length; i++) {
      if (data[i] !== signature[i]) {
        this.error(new Error("Invalid file signature"));
        return;
      }
    }
    this.read(8, this._parseChunkBeginBound);
  }

  _parseChunkBegin(data) {
    // chunk content length
    let length = data.readUInt32BE(0);

    // chunk type
    let type = data.readUInt32BE(4);
    for (let i = 4; i < 8; i++) {
      const charCode = data[i];
      if (charCode < 65 || charCode > 122 || (charCode > 90 && charCode < 97)) {
        this.error(new Error("Invalid chunk type"));
        return;
      }
    }
    let name = data.toString("ascii", 4, 8);

    //console.log('chunk ', name, length);

    // chunk flags
    let ancillary = Boolean(data[4] & 0x20); // or critical
    //    priv = Boolean(data[5] & 0x20), // or public
    //    safeToCopy = Boolean(data[7] & 0x20); // or unsafe

    if (!this._hasIHDR && type !== constants.TYPE_IHDR) {
      this.error(new Error("Expected IHDR to be first chunk"));
      return;
    }

    this._crc = crc32(data.subarray(4, 8));

    let chunkHandler = this._chunks[type];
    if (chunkHandler) {
      return chunkHandler(length);
    }

    if (!ancillary) {
      this.error(new Error("Unsupported critical chunk type " + name));
      return;
    }

    this.read(length + 4, this._skipChunkBound);
  }

  _skipChunk(/*data*/) {
    this.read(8, this._parseChunkBeginBound);
  }

  _handleChunkEnd() {
    this.read(4, this._parseChunkEndBound);
  }

  _parseChunkEnd(data) {
    let fileCrc = data.readUInt32BE(0);
    let calcCrc = this._crc >>> 0;

    // check CRC
    if (this._options.checkCRC && calcCrc !== fileCrc) {
      this.error(new Error("Crc error - " + fileCrc + " - " + calcCrc));
      return;
    }

    if (!this._hasIEND) {
      this.read(8, this._parseChunkBeginBound);
    }
  }

  _handleIHDR(length) {
    this.read(length, this._parseIHDRBound);
  }

  _parseIHDR(data) {
    this._crc = crc32(data, this._crc);

    let width = data.readUInt32BE(0);
    let height = data.readUInt32BE(4);
    let depth = data[8];
    let colorType = data[9]; // bits: 1 palette, 2 color, 4 alpha
    let compr = data[10];
    let filter = data[11];
    let interlace = data[12];

    // console.log('    width', width, 'height', height,
    //     'depth', depth, 'colorType', colorType,
    //     'compr', compr, 'filter', filter, 'interlace', interlace
    // );

    if (
      depth !== 8 &&
      depth !== 4 &&
      depth !== 2 &&
      depth !== 1 &&
      depth !== 16
    ) {
      this.error(new Error("Unsupported bit depth " + depth));
      return;
    }
    if (!(colorType in constants.COLORTYPE_TO_BPP_MAP)) {
      this.error(new Error("Unsupported color type"));
      return;
    }
    if (compr !== 0) {
      this.error(new Error("Unsupported compression method"));
      return;
    }
    if (filter !== 0) {
      this.error(new Error("Unsupported filter method"));
      return;
    }
    if (interlace !== 0 && interlace !== 1) {
      this.error(new Error("Unsupported interlace method"));
      return;
    }

    this._colorType = colorType;

    let bpp = constants.COLORTYPE_TO_BPP_MAP[this._colorType];

    this._hasIHDR = true;

    this.metadata({
      width: width,
      height: height,
      depth: depth,
      interlace: Boolean(interlace),
      palette: Boolean(colorType & constants.COLORTYPE_PALETTE),
      color: Boolean(colorType & constants.COLORTYPE_COLOR),
      alpha: Boolean(colorType & constants.COLORTYPE_ALPHA),
      bpp: bpp,
      colorType: colorType,
    });

    this._handleChunkEnd();
  }

  _handlePLTE(length) {
    this.read(length, this._parsePLTEBound);
  }

  _parsePLTE(data) {
    this._crc = crc32(data, this._crc);

    let entries = Math.floor(data.length / 3);
    // console.log('Palette:', entries);

    for (let i = 0; i < entries; i++) {
      this._palette.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 0xff]);
    }

    this.palette(this._palette);

    this._handleChunkEnd();
  }

  _handleTRNS(length) {
    this.simpleTransparency();
    this.read(length, this._parseTRNSBound);
  }

  _parseTRNS(data) {
    this._crc = crc32(data, this._crc);

    // palette
    if (this._colorType === constants.COLORTYPE_PALETTE_COLOR) {
      if (this._palette.length === 0) {
        this.error(new Error("Transparency chunk must be after palette"));
        return;
      }
      if (data.length > this._palette.length) {
        this.error(new Error("More transparent colors than palette size"));
        return;
      }
      for (let i = 0; i < data.length; i++) {
        this._palette[i][3] = data[i];
      }
      this.palette(this._palette);
    }

    // for colorType 0 (grayscale) and 2 (rgb)
    // there might be one gray/color defined as transparent
    if (this._colorType === constants.COLORTYPE_GRAYSCALE) {
      // grey, 2 bytes
      this.transColor([data.readUInt16BE(0)]);
    }
    if (this._colorType === constants.COLORTYPE_COLOR) {
      this.transColor([
        data.readUInt16BE(0),
        data.readUInt16BE(2),
        data.readUInt16BE(4),
      ]);
    }

    this._handleChunkEnd();
  }

  _handleGAMA(length) {
    this.read(length, this._parseGAMABound);
  }

  _parseGAMA(data) {
    this._crc = crc32(data, this._crc);
    this.gamma(data.readUInt32BE(0) / constants.GAMMA_DIVISION);

    this._handleChunkEnd();
  }

  _handleIDAT(length) {
    if (!this._emittedHeadersFinished) {
      this._emittedHeadersFinished = true;
      this.headersFinished();
    }
    this.read(-length, this._parseIDAT.bind(this, length));
  }

  _parseIDAT(length, data) {
    this._crc = crc32(data, this._crc);

    if (
      this._colorType === constants.COLORTYPE_PALETTE_COLOR &&
      this._palette.length === 0
    ) {
      throw new Error("Expected palette not found");
    }

    this.inflateData(data);
    let leftOverLength = length - data.length;

    if (leftOverLength > 0) {
      this._handleIDAT(leftOverLength);
    } else {
      this._handleChunkEnd();
    }
  }

  _handleIEND(length) {
    this.read(length, this._parseIENDBound);
  }

  _parseIEND(data) {
    this._crc = crc32(data, this._crc);

    this._hasIEND = true;
    this._handleChunkEnd();

    if (this.finished) {
      this.finished();
    }
  }
}

export default Parser;
