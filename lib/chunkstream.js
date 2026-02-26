import { EventEmitter } from "node:events";

class ChunkStream extends EventEmitter {
  constructor() {
    super();

    this._buffers = [];
    this._buffered = 0;

    this._reads = [];
    this._paused = false;
    this._ending = false;

    this._encoding = "utf8";
    this.writable = true;
  }

  read(length, callback) {
    this._reads.push({
      length: Math.abs(length), // if length < 0 then at most this length
      allowLess: length < 0,
      func: callback,
    });

    process.nextTick(() => {
      this._process();

      // its paused and there is not enought data then ask for more
      if (this._paused && this._reads && this._reads.length > 0) {
        this._paused = false;

        this.emit("drain");
      }
    });
  }

  write(data, encoding) {
    if (!this.writable) {
      this.emit("error", new Error("Stream not writable"));
      return false;
    }

    let dataBuffer;
    if (Buffer.isBuffer(data)) {
      dataBuffer = data;
    } else {
      dataBuffer = Buffer.from(data, encoding || this._encoding);
    }

    this._buffers.push(dataBuffer);
    this._buffered += dataBuffer.length;

    this._process();

    // ok if there are no more read requests
    if (this._reads && this._reads.length === 0) {
      this._paused = true;
    }

    return this.writable && !this._paused;
  }

  end(data, encoding) {
    if (data !== undefined) {
      this.write(data, encoding);
    }

    this.writable = false;
    this._ending = true;

    // already destroyed
    if (!this._buffers) {
      return;
    }

    // enqueue or handle end
    if (this._buffered === 0) {
      this._end();
    } else {
      this._process();
    }
  }

  destroySoon(data, encoding) {
    return this.end(data, encoding);
  }

  _end() {
    if (this._reads.length > 0) {
      this.emit("error", new Error("Unexpected end of input"));
    }

    this.destroy();
  }

  destroy() {
    if (!this._buffers) {
      return;
    }

    this.writable = false;
    this._reads = null;
    this._buffers = null;
    this._buffered = 0;
    this._paused = false;
    this._ending = false;

    this.emit("close");
  }

  _processReadAllowingLess(read) {
    // ok there is any data so that we can satisfy this request
    this._reads.shift(); // == read

    // first we need to peek into first buffer
    let smallerBuf = this._buffers[0];

    // ok there is more data than we need
    if (smallerBuf.length > read.length) {
      this._buffered -= read.length;
      this._buffers[0] = smallerBuf.subarray(read.length);

      read.func.call(this, smallerBuf.subarray(0, read.length));
    } else {
      // ok this is less than maximum length so use it all
      this._buffered -= smallerBuf.length;
      this._buffers.shift(); // == smallerBuf

      read.func.call(this, smallerBuf);
    }
  }

  _processRead(read) {
    this._reads.shift(); // == read

    let pos = 0;
    let count = 0;
    let data = Buffer.alloc(read.length);

    // create buffer for all data
    while (pos < read.length) {
      let buf = this._buffers[count++];
      let len = Math.min(buf.length, read.length - pos);

      buf.copy(data, pos, 0, len);
      pos += len;

      // last buffer wasn't used all so just slice it and leave
      if (len !== buf.length) {
        this._buffers[--count] = buf.subarray(len);
      }
    }

    // remove all used buffers
    if (count > 0) {
      this._buffers.splice(0, count);
    }

    this._buffered -= read.length;

    read.func.call(this, data);
  }

  _process() {
    try {
      // as long as there is any data and read requests
      while (this._buffered > 0 && this._reads && this._reads.length > 0) {
        let read = this._reads[0];

        // read any data (but no more than length)
        if (read.allowLess) {
          this._processReadAllowingLess(read);
        } else if (this._buffered >= read.length) {
          // ok we can meet some expectations

          this._processRead(read);
        } else {
          // not enought data to satisfy first request in queue
          // so we need to wait for more
          break;
        }
      }

      if (this._buffers && this._ending) {
        this._end();
      }
    } catch (ex) {
      this.emit("error", ex);
    }
  }
}

export default ChunkStream;
