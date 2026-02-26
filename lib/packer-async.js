import { EventEmitter } from "node:events";
import constants from "#lib/constants";
import Packer from "#lib/packer";

class PackerAsync extends EventEmitter {
  constructor(opt) {
    super();

    this._packer = new Packer(opt);
    this._deflate = null;
    this._packing = false;
    this._onDeflateError = (err) => {
      this._packing = false;
      this._deflate = null;
      this.emit("error", err);
    };
    this._onDeflateData = this._handleDeflateData.bind(this);
    this._onDeflateEnd = this._handleDeflateEnd.bind(this);

    this.readable = true;
  }

  pack(data, width, height, gamma) {
    if (this._packing) {
      this.emit("error", new Error("Packer is already running"));
      return;
    }

    this._packing = true;
    this.readable = true;
    this._deflate = this._packer.createDeflate();
    this._deflate.on("error", this._onDeflateError);
    this._deflate.on("data", this._onDeflateData);
    this._deflate.on("end", this._onDeflateEnd);

    // Signature
    this.emit("data", Buffer.from(constants.PNG_SIGNATURE));
    this.emit("data", this._packer.packIHDR(width, height));

    if (gamma) {
      this.emit("data", this._packer.packGAMA(gamma));
    }

    let filteredData = this._packer.filterData(data, width, height);

    this._deflate.end(filteredData);
  }

  _handleDeflateData(compressedData) {
    this.emit("data", this._packer.packIDAT(compressedData));
  }

  _handleDeflateEnd() {
    this._packing = false;
    this._deflate = null;
    this.readable = false;
    this.emit("data", this._packer.packIEND());
    this.emit("end");
  }
}

export default PackerAsync;
