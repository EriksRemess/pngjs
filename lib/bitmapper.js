import { getImagePasses, getInterlaceIterator } from "#lib/interlace";

function mapPixelBpp1(pxData, data, pxPos, rawPos) {
  if (rawPos === data.length) {
    throw new Error("Ran out of data");
  }

  let pixel = data[rawPos];
  pxData[pxPos] = pixel;
  pxData[pxPos + 1] = pixel;
  pxData[pxPos + 2] = pixel;
  pxData[pxPos + 3] = 0xff;
}

function mapPixelBpp2(pxData, data, pxPos, rawPos) {
  if (rawPos + 1 >= data.length) {
    throw new Error("Ran out of data");
  }

  let pixel = data[rawPos];
  pxData[pxPos] = pixel;
  pxData[pxPos + 1] = pixel;
  pxData[pxPos + 2] = pixel;
  pxData[pxPos + 3] = data[rawPos + 1];
}

function mapPixelBpp3(pxData, data, pxPos, rawPos) {
  if (rawPos + 2 >= data.length) {
    throw new Error("Ran out of data");
  }

  pxData[pxPos] = data[rawPos];
  pxData[pxPos + 1] = data[rawPos + 1];
  pxData[pxPos + 2] = data[rawPos + 2];
  pxData[pxPos + 3] = 0xff;
}

function mapPixelBpp4(pxData, data, pxPos, rawPos) {
  if (rawPos + 3 >= data.length) {
    throw new Error("Ran out of data");
  }

  pxData[pxPos] = data[rawPos];
  pxData[pxPos + 1] = data[rawPos + 1];
  pxData[pxPos + 2] = data[rawPos + 2];
  pxData[pxPos + 3] = data[rawPos + 3];
}

function mapCustomBpp1(pxData, pixelData, pxPos, maxBit) {
  let pixel = pixelData[0];
  pxData[pxPos] = pixel;
  pxData[pxPos + 1] = pixel;
  pxData[pxPos + 2] = pixel;
  pxData[pxPos + 3] = maxBit;
}

function mapCustomBpp2(pxData, pixelData, pxPos) {
  let pixel = pixelData[0];
  pxData[pxPos] = pixel;
  pxData[pxPos + 1] = pixel;
  pxData[pxPos + 2] = pixel;
  pxData[pxPos + 3] = pixelData[1];
}

function mapCustomBpp3(pxData, pixelData, pxPos, maxBit) {
  pxData[pxPos] = pixelData[0];
  pxData[pxPos + 1] = pixelData[1];
  pxData[pxPos + 2] = pixelData[2];
  pxData[pxPos + 3] = maxBit;
}

function mapCustomBpp4(pxData, pixelData, pxPos) {
  pxData[pxPos] = pixelData[0];
  pxData[pxPos + 1] = pixelData[1];
  pxData[pxPos + 2] = pixelData[2];
  pxData[pxPos + 3] = pixelData[3];
}

function bitRetriever(data, depth) {
  let leftOver = [];
  let leftOverStart = 0;
  let i = 0;
  let split;

  switch (depth) {
    default:
      throw new Error("unrecognised depth");
    case 16:
      split = function () {
        if (i + 1 >= data.length) {
          throw new Error("Ran out of data");
        }
        let byte1 = data[i];
        let byte2 = data[i + 1];
        i += 2;
        leftOver.push((byte1 << 8) + byte2);
      };
      break;
    case 4:
      split = function () {
        if (i === data.length) {
          throw new Error("Ran out of data");
        }
        let byte = data[i++];
        leftOver.push(byte >> 4, byte & 0x0f);
      };
      break;
    case 2:
      split = function () {
        if (i === data.length) {
          throw new Error("Ran out of data");
        }
        let byte = data[i++];
        leftOver.push(
          (byte >> 6) & 3,
          (byte >> 4) & 3,
          (byte >> 2) & 3,
          byte & 3,
        );
      };
      break;
    case 1:
      split = function () {
        if (i === data.length) {
          throw new Error("Ran out of data");
        }
        let byte = data[i++];
        leftOver.push(
          (byte >> 7) & 1,
          (byte >> 6) & 1,
          (byte >> 5) & 1,
          (byte >> 4) & 1,
          (byte >> 3) & 1,
          (byte >> 2) & 1,
          (byte >> 1) & 1,
          byte & 1,
        );
      };
      break;
  }

  return {
    get: function (count) {
      while (leftOver.length - leftOverStart < count) {
        split();
      }
      let end = leftOverStart + count;
      let returner = leftOver.slice(leftOverStart, end);
      leftOverStart = end;
      if (leftOverStart === leftOver.length) {
        leftOver.length = 0;
        leftOverStart = 0;
      }
      return returner;
    },
    resetAfterLine: function () {
      leftOver.length = 0;
      leftOverStart = 0;
    },
    end: function () {
      if (i !== data.length) {
        throw new Error("extra data found");
      }
    },
  };
}

function mapImage8Bit(image, pxData, getPxPos, bpp, data, rawPos) {
  switch (bpp) {
    case 1:
      return mapImage8BitBpp1(image, pxData, getPxPos, data, rawPos);
    case 2:
      return mapImage8BitBpp2(image, pxData, getPxPos, data, rawPos);
    case 3:
      return mapImage8BitBpp3(image, pxData, getPxPos, data, rawPos);
    case 4:
      return mapImage8BitBpp4(image, pxData, getPxPos, data, rawPos);
    default:
      throw new Error("Unsupported bpp");
  }
}

function mapImage8BitBpp1(image, pxData, getPxPos, data, rawPos) {
  let imageWidth = image.width;
  let imageHeight = image.height;
  let imagePass = image.index;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      let pxPos = getPxPos(x, y, imagePass);
      mapPixelBpp1(pxData, data, pxPos, rawPos);
      rawPos++;
    }
  }
  return rawPos;
}

function mapImage8BitBpp2(image, pxData, getPxPos, data, rawPos) {
  let imageWidth = image.width;
  let imageHeight = image.height;
  let imagePass = image.index;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      let pxPos = getPxPos(x, y, imagePass);
      mapPixelBpp2(pxData, data, pxPos, rawPos);
      rawPos += 2;
    }
  }
  return rawPos;
}

function mapImage8BitBpp3(image, pxData, getPxPos, data, rawPos) {
  let imageWidth = image.width;
  let imageHeight = image.height;
  let imagePass = image.index;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      let pxPos = getPxPos(x, y, imagePass);
      mapPixelBpp3(pxData, data, pxPos, rawPos);
      rawPos += 3;
    }
  }
  return rawPos;
}

function mapImage8BitBpp4(image, pxData, getPxPos, data, rawPos) {
  let imageWidth = image.width;
  let imageHeight = image.height;
  let imagePass = image.index;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      let pxPos = getPxPos(x, y, imagePass);
      mapPixelBpp4(pxData, data, pxPos, rawPos);
      rawPos += 4;
    }
  }
  return rawPos;
}

function mapImageCustomBit(image, pxData, getPxPos, bpp, bits, maxBit) {
  switch (bpp) {
    case 1:
      return mapImageCustomBitBpp1(image, pxData, getPxPos, bits, maxBit);
    case 2:
      return mapImageCustomBitBpp2(image, pxData, getPxPos, bits, maxBit);
    case 3:
      return mapImageCustomBitBpp3(image, pxData, getPxPos, bits, maxBit);
    case 4:
      return mapImageCustomBitBpp4(image, pxData, getPxPos, bits, maxBit);
    default:
      throw new Error("Unsupported bpp");
  }
}

function mapImageCustomBitBpp1(image, pxData, getPxPos, bits, maxBit) {
  let imageWidth = image.width;
  let imageHeight = image.height;
  let imagePass = image.index;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      let pixelData = bits.get(1);
      let pxPos = getPxPos(x, y, imagePass);
      mapCustomBpp1(pxData, pixelData, pxPos, maxBit);
    }
    bits.resetAfterLine();
  }
}

function mapImageCustomBitBpp2(image, pxData, getPxPos, bits, maxBit) {
  let imageWidth = image.width;
  let imageHeight = image.height;
  let imagePass = image.index;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      let pixelData = bits.get(2);
      let pxPos = getPxPos(x, y, imagePass);
      mapCustomBpp2(pxData, pixelData, pxPos, maxBit);
    }
    bits.resetAfterLine();
  }
}

function mapImageCustomBitBpp3(image, pxData, getPxPos, bits, maxBit) {
  let imageWidth = image.width;
  let imageHeight = image.height;
  let imagePass = image.index;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      let pixelData = bits.get(3);
      let pxPos = getPxPos(x, y, imagePass);
      mapCustomBpp3(pxData, pixelData, pxPos, maxBit);
    }
    bits.resetAfterLine();
  }
}

function mapImageCustomBitBpp4(image, pxData, getPxPos, bits, maxBit) {
  let imageWidth = image.width;
  let imageHeight = image.height;
  let imagePass = image.index;
  for (let y = 0; y < imageHeight; y++) {
    for (let x = 0; x < imageWidth; x++) {
      let pixelData = bits.get(4);
      let pxPos = getPxPos(x, y, imagePass);
      mapCustomBpp4(pxData, pixelData, pxPos, maxBit);
    }
    bits.resetAfterLine();
  }
}

function mapImage8BitLinear(pxData, bpp, data, rawPos, pixelCount) {
  let pxPos = 0;

  switch (bpp) {
    case 1:
      for (let i = 0; i < pixelCount; i++) {
        if (rawPos === data.length) {
          throw new Error("Ran out of data");
        }
        let pixel = data[rawPos++];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = 0xff;
        pxPos += 4;
      }
      return rawPos;
    case 2:
      for (let i = 0; i < pixelCount; i++) {
        if (rawPos + 1 >= data.length) {
          throw new Error("Ran out of data");
        }
        let pixel = data[rawPos];
        pxData[pxPos] = pixel;
        pxData[pxPos + 1] = pixel;
        pxData[pxPos + 2] = pixel;
        pxData[pxPos + 3] = data[rawPos + 1];
        rawPos += 2;
        pxPos += 4;
      }
      return rawPos;
    case 3:
      for (let i = 0; i < pixelCount; i++) {
        if (rawPos + 2 >= data.length) {
          throw new Error("Ran out of data");
        }
        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = 0xff;
        rawPos += 3;
        pxPos += 4;
      }
      return rawPos;
    case 4:
      for (let i = 0; i < pixelCount; i++) {
        if (rawPos + 3 >= data.length) {
          throw new Error("Ran out of data");
        }
        pxData[pxPos] = data[rawPos];
        pxData[pxPos + 1] = data[rawPos + 1];
        pxData[pxPos + 2] = data[rawPos + 2];
        pxData[pxPos + 3] = data[rawPos + 3];
        rawPos += 4;
        pxPos += 4;
      }
      return rawPos;
    default:
      throw new Error("Unsupported bpp");
  }
}

function mapImageCustomBitLinear(pxData, width, height, bpp, bits, maxBit) {
  let pxPos = 0;

  switch (bpp) {
    case 1:
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let pixelData = bits.get(1);
          let pixel = pixelData[0];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = maxBit;
          pxPos += 4;
        }
        bits.resetAfterLine();
      }
      return;
    case 2:
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let pixelData = bits.get(2);
          let pixel = pixelData[0];
          pxData[pxPos] = pixel;
          pxData[pxPos + 1] = pixel;
          pxData[pxPos + 2] = pixel;
          pxData[pxPos + 3] = pixelData[1];
          pxPos += 4;
        }
        bits.resetAfterLine();
      }
      return;
    case 3:
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let pixelData = bits.get(3);
          pxData[pxPos] = pixelData[0];
          pxData[pxPos + 1] = pixelData[1];
          pxData[pxPos + 2] = pixelData[2];
          pxData[pxPos + 3] = maxBit;
          pxPos += 4;
        }
        bits.resetAfterLine();
      }
      return;
    case 4:
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let pixelData = bits.get(4);
          pxData[pxPos] = pixelData[0];
          pxData[pxPos + 1] = pixelData[1];
          pxData[pxPos + 2] = pixelData[2];
          pxData[pxPos + 3] = pixelData[3];
          pxPos += 4;
        }
        bits.resetAfterLine();
      }
      return;
    default:
      throw new Error("Unsupported bpp");
  }
}

export function dataToBitMap(data, bitmapInfo) {
  let width = bitmapInfo.width;
  let height = bitmapInfo.height;
  let depth = bitmapInfo.depth;
  let bpp = bitmapInfo.bpp;
  let interlace = bitmapInfo.interlace;
  let bits;

  if (depth !== 8) {
    bits = bitRetriever(data, depth);
  }
  let pxData;
  if (depth <= 8) {
    pxData = Buffer.alloc(width * height * 4);
  } else {
    pxData = new Uint16Array(width * height * 4);
  }
  let maxBit = (1 << depth) - 1;
  let rawPos = 0;
  if (!interlace) {
    if (depth === 8) {
      rawPos = mapImage8BitLinear(pxData, bpp, data, rawPos, width * height);
    } else {
      mapImageCustomBitLinear(pxData, width, height, bpp, bits, maxBit);
    }
  } else {
    let images = getImagePasses(width, height);
    let getPxPos = getInterlaceIterator(width, height);

    for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
      if (depth === 8) {
        rawPos = mapImage8Bit(
          images[imageIndex],
          pxData,
          getPxPos,
          bpp,
          data,
          rawPos,
        );
      } else {
        mapImageCustomBit(
          images[imageIndex],
          pxData,
          getPxPos,
          bpp,
          bits,
          maxBit,
        );
      }
    }
  }
  if (depth === 8) {
    if (rawPos !== data.length) {
      throw new Error("extra data found");
    }
  } else {
    bits.end();
  }

  return pxData;
}
