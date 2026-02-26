export function getInflatedRowSize(bitmapInfo) {
  return ((bitmapInfo.width * bitmapInfo.bpp * bitmapInfo.depth + 7) >> 3) + 1;
}

export function getInflatedImageSize(bitmapInfo) {
  return getInflatedRowSize(bitmapInfo) * bitmapInfo.height;
}
