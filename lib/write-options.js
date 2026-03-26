import constants from "#lib/constants";

function inferColorTypeFromMetadata(png) {
  if (typeof png.colorType === "number") {
    switch (png.colorType) {
      case constants.COLORTYPE_GRAYSCALE:
      case constants.COLORTYPE_COLOR:
      case constants.COLORTYPE_ALPHA:
      case constants.COLORTYPE_COLOR_ALPHA:
        return png.colorType;
      case constants.COLORTYPE_PALETTE_COLOR:
        return constants.COLORTYPE_COLOR;
      default:
        break;
    }
  }

  if (png.color === true) {
    return png.alpha === true
      ? constants.COLORTYPE_COLOR_ALPHA
      : constants.COLORTYPE_COLOR;
  }

  if (png.alpha === true) {
    return constants.COLORTYPE_ALPHA;
  }

  return constants.COLORTYPE_GRAYSCALE;
}

export function prepareWriteOptions(png, options = {}) {
  let prepared = { ...options };

  if (
    prepared.strip === true &&
    prepared.colorType == null &&
    png &&
    (typeof png.colorType === "number" ||
      typeof png.color === "boolean" ||
      typeof png.alpha === "boolean")
  ) {
    prepared.colorType = inferColorTypeFromMetadata(png);
  }

  return prepared;
}
