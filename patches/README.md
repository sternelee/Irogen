# Crate Patches

This directory contains patched versions of upstream crates to fix issues
that are not yet resolved in published versions.

## agent-client-protocol-schema

**Source:** crates.io `agent-client-protocol-schema` 0.12.0
**Patch:** `UsageUpdate.used` changed from `u64` to `Option<u64>`
**Reason:** The `claude-agent-acp` adapter (and potentially others) sends
`session/update` notifications with `used: null` for the `usage_update`
variant. The upstream schema requires `used: u64`, causing deserialization
to fail with:

```
invalid type: null, expected u64
```

This patch allows `null` values by using `Option<u64>`, which gracefully
handles adapters that report usage without a token count.

**Upstream issue:** To be reported to https://github.com/agentclientprotocol/agent-client-protocol
