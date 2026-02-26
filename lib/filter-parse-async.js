import ChunkStream from "#lib/chunkstream";
import Filter from "#lib/filter-parse";
import { getUnfilteredImageSize } from "#lib/inflate-size";

class FilterAsync extends ChunkStream {
  constructor(bitmapInfo) {
    super();

    this._output = Buffer.allocUnsafe(getUnfilteredImageSize(bitmapInfo));
    this._outputPos = 0;
    this._readFromChunkStream = this.read.bind(this);
    this._handleFilterWrite = (buffer) => {
      buffer.copy(this._output, this._outputPos);
      this._outputPos += buffer.length;
    };
    this._handleFilterComplete = () => {
      if (this._outputPos !== this._output.length) {
        this.emit("error", new Error("bad png - invalid filtered data length"));
        return;
      }
      this.emit("complete", this._output);
      this._output = null;
    };

    this._filter = new Filter(bitmapInfo, {
      read: this._readFromChunkStream,
      write: this._handleFilterWrite,
      complete: this._handleFilterComplete,
    });

    this._filter.start();
  }
}

export default FilterAsync;
