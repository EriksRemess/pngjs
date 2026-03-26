import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getLinuxLibc() {
  if (process.platform !== "linux") {
    return null;
  }

  const report = process.report?.getReport?.();
  return report?.header?.glibcVersionRuntime ? "gnu" : "musl";
}

function getBinaryName() {
  if (process.platform === "linux" && process.arch === "x64") {
    return `pngjs-native-linux-x64-${getLinuxLibc()}.node`;
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "pngjs-native-darwin-arm64.node";
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return "pngjs-native-darwin-x64.node";
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return "pngjs-native-win32-x64-msvc.node";
  }

  throw new Error(
    `Unsupported native target for checked-in binary naming: ${process.platform}-${process.arch}`,
  );
}

const candidates = [
  path.join(__dirname, "target/release/pngjs_native.node"),
  path.join(__dirname, "target/release/libpngjs_native.so"),
  path.join(__dirname, "target/release/libpngjs_native.dylib"),
  path.join(__dirname, "target/release/pngjs_native.dll"),
];

const source = candidates.find((candidate) => fs.existsSync(candidate));

if (!source) {
  throw new Error(
    `Native build artifact not found. Checked:\n${candidates.join("\n")}`,
  );
}

fs.copyFileSync(source, path.join(__dirname, getBinaryName()));
