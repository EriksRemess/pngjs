import { dataToBitMap } from "#lib/bitmapper";
import filterParseSync from "#lib/filter-parse-sync";
import formatNormaliser from "#lib/format-normaliser";
import { getInflatedImageSize } from "#lib/inflate-size";
import Parser from "#lib/parser";
import SyncReader from "#lib/sync-reader";
import { inflateSync, constants as zlibconstants } from "node:zlib";

export default function parseSync(buffer, options) {
  let err;
  function handleError(_err_) {
    err = _err_;
  }

  let metaData;
  function handleMetaData(_metaData_) {
    metaData = _metaData_;
  }

  function handleTransColor(transColor) {
    metaData.transColor = transColor;
  }

  function handlePalette(palette) {
    metaData.palette = palette;
  }

  function handleSimpleTransparency() {
    metaData.alpha = true;
  }

  let gamma;
  function handleGamma(_gamma_) {
    gamma = _gamma_;
  }

  let inflateDataList = [];
  let inflateDataLength = 0;
  function handleInflateData(inflatedData) {
    inflateDataList.push(inflatedData);
    inflateDataLength += inflatedData.length;
  }

  let reader = new SyncReader(buffer);

  let parser = new Parser(options, {
    read: reader.read.bind(reader),
    error: handleError,
    metadata: handleMetaData,
    gamma: handleGamma,
    palette: handlePalette,
    transColor: handleTransColor,
    inflateData: handleInflateData,
    simpleTransparency: handleSimpleTransparency,
  });

  parser.start();
  reader.process();

  if (err) {
    throw err;
  }

  //join together the inflate datas
  let inflateData = Buffer.concat(inflateDataList, inflateDataLength);
  inflateDataList.length = 0;

  let inflatedData;
  if (metaData.interlace) {
    inflatedData = inflateSync(inflateData);
  } else {
    let imageSize = getInflatedImageSize(metaData);
    inflatedData = inflateSync(inflateData, {
      chunkSize: Math.max(imageSize, zlibconstants.Z_MIN_CHUNK),
    });
  }

  if (!inflatedData || !inflatedData.length) {
    throw new Error("bad png - invalid inflate data response");
  }

  let unfilteredData = filterParseSync(inflatedData, metaData);

  let bitmapData = dataToBitMap(unfilteredData, metaData);

  let normalisedBitmapData = formatNormaliser(
    bitmapData,
    metaData,
    options.skipRescale,
  );

  metaData.data = normalisedBitmapData;
  metaData.gamma = gamma || 0;

  return metaData;
}
