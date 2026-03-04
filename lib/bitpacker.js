import constants from "#lib/constants";

const IS_BIG_ENDIAN = (() => {
  let buffer = new ArrayBuffer(2);
  new DataView(buffer).setInt16(0, 256, true /* littleEndian */);
  // Int16Array uses the platform's endianness.
  return new Int16Array(buffer)[0] !== 256;
})();

function writeUInt16BE(buffer, offset, value) {
  buffer[offset] = value >>> 8;
  buffer[offset + 1] = value & 0xff;
}

function clampRound(value, maxValue) {
  if (value <= 0) {
    return 0;
  }
  if (value >= maxValue) {
    return maxValue;
  }
  return Math.round(value);
}

function hasOnlyOpaqueAlpha8(data) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0xff) {
      return false;
    }
  }
  return true;
}

function copyRgbaToRgb8(data) {
  let outData = Buffer.allocUnsafe((data.length / 4) * 3);
  for (let inIndex = 0, outIndex = 0; inIndex < data.length; inIndex += 4) {
    outData[outIndex] = data[inIndex];
    outData[outIndex + 1] = data[inIndex + 1];
    outData[outIndex + 2] = data[inIndex + 2];
    outIndex += 3;
  }
  return outData;
}

export default function bitPacker(dataIn, width, height, options) {
  let bitDepth16 = options.bitDepth === 16;
  let inBpp = constants.COLORTYPE_TO_BPP_MAP[options.inputColorType];
  if (inBpp === 4 && !options.inputHasAlpha) {
    inBpp = 3;
  }
  let expectedLength = width * height * inBpp * (bitDepth16 ? 2 : 1);
  if (dataIn.length !== expectedLength) {
    throw new Error(
      "input data length mismatch: expected " +
        expectedLength +
        " bytes, got " +
        dataIn.length,
    );
  }

  let outHasAlpha =
    options.colorType === constants.COLORTYPE_COLOR_ALPHA ||
    options.colorType === constants.COLORTYPE_ALPHA;
  if (options.colorType === options.inputColorType) {
    // If no need to convert to grayscale and alpha is present/absent in both, take a fast route
    if (options.bitDepth === 8 || (options.bitDepth === 16 && IS_BIG_ENDIAN)) {
      return dataIn;
    }
  }

  // map to a UInt16 array if data is 16bit, fix endianness below
  let data;
  if (options.bitDepth !== 16) {
    data = dataIn;
  } else if ((dataIn.byteOffset & 1) === 0) {
    data = new Uint16Array(
      dataIn.buffer,
      dataIn.byteOffset,
      dataIn.byteLength >> 1,
    );
  } else {
    let aligned = Buffer.from(dataIn);
    data = new Uint16Array(
      aligned.buffer,
      aligned.byteOffset,
      aligned.byteLength >> 1,
    );
  }

  let maxValue = 255;
  let outBpp = constants.COLORTYPE_TO_BPP_MAP[options.colorType];
  if (bitDepth16) {
    maxValue = 65535;
    outBpp *= 2;
  }
  let outData = Buffer.allocUnsafe(width * height * outBpp);

  let inIndex = 0;
  let outIndex = 0;
  let pixelCount = width * height;
  let inputColorType = options.inputColorType;
  let outputColorType = options.colorType;
  let inputHasAlpha = options.inputHasAlpha;

  if (
    !bitDepth16 &&
    inputHasAlpha &&
    inputColorType === constants.COLORTYPE_COLOR_ALPHA &&
    outputColorType === constants.COLORTYPE_COLOR &&
    hasOnlyOpaqueAlpha8(dataIn)
  ) {
    return copyRgbaToRgb8(dataIn);
  }

  let bgColor = options.bgColor || {};
  let bgRed = bgColor.red === undefined ? maxValue : bgColor.red;
  let bgGreen = bgColor.green === undefined ? maxValue : bgColor.green;
  let bgBlue = bgColor.blue === undefined ? maxValue : bgColor.blue;

  for (let i = 0; i < pixelCount; i++) {
    let red;
    let green;
    let blue;
    let alpha = maxValue;

    switch (inputColorType) {
      case constants.COLORTYPE_COLOR_ALPHA:
        alpha = data[inIndex + 3];
        red = data[inIndex];
        green = data[inIndex + 1];
        blue = data[inIndex + 2];
        break;
      case constants.COLORTYPE_COLOR:
        red = data[inIndex];
        green = data[inIndex + 1];
        blue = data[inIndex + 2];
        break;
      case constants.COLORTYPE_ALPHA:
        alpha = data[inIndex + 1];
        red = data[inIndex];
        green = red;
        blue = red;
        break;
      case constants.COLORTYPE_GRAYSCALE:
        red = data[inIndex];
        green = red;
        blue = red;
        break;
      default:
        throw new Error(
          "input color type:" +
            options.inputColorType +
            " is not supported at present",
        );
    }

    if (inputHasAlpha) {
      if (!outHasAlpha) {
        let alphaRatio = alpha / maxValue;
        red = clampRound((1 - alphaRatio) * bgRed + alphaRatio * red, maxValue);
        green = clampRound(
          (1 - alphaRatio) * bgGreen + alphaRatio * green,
          maxValue,
        );
        blue = clampRound(
          (1 - alphaRatio) * bgBlue + alphaRatio * blue,
          maxValue,
        );
      }
    }

    switch (outputColorType) {
      case constants.COLORTYPE_COLOR_ALPHA:
      case constants.COLORTYPE_COLOR:
        if (!bitDepth16) {
          outData[outIndex] = red;
          outData[outIndex + 1] = green;
          outData[outIndex + 2] = blue;
          if (outHasAlpha) {
            outData[outIndex + 3] = alpha;
          }
        } else {
          writeUInt16BE(outData, outIndex, red);
          writeUInt16BE(outData, outIndex + 2, green);
          writeUInt16BE(outData, outIndex + 4, blue);
          if (outHasAlpha) {
            writeUInt16BE(outData, outIndex + 6, alpha);
          }
        }
        break;
      case constants.COLORTYPE_ALPHA:
      case constants.COLORTYPE_GRAYSCALE: {
        // Convert to grayscale and alpha
        let grayscale = (red + green + blue) / 3;
        if (!bitDepth16) {
          outData[outIndex] = grayscale;
          if (outHasAlpha) {
            outData[outIndex + 1] = alpha;
          }
        } else {
          writeUInt16BE(outData, outIndex, grayscale);
          if (outHasAlpha) {
            writeUInt16BE(outData, outIndex + 2, alpha);
          }
        }
        break;
      }
      default:
        throw new Error("unrecognised color Type " + options.colorType);
    }

    inIndex += inBpp;
    outIndex += outBpp;
  }

  return outData;
}
