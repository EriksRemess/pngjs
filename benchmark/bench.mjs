import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { PNG as LocalPNG, PNGWasm as WasmPNG } from "../lib/png.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: node bench.mjs [--quick]

Compares upstream npm 'pngjs' (installed in benchmark/node_modules) against the
local implementation from this repo.
`);
  process.exit(0);
}

const quick = args.has("--quick");

const FIXTURES = [
  {
    name: "truecolor-small",
    file: path.join(rootDir, "test/png-parse-data/truecolor.png"),
    iterations: quick
      ? { syncRead: 150, syncWrite: 150, asyncParse: 80 }
      : { syncRead: 600, syncWrite: 600, asyncParse: 250 },
  },
  {
    name: "large",
    file: path.join(rootDir, "test/in/large.png"),
    iterations: quick
      ? { syncRead: 3, syncWrite: 3, asyncParse: 2 }
      : { syncRead: 10, syncWrite: 8, asyncParse: 5 },
  },
];

function resolvePngCtor(mod) {
  return mod?.PNG ?? mod?.default?.PNG ?? mod?.default;
}

async function loadOriginalPng() {
  try {
    const mod = await import("pngjs");
    const PNG = resolvePngCtor(mod);
    if (!PNG?.sync?.read || !PNG?.sync?.write) {
      throw new Error("Loaded module does not expose PNG.sync.read/write");
    }
    return PNG;
  } catch (err) {
    console.error(
      "Failed to load upstream 'pngjs' from benchmark/node_modules.",
    );
    console.error("Run: cd benchmark && npm install");
    console.error("");
    console.error(err?.stack || err);
    process.exit(1);
  }
}

function parseAsync(PNGCtor, buffer) {
  return new Promise((resolve, reject) => {
    new PNGCtor().parse(buffer, (err, png) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(png);
    });
  });
}

function formatMs(ms) {
  return `${ms.toFixed(3)} ms`;
}

async function timeOperation(fn, iterations, warmup = 1) {
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const durationMs = performance.now() - start;

  return {
    iterations,
    totalMs: durationMs,
    msPerOp: durationMs / iterations,
  };
}

function printHeader() {
  console.log("");
  console.log(
    [
      "Fixture".padEnd(16),
      "Operation".padEnd(12),
      "Impl".padEnd(10),
      "Time".padStart(14),
      "Delta".padStart(14),
      "Faster".padStart(10),
    ].join(" "),
  );
  console.log("-".repeat(70));
}

function printResultRow(fixture, op, impl, baseline, result) {
  const deltaPct =
    baseline == null
      ? null
      : ((result.msPerOp - baseline.msPerOp) / baseline.msPerOp) * 100;
  const faster =
    baseline == null
      ? "baseline"
      : result.msPerOp < baseline.msPerOp
        ? `${(baseline.msPerOp / result.msPerOp).toFixed(2)}x`
        : `${(result.msPerOp / baseline.msPerOp).toFixed(2)}x`;

  console.log(
    [
      fixture.padEnd(16),
      op.padEnd(12),
      impl.padEnd(10),
      formatMs(result.msPerOp).padStart(14),
      (deltaPct == null
        ? "baseline"
        : `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`
      ).padStart(14),
      faster.padStart(10),
    ].join(" "),
  );
}

function clonePngMeta(meta) {
  return {
    width: meta.width,
    height: meta.height,
    gamma: meta.gamma,
    data: meta.data,
  };
}

async function main() {
  const OriginalPNG = await loadOriginalPng();

  console.log(`Benchmark mode: ${quick ? "quick" : "full"}`);
  console.log("Upstream pngjs: benchmark/node_modules/pngjs");
  console.log("Local implementation: ../lib/png.js");
  console.log("Wasm implementation: ../wasm/png.js");

  printHeader();

  for (const fixture of FIXTURES) {
    const buffer = fs.readFileSync(fixture.file);

    const upstreamParsed = OriginalPNG.sync.read(buffer);
    const localParsed = LocalPNG.sync.read(buffer);
    const wasmParsed = WasmPNG.sync.read(buffer);

    // Basic sanity check to catch API shape mismatches before benchmarking.
    if (!upstreamParsed?.data || !localParsed?.data || !wasmParsed?.data) {
      throw new Error(`Invalid parse result for fixture ${fixture.name}`);
    }

    const upstreamRead = await timeOperation(
      () => OriginalPNG.sync.read(buffer),
      fixture.iterations.syncRead,
    );
    const localRead = await timeOperation(
      () => LocalPNG.sync.read(buffer),
      fixture.iterations.syncRead,
    );
    const wasmRead = await timeOperation(
      () => WasmPNG.sync.read(buffer),
      fixture.iterations.syncRead,
    );
    printResultRow(fixture.name, "sync.read", "upstream", null, upstreamRead);
    printResultRow(fixture.name, "sync.read", "local", upstreamRead, localRead);
    printResultRow(fixture.name, "sync.read", "wasm", upstreamRead, wasmRead);

    const upstreamWriteInput = clonePngMeta(upstreamParsed);
    const localWriteInput = clonePngMeta(localParsed);
    const wasmWriteInput = clonePngMeta(wasmParsed);

    const upstreamWrite = await timeOperation(
      () => OriginalPNG.sync.write(upstreamWriteInput),
      fixture.iterations.syncWrite,
    );
    const localWrite = await timeOperation(
      () => LocalPNG.sync.write(localWriteInput),
      fixture.iterations.syncWrite,
    );
    const wasmWrite = await timeOperation(
      () => WasmPNG.sync.write(wasmWriteInput),
      fixture.iterations.syncWrite,
    );
    printResultRow(fixture.name, "sync.write", "upstream", null, upstreamWrite);
    printResultRow(
      fixture.name,
      "sync.write",
      "local",
      upstreamWrite,
      localWrite,
    );
    printResultRow(
      fixture.name,
      "sync.write",
      "wasm",
      upstreamWrite,
      wasmWrite,
    );

    const upstreamAsync = await timeOperation(
      () => parseAsync(OriginalPNG, buffer),
      fixture.iterations.asyncParse,
    );
    const localAsync = await timeOperation(
      () => parseAsync(LocalPNG, buffer),
      fixture.iterations.asyncParse,
    );
    const wasmAsync = await timeOperation(
      () => parseAsync(WasmPNG, buffer),
      fixture.iterations.asyncParse,
    );
    printResultRow(
      fixture.name,
      "async.parse",
      "upstream",
      null,
      upstreamAsync,
    );
    printResultRow(
      fixture.name,
      "async.parse",
      "local",
      upstreamAsync,
      localAsync,
    );
    printResultRow(
      fixture.name,
      "async.parse",
      "wasm",
      upstreamAsync,
      wasmAsync,
    );
  }

  console.log("");
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
