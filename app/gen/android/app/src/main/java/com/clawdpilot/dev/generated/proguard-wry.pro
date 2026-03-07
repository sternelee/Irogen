# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.clawdpilot.dev.* {
  native <methods>;
}

-keep class com.clawdpilot.dev.WryActivity {
  public <init>(...);

  void setWebView(com.clawdpilot.dev.RustWebView);
  java.lang.Class getAppClass(...);
  java.lang.String getVersion();
}

-keep class com.clawdpilot.dev.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.clawdpilot.dev.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.clawdpilot.dev.RustWebChromeClient,com.clawdpilot.dev.RustWebViewClient {
  public <init>(...);
}
