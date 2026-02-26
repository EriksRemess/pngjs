import * as zlib from "node:zlib";
import constants from "#lib/constants";
import Packer from "#lib/packer";

export default function packSync(metaData, opt) {
  let options = opt ?? {};

  let packer = new Packer(options);

  let chunks = [];

  // Signature
  chunks.push(Buffer.from(constants.PNG_SIGNATURE));

  // Header
  chunks.push(packer.packIHDR(metaData.width, metaData.height));

  if (metaData.gamma) {
    chunks.push(packer.packGAMA(metaData.gamma));
  }

  let filteredData = packer.filterData(
    metaData.data,
    metaData.width,
    metaData.height,
  );

  // compress it
  let compressedData = zlib.deflateSync(
    filteredData,
    packer.getDeflateOptions(),
  );

  if (!compressedData || !compressedData.length) {
    throw new Error("bad png - invalid compressed data response");
  }
  chunks.push(packer.packIDAT(compressedData));

  // End
  chunks.push(packer.packIEND());

  return Buffer.concat(chunks);
}
