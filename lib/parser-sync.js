import * as zlib from "node:zlib";
import SyncReader from "#lib/sync-reader";
import * as FilterSync from "#lib/filter-parse-sync";
import Parser from "#lib/parser";
import * as bitmapper from "#lib/bitmapper";
import formatNormaliser from "#lib/format-normaliser";
import { getInflatedImageSize } from "#lib/inflate-size";

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
  function handleInflateData(inflatedData) {
    inflateDataList.push(inflatedData);
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
  let inflateData = Buffer.concat(inflateDataList);
  inflateDataList.length = 0;

  let inflatedData;
  if (metaData.interlace) {
    inflatedData = zlib.inflateSync(inflateData);
  } else {
    let imageSize = getInflatedImageSize(metaData);
    inflatedData = zlib.inflateSync(inflateData, {
      chunkSize: Math.max(imageSize, zlib.Z_MIN_CHUNK),
    });
  }

  if (!inflatedData || !inflatedData.length) {
    throw new Error("bad png - invalid inflate data response");
  }

  let unfilteredData = FilterSync.process(inflatedData, metaData);

  let bitmapData = bitmapper.dataToBitMap(unfilteredData, metaData);

  let normalisedBitmapData = formatNormaliser(
    bitmapData,
    metaData,
    options.skipRescale,
  );

  metaData.data = normalisedBitmapData;
  metaData.gamma = gamma || 0;

  return metaData;
}
