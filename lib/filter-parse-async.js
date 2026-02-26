import ChunkStream from "#lib/chunkstream";
import Filter from "#lib/filter-parse";

class FilterAsync extends ChunkStream {
  constructor(bitmapInfo) {
    super();

    this._filterBuffers = [];
    this._readFromChunkStream = this.read.bind(this);
    this._handleFilterWrite = (buffer) => {
      this._filterBuffers.push(buffer);
    };
    this._handleFilterComplete = () => {
      this.emit("complete", Buffer.concat(this._filterBuffers));
      this._filterBuffers.length = 0;
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
