import * as interlaceUtils from "#lib/interlace";
import paethPredictor from "#lib/paeth-predictor";

function getByteWidth(width, bpp, depth) {
  return (width * bpp * depth + 7) >> 3;
}

class Filter {
  constructor(bitmapInfo, dependencies) {
    let width = bitmapInfo.width;
    let height = bitmapInfo.height;
    let interlace = bitmapInfo.interlace;
    let bpp = bitmapInfo.bpp;
    let depth = bitmapInfo.depth;

    this.read = dependencies.read;
    this.write = dependencies.write;
    this.complete = dependencies.complete;
    this._lastLine = null;
    this._reverseFilterLineBound = this._reverseFilterLine.bind(this);

    this._imageIndex = 0;
    this._images = [];
    if (interlace) {
      let passes = interlaceUtils.getImagePasses(width, height);
      for (let i = 0; i < passes.length; i++) {
        this._images.push({
          byteWidth: getByteWidth(passes[i].width, bpp, depth),
          height: passes[i].height,
          lineIndex: 0,
        });
      }
    } else {
      this._images.push({
        byteWidth: getByteWidth(width, bpp, depth),
        height: height,
        lineIndex: 0,
      });
    }
    let maxByteWidth = 0;
    for (let i = 0; i < this._images.length; i++) {
      if (this._images[i].byteWidth > maxByteWidth) {
        maxByteWidth = this._images[i].byteWidth;
      }
    }
    this._lineA = Buffer.allocUnsafe(maxByteWidth);
    this._lineB = Buffer.allocUnsafe(maxByteWidth);
    this._nextLine = this._lineA;

    // when filtering the line we look at the pixel to the left
    // the spec also says it is done on a byte level regardless of the number of pixels
    // so if the depth is byte compatible (8 or 16) we subtract the bpp in order to compare back
    // a pixel rather than just a different byte part. However if we are sub byte, we ignore.
    if (depth === 8) {
      this._xComparison = bpp;
    } else if (depth === 16) {
      this._xComparison = bpp * 2;
    } else {
      this._xComparison = 1;
    }
  }

  start() {
    this.read(
      this._images[this._imageIndex].byteWidth + 1,
      this._reverseFilterLineBound,
    );
  }

  _acquireLine(byteWidth) {
    let line = this._nextLine.subarray(0, byteWidth);
    this._nextLine = this._nextLine === this._lineA ? this._lineB : this._lineA;
    return line;
  }

  _unFilterType1(rawData, unfilteredLine, byteWidth) {
    let xComparison = this._xComparison;
    let rawPos = 1;
    let x = 0;

    for (; x < xComparison && x < byteWidth; x++) {
      unfilteredLine[x] = rawData[rawPos + x];
    }

    for (; x < byteWidth; x++) {
      unfilteredLine[x] = rawData[rawPos + x] + unfilteredLine[x - xComparison];
    }
  }

  _unFilterType2(rawData, unfilteredLine, byteWidth) {
    let lastLine = this._lastLine;
    let rawPos = 1;

    if (!lastLine) {
      rawData.copy(unfilteredLine, 0, rawPos, rawPos + byteWidth);
      return;
    }

    for (let x = 0; x < byteWidth; x++) {
      unfilteredLine[x] = rawData[rawPos + x] + lastLine[x];
    }
  }

  _unFilterType3(rawData, unfilteredLine, byteWidth) {
    let xComparison = this._xComparison;
    let lastLine = this._lastLine;
    let rawPos = 1;
    let x = 0;

    if (!lastLine) {
      for (; x < xComparison && x < byteWidth; x++) {
        unfilteredLine[x] = rawData[rawPos + x];
      }

      for (; x < byteWidth; x++) {
        unfilteredLine[x] =
          rawData[rawPos + x] + (unfilteredLine[x - xComparison] >> 1);
      }
      return;
    }

    for (; x < xComparison && x < byteWidth; x++) {
      unfilteredLine[x] = rawData[rawPos + x] + (lastLine[x] >> 1);
    }

    for (; x < byteWidth; x++) {
      unfilteredLine[x] =
        rawData[rawPos + x] +
        ((unfilteredLine[x - xComparison] + lastLine[x]) >> 1);
    }
  }

  _unFilterType4(rawData, unfilteredLine, byteWidth) {
    let xComparison = this._xComparison;
    let lastLine = this._lastLine;
    let rawPos = 1;
    let x = 0;

    if (!lastLine) {
      for (; x < xComparison && x < byteWidth; x++) {
        unfilteredLine[x] = rawData[rawPos + x];
      }

      for (; x < byteWidth; x++) {
        unfilteredLine[x] =
          rawData[rawPos + x] +
          paethPredictor(unfilteredLine[x - xComparison], 0, 0);
      }
      return;
    }

    for (; x < xComparison && x < byteWidth; x++) {
      unfilteredLine[x] =
        rawData[rawPos + x] + paethPredictor(0, lastLine[x], 0);
    }

    for (; x < byteWidth; x++) {
      unfilteredLine[x] =
        rawData[rawPos + x] +
        paethPredictor(
          unfilteredLine[x - xComparison],
          lastLine[x],
          lastLine[x - xComparison],
        );
    }
  }

  _reverseFilterLine(rawData) {
    let filter = rawData[0];
    let currentImage = this._images[this._imageIndex];
    let byteWidth = currentImage.byteWidth;
    let unfilteredLine;

    if (filter === 0) {
      unfilteredLine = rawData.subarray(1, byteWidth + 1);
    } else {
      unfilteredLine = this._acquireLine(byteWidth);
      switch (filter) {
        case 1:
          this._unFilterType1(rawData, unfilteredLine, byteWidth);
          break;
        case 2:
          this._unFilterType2(rawData, unfilteredLine, byteWidth);
          break;
        case 3:
          this._unFilterType3(rawData, unfilteredLine, byteWidth);
          break;
        case 4:
          this._unFilterType4(rawData, unfilteredLine, byteWidth);
          break;
        default:
          throw new Error("Unrecognised filter type - " + filter);
      }
    }

    this.write(unfilteredLine);

    currentImage.lineIndex++;
    if (currentImage.lineIndex >= currentImage.height) {
      this._lastLine = null;
      this._imageIndex++;
      currentImage = this._images[this._imageIndex];
    } else {
      this._lastLine = unfilteredLine;
    }

    if (currentImage) {
      // read, using the byte width that may be from the new current image
      this.read(currentImage.byteWidth + 1, this._reverseFilterLineBound);
    } else {
      this._lastLine = null;
      this.complete();
    }
  }
}

export default Filter;
