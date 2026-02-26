# Benchmark

Compares the npm-published `pngjs` package against the local implementation in this repo.

## Run

```sh
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
