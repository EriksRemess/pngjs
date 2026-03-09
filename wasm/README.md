# Wasm Module

Rust-backed wasm implementation of the project `PNG` API.

## Build

```sh
cargo build --manifest-path wasm/Cargo.toml --target wasm32-unknown-unknown --release
```

The JS compatibility wrapper lives at `wasm/png.js` and loads the compiled binary from:

`wasm/png.wasm`
