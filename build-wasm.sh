#!/bin/bash

# Build the browser WASM package
echo "Building riterm browser WASM package..."

cd browser

# Build with wasm-pack
wasm-pack build --target web --out-dir pkg --out-name riterm_browser

echo "WASM build complete. Output in browser/pkg/"

