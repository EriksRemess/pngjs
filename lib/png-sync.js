import parse from "#lib/parser-sync";
import pack from "#lib/packer-sync";

export function read(buffer, options) {
  return parse(buffer, options || {});
}

export function write(png, options) {
  return pack(png, options);
}

export default { read, write };
