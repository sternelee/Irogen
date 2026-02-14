# Research Report: HAPI - Claude Code Agent Spawning Implementation
Generated: 2025-02-09

## Executive Summary

**HAPI** (tiann/hapi) is a local-first alternative to Happy that runs official Claude Code / Codex / Gemini / OpenCode sessions locally and controls them remotely through Web/PWA/Telegram. The project spawns AI agent processes using direct CLI commands (`claude`, `codex`, `gemini`) with stdio-based communication, not through SDK APIs.

**Key Findings:**
1. HAPI spawns agents as **subprocesses using Node.js `spawn()`**, not via SDK libraries
2. Uses **stdio pipes** for JSON-RPC communication with agents
3. Supports **local mode** (direct CLI invocation) and **remote mode** (via runner)
4. Agent spawning happens in `claudeLocal.ts` and through `spawnWithAbort()` utility
5. OpenCode/Codex/Gemini agents use **ACP (Agent Communication Protocol)** via stdio

## Research Question

How does the hapi project implement spawning of Claude Code and other AI agents?

## Key Findings

### Finding 1: Claude Code Spawning via CLI Command

**Location:** `/cli/src/claude/claudeLocal.ts`

HAPI spawns Claude Code by directly invoking the `claude` CLI command with Node.js `spawn()`:

```typescript
await spawnWithAbort({
    command: 'claude',
    args,
    cwd: opts.path,
    env: withBunRuntimeEnv(env, { allowBunBeBun: false }),
    signal: opts.abort,
    logLabel: 'ClaudeLocal',
    spawnName: 'claude',
    installHint: 'Claude CLI',
    includeCause: true,
    logExit: true,
    shell: process.platform === 'win32'
});
```

**Command-line arguments passed to Claude:**
- `--resume <session-id>` - Resume existing session
- `--append-system-prompt <prompt>` - Custom system prompt
- `--settings <path>` - Hook settings file for session tracking
- `--add-dir <path>` - Add directory for file upload access
- `--allowedTools <list>` - Restrict allowed tools
- MCP server configuration via `--mcp-config` or inline JSON

**Source:** [claudeLocal.ts](https://github.com/tiann/hapi/blob/master/cli/src/claude/claudeLocal.ts)

### Finding 2: Core Spawning Utility - spawnWithAbort

**Location:** `/cli/src/utils/spawnWithAbort.ts`

The `spawnWithAbort()` function is the core subprocess spawning utility with abort support:

```typescript
export async function spawnWithAbort(options: SpawnWithAbortOptions): Promise<void> {
    const stdio = options.stdio ?? ['inherit', 'inherit', 'inherit'];

    const child = spawn(options.command, options.args, {
        stdio,
        cwd: options.cwd,
        env: options.env,
        shell: options.shell
    });

    // Abort handling with process tree killing
    const abortHandler = () => {
        if (child.exitCode === null && !child.killed) {
            logDebug(`Abort signal received, killing process tree (pid=${child.pid}) with SIGTERM`);
            void killProcessByChildProcess(child, false);
        }
        // Force kill after timeout
        abortKillTimeout = setTimeout(() => {
            if (child.exitCode === null && !child.killed) {
                logDebug('Abort timeout reached, sending SIGKILL');
                void killProcessByChildProcess(child, true);
            }
        }, abortKillTimeoutMs);
    };

    options.signal.addEventListener('abort', abortHandler);
}
```

**Key features:**
- Uses Node.js `spawn()` from `child_process` module
- Handles graceful shutdown with SIGTERM, then SIGKILL after timeout
- Kills entire process tree (not just direct child) to prevent orphans
- Inherit stdio by default (for interactive CLI mode)
- Shell mode on Windows for compatibility

**Source:** [spawnWithAbort.ts](https://github.com/tiann/hapi/blob/master/cli/src/utils/spawnWithAbort.ts)

### Finding 3: ACP (Agent Communication Protocol) for OpenCode/Codex/Gemini

**Location:** `/cli/src/agent/backends/acp/`

HAPI uses a stdio-based JSON-RPC protocol called **ACP** for OpenCode, Codex, and Gemini agents:

```typescript
export class AcpStdioTransport {
    private readonly process: ChildProcessWithoutNullStreams;

    constructor(options: {
        command: string;
        args?: string[];
        env?: Record<string, string>;
    }) {
        this.process = spawn(options.command, options.args ?? [], {
            env: options.env,
            stdio: ['pipe', 'pipe', 'pipe'],  // Pipe all streams
            shell: process.platform === 'win32'
        });

        this.process.stdout.on('data', (chunk) => this.handleStdout(chunk));
        this.process.stderr.on('data', (chunk) => this.parseStderrError(chunk));
    }

    async sendRequest(method: string, params?: unknown): Promise<unknown> {
        const payload: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: this.nextId++,
            method,
            params
        };
        this.process.stdin.write(`${JSON.stringify(payload)}\\n`);
    }
}
```

**ACP Protocol flow:**
1. Spawn agent process with piped stdio
2. Send JSON-RPC requests via stdin
3. Parse JSON-RPC responses from stdout
4. Handle notifications and permission requests
5. Parse stderr for rate limit/auth errors

**Source:** [AcpStdioTransport.ts](https://github.com/tiann/hapi/blob/master/cli/src/agent/backends/acp/AcpStdioTransport.ts)

### Finding 4: Runner Mode - Detached Agent Spawning

**Location:** `/cli/src/runner/run.ts`

The runner spawns agents in detached mode for background operation:

```typescript
const args = [
    agentCommand,
    '--hapi-starting-mode', 'remote',
    '--started-by', 'runner'
];

happyProcess = spawnHappyCLI(args, {
    cwd: spawnDirectory,
    detached: true,  // Sessions stay alive when runner stops
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...extraEnv }
});
```

**Key runner features:**
- Detached processes (persist after runner exits)
- Tracks sessions by PID
- Webhook-based session registration
- Worktree support for isolated sessions
- Token-based auth injection via environment variables

**Source:** [run.ts](https://github.com/tiann/hapi/blob/master/cli/src/runner/run.ts)

### Finding 5: Cross-Platform CLI Spawning

**Location:** `/cli/src/utils/spawnHappyCLI.ts`

Handles spawning HAPI CLI itself in different runtime modes:

```typescript
export function getHappyCliCommand(args: string[]): HappyCliCommand {
    // Compiled binary mode
    if (isBunCompiled()) {
        return { command: process.execPath, args };
    }

    // Development mode - Bun runtime
    const isBunRuntime = Boolean(process.versions.bun);
    if (isBunRuntime) {
        return {
            command: process.execPath,
            args: [entrypoint, ...args]  // Run TypeScript directly
        };
    }

    // Node.js fallback
    return {
        command: process.execPath,
        args: [...process.execArgv, entrypoint, ...args]
    };
}
```

**Modes supported:**
- Compiled binary (production)
- Bun + TypeScript (development)
- Node.js + execArgv (fallback)

**Source:** [spawnHappyCLI.ts](https://github.com/tiann/hapi/blob/master/cli/src/utils/spawnHappyCLI.ts)

## Codebase Analysis

### Agent Spawning Architecture

```
User Request
    |
    v
runClaude() / runCodex() / runAgentSession()
    |
    v
Session (agent/session.ts)
    |
    v
claudeLocalLauncher() / claudeRemoteLauncher()
    |
    v
spawnWithAbort() / AcpStdioTransport
    |
    v
Node.js spawn() --> claude/codex/gemini/opencode CLI
```

### Key Files

| File | Purpose |
|------|---------|
| `cli/src/claude/claudeLocal.ts` | Spawn Claude Code CLI |
| `cli/src/codex/codexLocal.ts` | Spawn Codex CLI |
| `cli/src/utils/spawnWithAbort.ts` | Core subprocess spawning utility |
| `cli/src/agent/backends/acp/AcpStdioTransport.ts` | ACP stdio transport for agents |
| `cli/src/runner/run.ts` | Runner mode with detached spawning |
| `cli/src/utils/spawnHappyCLI.ts` | Cross-platform HAPI CLI spawning |

### Command-Line Flags Used

**Claude Code:**
- `--resume <id>` - Resume session
- `--append-system-prompt <text>` - Add system prompt
- `--settings <path>` - Settings file
- `--add-dir <path>` - Add directory
- `--allowedTools <list>` - Tool restrictions
- `--mcp-config <json>` - MCP servers

**HAPI-specific:**
- `--hapi-starting-mode <local|remote>` - Start mode
- `--started-by <runner|terminal>` - Spawn origin
- `--model <sonnet|opus>` - Model selection
- `--yolo` - Auto-approve permissions

## Sources

- [tiann/hapi GitHub Repository](https://github.com/tiann/hapi)
- [claudeLocal.ts - Claude spawning implementation](https://github.com/tiann/hapi/blob/master/cli/src/claude/claudeLocal.ts)
- [spawnWithAbort.ts - Core spawn utility](https://github.com/tiann/hapi/blob/master/cli/src/utils/spawnWithAbort.ts)
- [AcpStdioTransport.ts - ACP protocol implementation](https://github.com/tiann/hapi/blob/master/cli/src/agent/backends/acp/AcpStdioTransport.ts)
- [run.ts - Runner spawning](https://github.com/tiann/hapi/blob/master/cli/src/runner/run.ts)
- [spawnHappyCLI.ts - Cross-platform spawning](https://github.com/tiann/hapi/blob/master/cli/src/utils/spawnHappyCLI.ts)

## Recommendations

Based on HAPI's approach, here are recommendations for RiTerm's agent spawning:

1. **Use stdio-based communication** - More reliable than HTTP for local agent spawning
2. **Implement process tree killing** - Prevent orphan processes with proper cleanup
3. **Support detached mode** - Allow agents to outlive the parent process
4. **Use JSON-RPC over stdin/stdout** - Standard protocol for agent communication
5. **Handle platform differences** - Windows requires shell mode, Unix can spawn directly
6. **Implement abort signals** - Graceful shutdown with timeouts
7. **Track sessions by PID** - Simple and reliable for local process management

## Open Questions

1. How does HAPI handle session resume when the CLI process is killed?
   - Answer: Uses `--resume <session-id>` flag and hook-based session tracking

2. What happens when Claude Code is not installed on the system?
   - Answer: HAPI shows error with install hint: "Is Claude CLI installed and on PATH?"

3. How does HAPI handle multiple concurrent sessions?
   - Answer: Each spawn is independent; runner mode tracks by PID

4. Does HAPI use the Claude Agent SDK?
   - Answer: No, HAPI spawns the CLI directly and communicates via stdio/hooks

## Appendix: Example Spawn Commands

**Claude Code (local mode):**
```bash
claude --resume abc123 \
  --append-system-prompt "You are HAPI..." \
  --settings /tmp/hapi-hooks-123.json \
  --add-dir /tmp/hapi-blobs \
  --allowedTools "mcp__hapi__read_file,mcp__hapi__write_file"
```

**Codex (local mode):**
```bash
codex resume abc123 \
  --model gpt-4 \
  --sandbox read-only \
  --mcp-config '{"servers":{"hapi":{"command":"...","args":...}}}'
```

**HAPI Runner spawning:**
```bash
hapi claude --hapi-starting-mode remote --started-by runner --model sonnet
```

**OpenCode via ACP:**
```bash
opencode-cli --stdio  # Spawns with piped stdio for JSON-RPC
```
