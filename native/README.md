# Native Addon

Rust `napi-rs` implementation of the project `PNG` API.

GitHub releases rebuild the supported platform-tagged binaries and assemble
them into the package before publishing. Release binaries are also checked in
to this folder.

## Options

The native writer uses a fast compression path for default RLE writes.
Pass `{ fastCompression: false }` to `PNG.sync.write` or the `PNG` constructor
to force the zlib-ng path for all image sizes.

## Build

```sh
npm run build:native
```

This produces the local addon binary at:

`native/pngjs-native-<platform>.node`

Current names used by the loader:

- `native/pngjs-native-linux-x64-gnu.node`
- `native/pngjs-native-darwin-arm64.node`
