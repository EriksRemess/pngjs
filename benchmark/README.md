# Benchmark

Compares three implementations:

- the npm-published `pngjs`
- the local JS implementation in this repo
- the Rust wasm implementation in `../wasm`

## Run

```sh
cd ..
npm run build:wasm
cd benchmark
npm install
npm run bench
```

Quick mode:

```sh
npm run bench:quick
```

## What it measures

- `PNG.sync.read`
- `PNG.sync.write`
- `new PNG().parse(buffer, cb)` (async parse)

Benchmarks run on:

- `test/png-parse-data/truecolor.png`
- `test/in/large.png`
