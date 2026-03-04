import { getImagePasses } from "#lib/interlace";

export function getInflatedRowSize(bitmapInfo) {
  return ((bitmapInfo.width * bitmapInfo.bpp * bitmapInfo.depth + 7) >> 3) + 1;
}

export function getInflatedImageSize(bitmapInfo) {
  return getInflatedRowSize(bitmapInfo) * bitmapInfo.height;
}

export function getUnfilteredImageSize(bitmapInfo) {
  const byteWidth = (width) =>
    (width * bitmapInfo.bpp * bitmapInfo.depth + 7) >> 3;

  if (!bitmapInfo.interlace) {
    return byteWidth(bitmapInfo.width) * bitmapInfo.height;
  }

  let size = 0;
  let images = getImagePasses(bitmapInfo.width, bitmapInfo.height);
  for (let i = 0; i < images.length; i++) {
    size += byteWidth(images[i].width) * images[i].height;
  }
  return size;
}
