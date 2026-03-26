# Native Addon

Rust `napi-rs` implementation of the project `PNG` API.

The intended distribution model for GitHub installs is checked-in,
platform-tagged binaries in this folder.

## Build

```sh
npm run build:native
```

This produces the local addon binary at:

`native/pngjs-native-<platform>.node`

Current names used by the loader:

- `native/pngjs-native-linux-x64-gnu.node`
- `native/pngjs-native-linux-x64-musl.node`
- `native/pngjs-native-darwin-arm64.node`
- `native/pngjs-native-darwin-x64.node`
- `native/pngjs-native-win32-x64-msvc.node`
