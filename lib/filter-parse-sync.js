import Filter from "#lib/filter-parse";
import { getUnfilteredImageSize } from "#lib/inflate-size";
import SyncReader from "#lib/sync-reader";

export function process(inBuffer, bitmapInfo) {
  let outData = Buffer.allocUnsafe(getUnfilteredImageSize(bitmapInfo));
  let outPos = 0;
  let reader = new SyncReader(inBuffer);
  let read = reader.read.bind(reader);
  let filter = new Filter(bitmapInfo, {
    read,
    write: (bufferPart) => {
      bufferPart.copy(outData, outPos);
      outPos += bufferPart.length;
    },
    complete: () => {},
  });

  filter.start();
  reader.process();

  if (outPos !== outData.length) {
    throw new Error("bad png - invalid filtered data length");
  }

  return outData;
}

export default process;
