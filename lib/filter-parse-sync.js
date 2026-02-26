import SyncReader from "#lib/sync-reader";
import Filter from "#lib/filter-parse";

export function process(inBuffer, bitmapInfo) {
  let outBuffers = [];
  let reader = new SyncReader(inBuffer);
  let read = reader.read.bind(reader);
  let filter = new Filter(bitmapInfo, {
    read,
    write: (bufferPart) => {
      outBuffers.push(bufferPart);
    },
    complete: () => {},
  });

  filter.start();
  reader.process();

  return Buffer.concat(outBuffers);
}
