import paethPredictor from "#lib/paeth-predictor";

function filterNone(pxData, pxPos, byteWidth, rawData, rawPos) {
  for (let x = 0; x < byteWidth; x++) {
    rawData[rawPos + x] = pxData[pxPos + x];
  }
}

function filterSumNone(pxData, pxPos, byteWidth) {
  let sum = 0;
  let length = pxPos + byteWidth;

  for (let i = pxPos; i < length; i++) {
    sum += Math.abs(pxData[i]);
  }
  return sum;
}

function filterSub(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
  for (let x = 0; x < byteWidth; x++) {
    let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
    let val = pxData[pxPos + x] - left;

    rawData[rawPos + x] = val;
  }
}

function filterSumSub(pxData, pxPos, byteWidth, bpp) {
  let sum = 0;
  for (let x = 0; x < byteWidth; x++) {
    let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
    let val = pxData[pxPos + x] - left;

    sum += Math.abs(val);
  }

  return sum;
}

function filterUp(pxData, pxPos, byteWidth, rawData, rawPos) {
  if (pxPos === 0) {
    for (let x = 0; x < byteWidth; x++) {
      rawData[rawPos + x] = pxData[x];
    }
    return;
  }

  for (let x = 0; x < byteWidth; x++) {
    let up = pxData[pxPos + x - byteWidth];
    let val = pxData[pxPos + x] - up;

    rawData[rawPos + x] = val;
  }
}

function filterSumUp(pxData, pxPos, byteWidth) {
  let sum = 0;
  let length = pxPos + byteWidth;

  if (pxPos === 0) {
    for (let x = pxPos; x < length; x++) {
      sum += Math.abs(pxData[x]);
    }
    return sum;
  }

  for (let x = pxPos; x < length; x++) {
    let up = pxData[x - byteWidth];
    let val = pxData[x] - up;

    sum += Math.abs(val);
  }

  return sum;
}

function filterAvg(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
  if (pxPos === 0) {
    for (let x = 0; x < byteWidth; x++) {
      let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
      let val = pxData[pxPos + x] - (left >> 1);
      rawData[rawPos + x] = val;
    }
    return;
  }

  for (let x = 0; x < byteWidth; x++) {
    let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
    let up = pxData[pxPos + x - byteWidth];
    let val = pxData[pxPos + x] - ((left + up) >> 1);

    rawData[rawPos + x] = val;
  }
}

function filterSumAvg(pxData, pxPos, byteWidth, bpp) {
  let sum = 0;

  if (pxPos === 0) {
    for (let x = 0; x < byteWidth; x++) {
      let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
      let val = pxData[pxPos + x] - (left >> 1);
      sum += Math.abs(val);
    }
    return sum;
  }

  for (let x = 0; x < byteWidth; x++) {
    let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
    let up = pxData[pxPos + x - byteWidth];
    let val = pxData[pxPos + x] - ((left + up) >> 1);

    sum += Math.abs(val);
  }

  return sum;
}

function filterPaeth(pxData, pxPos, byteWidth, rawData, rawPos, bpp) {
  if (pxPos === 0) {
    for (let x = 0; x < byteWidth; x++) {
      let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
      let val = pxData[pxPos + x] - paethPredictor(left, 0, 0);
      rawData[rawPos + x] = val;
    }
    return;
  }

  for (let x = 0; x < byteWidth; x++) {
    let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
    let up = pxData[pxPos + x - byteWidth];
    let upleft = x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
    let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);

    rawData[rawPos + x] = val;
  }
}

function filterSumPaeth(pxData, pxPos, byteWidth, bpp) {
  let sum = 0;

  if (pxPos === 0) {
    for (let x = 0; x < byteWidth; x++) {
      let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
      let val = pxData[pxPos + x] - paethPredictor(left, 0, 0);
      sum += Math.abs(val);
    }
    return sum;
  }

  for (let x = 0; x < byteWidth; x++) {
    let left = x >= bpp ? pxData[pxPos + x - bpp] : 0;
    let up = pxData[pxPos + x - byteWidth];
    let upleft = x >= bpp ? pxData[pxPos + x - (byteWidth + bpp)] : 0;
    let val = pxData[pxPos + x] - paethPredictor(left, up, upleft);

    sum += Math.abs(val);
  }

  return sum;
}

const filters = [filterNone, filterSub, filterUp, filterAvg, filterPaeth];
const filterSums = [
  filterSumNone,
  filterSumSub,
  filterSumUp,
  filterSumAvg,
  filterSumPaeth,
];

function chooseBestFilter(filterTypes, pxData, pxPos, byteWidth, bpp) {
  let sel = filterTypes[0];
  let min = Infinity;

  for (let i = 0; i < filterTypes.length; i++) {
    let filterType = filterTypes[i];
    let sum = filterSums[filterType](pxData, pxPos, byteWidth, bpp);
    if (sum < min) {
      sel = filterType;
      min = sum;
    }
  }

  return sel;
}

export default function filterPack(pxData, width, height, options, bpp) {
  let filterTypes;
  if (!("filterType" in options) || options.filterType === -1) {
    filterTypes = [0, 1, 2, 3, 4];
  } else if (typeof options.filterType === "number") {
    filterTypes = [options.filterType];
  } else if (Array.isArray(options.filterType)) {
    filterTypes = options.filterType.slice();
  } else {
    throw new Error("unrecognised filter types");
  }

  if (options.bitDepth === 16) {
    bpp *= 2;
  }
  let byteWidth = width * bpp;
  let rawPos = 0;
  let pxPos = 0;
  let rawData = Buffer.allocUnsafe((byteWidth + 1) * height);

  let sel = filterTypes[0];
  let filterCount = filterTypes.length;
  if (options.fastFilter === true && filterCount > 1 && height > 0) {
    // Fast path: sample the first scanline once, then reuse that filter.
    sel = chooseBestFilter(filterTypes, pxData, 0, byteWidth, bpp);
    filterCount = 1;
  }

  for (let y = 0; y < height; y++) {
    if (filterCount > 1) {
      sel = chooseBestFilter(filterTypes, pxData, pxPos, byteWidth, bpp);
    }

    rawData[rawPos] = sel;
    rawPos++;
    filters[sel](pxData, pxPos, byteWidth, rawData, rawPos, bpp);
    rawPos += byteWidth;
    pxPos += byteWidth;
  }
  return rawData;
}
