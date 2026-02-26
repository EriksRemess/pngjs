import * as zlib from "node:zlib";
import ChunkStream from "#lib/chunkstream";
import FilterAsync from "#lib/filter-parse-async";
import Parser from "#lib/parser";
import * as bitmapper from "#lib/bitmapper";
import formatNormaliser from "#lib/format-normaliser";
import { getInflatedImageSize } from "#lib/inflate-size";

class ParserAsync extends ChunkStream {
  constructor(options) {
    super();

    this._options = options;
    this._parser = null;
    this._inflate = null;
    this._filter = null;
    this._metaData = null;
    this._bitmapInfo = null;
    this._leftToInflate = 0;
    this.errord = false;

    this._readChunk = this.read.bind(this);
    this._emitError = this.emit.bind(this, "error");
    this._emitGamma = this.emit.bind(this, "gamma");
    this._onParserError = this._handleError.bind(this);
    this._onParserMetaData = this._handleMetaData.bind(this);
    this._onParserPalette = this._handlePalette.bind(this);
    this._onParserTransColor = this._handleTransColor.bind(this);
    this._onParserFinished = this._finished.bind(this);
    this._onParserInflateData = this._inflateData.bind(this);
    this._onParserSimpleTransparency = this._simpleTransparency.bind(this);
    this._onParserHeadersFinished = this._headersFinished.bind(this);
    this._onFilterComplete = this._complete.bind(this);
    this._onInflateError = (err) => {
      this._emitError(err);
    };
    this._onInflateErrorLimited = (err) => {
      if (this._leftToInflate > 0) {
        this._emitError(err);
      }
    };
    this._onInflateData = (chunk) => {
      if (!this._filter || this._leftToInflate <= 0) {
        return;
      }

      if (chunk.length > this._leftToInflate) {
        chunk = chunk.subarray(0, this._leftToInflate);
      }

      this._leftToInflate -= chunk.length;
      this._filter.write(chunk);
    };
    this._onInflateEnd = () => {
      if (this._filter) {
        this._filter.end();
      }
    };

    this._parser = new Parser(options, {
      read: this._readChunk,
      error: this._onParserError,
      metadata: this._onParserMetaData,
      gamma: this._emitGamma,
      palette: this._onParserPalette,
      transColor: this._onParserTransColor,
      finished: this._onParserFinished,
      inflateData: this._onParserInflateData,
      simpleTransparency: this._onParserSimpleTransparency,
      headersFinished: this._onParserHeadersFinished,
    });

    this.writable = true;
    this._parser.start();
  }

  _handleError(err) {
    this.emit("error", err);

    this.writable = false;
    this.destroy();

    if (this._inflate && this._inflate.destroy) {
      this._inflate.destroy();
      this._inflate = null;
    }

    if (this._filter) {
      this._filter.destroy();
      this._filter = null;
    }

    this.errord = true;
  }

  _inflateData(data) {
    if (!this._inflate) {
      if (this._bitmapInfo.interlace) {
        this._createInterlacedInflate();
      } else {
        this._createNonInterlacedInflate();
      }
    }

    this._inflate.write(data);
  }

  _createInterlacedInflate() {
    this._leftToInflate = 0;
    this._inflate = zlib.createInflate();
    this._inflate.on("error", this._onInflateError);
    this._filter.on("complete", this._onFilterComplete);
    this._inflate.pipe(this._filter);
  }

  _createNonInterlacedInflate() {
    let imageSize = getInflatedImageSize(this._bitmapInfo);
    this._leftToInflate = imageSize;

    this._inflate = zlib.createInflate({
      chunkSize: Math.max(imageSize, zlib.Z_MIN_CHUNK),
    });
    this._inflate.on("error", this._onInflateErrorLimited);
    this._inflate.on("data", this._onInflateData);
    this._inflate.on("end", this._onInflateEnd);
    this._filter.on("complete", this._onFilterComplete);
  }

  _handleMetaData(metaData) {
    this._metaData = metaData;
    this._bitmapInfo = Object.create(metaData);
    this._filter = new FilterAsync(this._bitmapInfo);
  }

  _handleTransColor(transColor) {
    this._bitmapInfo.transColor = transColor;
  }

  _handlePalette(palette) {
    this._bitmapInfo.palette = palette;
  }

  _simpleTransparency() {
    this._metaData.alpha = true;
  }

  _headersFinished() {
    // Up until this point, we don't know if we have a tRNS chunk (alpha)
    // so we can't emit metadata any earlier
    this.emit("metadata", this._metaData);
  }

  _finished() {
    if (this.errord) {
      return;
    }

    if (!this._inflate) {
      this.emit("error", new Error("No Inflate block"));
      return;
    }

    this._inflate.end();
  }

  _complete(filteredData) {
    if (this.errord) {
      return;
    }

    let normalisedBitmapData;

    try {
      let bitmapData = bitmapper.dataToBitMap(filteredData, this._bitmapInfo);
      normalisedBitmapData = formatNormaliser(
        bitmapData,
        this._bitmapInfo,
        this._options.skipRescale,
      );
    } catch (ex) {
      this._handleError(ex);
      return;
    }

    this.emit("parsed", normalisedBitmapData);
  }
}

export default ParserAsync;
