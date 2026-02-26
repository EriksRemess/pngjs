function dePalette(indata, outdata, width, height, palette) {
  let pxPos = 0;
  // use values from palette
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = palette[indata[pxPos]];

      if (!color) {
        throw new Error("index " + indata[pxPos] + " not in palette");
      }

      for (let i = 0; i < 4; i++) {
        outdata[pxPos + i] = color[i];
      }
      pxPos += 4;
    }
  }
}

function replaceTransparentColorGray(
  indata,
  outdata,
  width,
  height,
  transColor,
) {
  let transparent = transColor[0];
  let pxPos = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (transparent === indata[pxPos]) {
        outdata[pxPos] = 0;
        outdata[pxPos + 1] = 0;
        outdata[pxPos + 2] = 0;
        outdata[pxPos + 3] = 0;
      }
      pxPos += 4;
    }
  }
}

function replaceTransparentColorRgb(
  indata,
  outdata,
  width,
  height,
  transColor,
) {
  let trans0 = transColor[0];
  let trans1 = transColor[1];
  let trans2 = transColor[2];
  let pxPos = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        trans0 === indata[pxPos] &&
        trans1 === indata[pxPos + 1] &&
        trans2 === indata[pxPos + 2]
      ) {
        outdata[pxPos] = 0;
        outdata[pxPos + 1] = 0;
        outdata[pxPos + 2] = 0;
        outdata[pxPos + 3] = 0;
      }
      pxPos += 4;
    }
  }
}

function scaleDepth(indata, outdata, width, height, depth) {
  let maxOutSample = 255;
  let maxInSample = Math.pow(2, depth) - 1;
  let pxPos = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let i = 0; i < 4; i++) {
        outdata[pxPos + i] = Math.floor(
          (indata[pxPos + i] * maxOutSample) / maxInSample + 0.5,
        );
      }
      pxPos += 4;
    }
  }
}

export default function formatNormaliser(
  indata,
  imageData,
  skipRescale = false,
) {
  let depth = imageData.depth;
  let width = imageData.width;
  let height = imageData.height;
  let colorType = imageData.colorType;
  let transColor = imageData.transColor;
  let palette = imageData.palette;

  let outdata = indata; // only different for 16 bits

  if (colorType === 3) {
    // paletted
    dePalette(indata, outdata, width, height, palette);
  } else {
    if (transColor) {
      if (transColor.length === 1) {
        replaceTransparentColorGray(indata, outdata, width, height, transColor);
      } else {
        replaceTransparentColorRgb(indata, outdata, width, height, transColor);
      }
    }
    // if it needs scaling
    if (depth !== 8 && !skipRescale) {
      // if we need to change the buffer size
      if (depth === 16) {
        outdata = Buffer.alloc(width * height * 4);
      }
      scaleDepth(indata, outdata, width, height, depth);
    }
  }
  return outdata;
}
