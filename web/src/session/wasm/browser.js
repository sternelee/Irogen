import * as wasm from "./browser_bg.wasm";
export * from "./browser_bg.js";
import { __wbg_set_wasm } from "./browser_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
