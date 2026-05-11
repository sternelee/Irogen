/**
 * Code Jump Plugin for Vite
 *
 * Automatically detects available editors and provides installation guidance when commands are missing.
 *
 * Features:
 * - Auto-detects popular editors (Cursor, VS Code, Neovim, Vim, Sublime Text, JetBrains IDEs, etc.)
 * - Provides detailed installation instructions for each supported editor
 * - Validates user-specified editor configurations
 * - Falls back gracefully when editors are not found (default behavior)
 * - Shows helpful installation guides instead of silent failures
 * - Graceful degradation prevents development server startup failures
 *
 * Usage:
 * ```typescript
 * import { codeJumpPlugin } from './vite-plugins/code-jump-plugin'
 *
 * export default defineConfig({
 *   plugins: [
 *     codeJumpPlugin({
 *       editor: 'cursor',          // Required: specify editor manually
 *       showLogs: true,           // Optional: show detailed logs
 *       gracefulDegrade: true     // Optional: disable plugin if editor not found (default: true)
 *     })
 *   ]
 * })
 * ```
 */

import { spawn, execSync } from "child_process";
import path from "path";
import process from "process";
import type { Plugin } from "vite";

/**
 * ANSI color codes for colorful console output
 */
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  // Background colors
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
};

/**
 * Color utility functions for console logging
 */
const colorize = {
  error: (text: string) => `${colors.red}${text}${colors.reset}`,
  success: (text: string) => `${colors.green}${text}${colors.reset}`,
  warning: (text: string) => `${colors.yellow}${text}${colors.reset}`,
  info: (text: string) => `${colors.blue}${text}${colors.reset}`,
  highlight: (text: string) =>
    `${colors.cyan}${colors.bright}${text}${colors.reset}`,
  dim: (text: string) => `${colors.gray}${text}${colors.reset}`,
  bold: (text: string) => `${colors.bright}${text}${colors.reset}`,
  magenta: (text: string) => `${colors.magenta}${text}${colors.reset}`,
  step: (text: string) => `${colors.cyan}${text}${colors.reset}`,
};

/**
 * Lazy load open package if available
 */
async function getOpenPackage() {
  try {
    // @ts-ignore - open package might not be installed
    const { default: open } = await import("open");
    return open;
  } catch {
    return null;
  }
}

/**
 * Editor configuration interface
 */
interface EditorConfig {
  cmd: string;
  name: string;
  installGuide?: string[];
}

/**
 * Supported editors configuration
 */
const SUPPORTED_EDITORS: EditorConfig[] = [
  {
    cmd: "cursor",
    name: "Cursor",
    installGuide: [
      "Download and install Cursor from: https://cursor.sh",
      "The 'cursor' command will be automatically available in your PATH",
    ],
  },
  {
    cmd: "code",
    name: "VS Code",
    installGuide: [
      "1. Download and install VS Code from: https://code.visualstudio.com",
      "2. Open VS Code",
      "3. Press Cmd+Shift+P (macOS) / Ctrl+Shift+P (Windows/Linux)",
      "4. Type 'Shell Command: Install code command in PATH'",
      "5. Select and run the command",
    ],
  },
  {
    cmd: "code-insiders",
    name: "VS Code Insiders",
    installGuide: [
      "1. Download and install VS Code Insiders from: https://code.visualstudio.com/insiders",
      "2. Open VS Code Insiders",
      "3. Press Cmd+Shift+P (macOS) / Ctrl+Shift+P (Windows/Linux)",
      "4. Type 'Shell Command: Install code command in PATH'",
      "5. Select and run the command",
    ],
  },
  {
    cmd: "nvim",
    name: "Neovim",
    installGuide: [
      "Install Neovim using your package manager:",
      "• macOS: brew install neovim",
      "• Ubuntu/Debian: sudo apt install neovim",
      "• Windows: winget install Neovim.Neovim",
      "• Or download from: https://neovim.io",
    ],
  },
  {
    cmd: "lazyvim",
    name: "LazyVim",
    installGuide: [
      "1. First install Neovim (see above)",
      "2. Install LazyVim: https://lazyvim.github.io/installation",
      "3. Create an alias: alias lazyvim=nvim",
    ],
  },
  {
    cmd: "vim",
    name: "Vim",
    installGuide: [
      "Install Vim using your package manager:",
      "• macOS: brew install vim (usually pre-installed)",
      "• Ubuntu/Debian: sudo apt install vim",
      "• Windows: winget install vim.vim",
    ],
  },
  {
    cmd: "subl",
    name: "Sublime Text",
    installGuide: [
      "1. Download and install Sublime Text from: https://sublimetext.com",
      "2. Add the 'subl' command to your PATH:",
      "   • macOS: ln -s '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl' /usr/local/bin/subl",
      "   • Windows: Add Sublime Text installation directory to PATH",
      "   • Linux: Usually installed automatically",
    ],
  },
  {
    cmd: "atom",
    name: "Atom",
    installGuide: [
      "Note: Atom has been discontinued by GitHub as of December 2022",
      "Consider switching to VS Code, Cursor, or another modern editor",
    ],
  },
  {
    cmd: "emacs",
    name: "Emacs",
    installGuide: [
      "Install Emacs using your package manager:",
      "• macOS: brew install emacs",
      "• Ubuntu/Debian: sudo apt install emacs",
      "• Windows: Download from https://gnu.org/software/emacs",
    ],
  },
  {
    cmd: "webstorm",
    name: "WebStorm",
    installGuide: [
      "1. Download and install WebStorm from: https://jetbrains.com/webstorm",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
  {
    cmd: "idea",
    name: "IntelliJ IDEA",
    installGuide: [
      "1. Download and install IntelliJ IDEA from: https://jetbrains.com/idea",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
  {
    cmd: "rider",
    name: "JetBrains Rider",
    installGuide: [
      "1. Download and install Rider from: https://jetbrains.com/rider",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
  {
    cmd: "phpstorm",
    name: "PhpStorm",
    installGuide: [
      "1. Download and install PhpStorm from: https://jetbrains.com/phpstorm",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
  {
    cmd: "pycharm",
    name: "PyCharm",
    installGuide: [
      "1. Download and install PyCharm from: https://jetbrains.com/pycharm",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
  {
    cmd: "rubymine",
    name: "RubyMine",
    installGuide: [
      "1. Download and install RubyMine from: https://jetbrains.com/rubymine",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
  {
    cmd: "clion",
    name: "CLion",
    installGuide: [
      "1. Download and install CLion from: https://jetbrains.com/clion",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
  {
    cmd: "goland",
    name: "GoLand",
    installGuide: [
      "1. Download and install GoLand from: https://jetbrains.com/go",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
  {
    cmd: "datagrip",
    name: "DataGrip",
    installGuide: [
      "1. Download and install DataGrip from: https://jetbrains.com/datagrip",
      "2. Enable command-line launcher:",
      "   • Go to Tools → Create Command-line Launcher",
      "   • Or add JetBrains Toolbox and use it to manage command-line tools",
    ],
  },
];

/**
 * Plugin options interface
 */
interface CodeJumpPluginOptions {
  /** Editor command (required - must be manually specified) */
  editor:
    | "cursor" // Cursor
    | "code" // VS Code
    | "code-insiders" // VS Code Insiders
    | "nvim" // Neovim
    | "lazyvim" // LazyVim
    | "vim" // Vim
    | "subl" // Sublime Text
    | "atom" // Atom (已停止维护)
    | "emacs" // Emacs
    | "webstorm" // WebStorm
    | "idea" // IntelliJ IDEA
    | "rider" // JetBrains Rider
    | "phpstorm" // PhpStorm
    | "pycharm" // PyCharm
    | "rubymine" // RubyMine
    | "clion" // CLion
    | "goland" // GoLand
    | "datagrip"; // DataGrip
  /** Hotkey to enable code jumping (default: "F2") */
  hotkey?: string;
  /** Enable/disable the plugin (default: true) */
  enabled?: boolean;
  /** Show visual overlay when hovering (default: true) */
  showOverlay?: boolean;
  /** Show console logs for debugging (default: false) */
  showLogs?: boolean;
  /** Gracefully degrade when editor is not available (default: true) */
  gracefulDegrade?: boolean;
}

/**
 * Provide installation guidance for a specific editor
 */
function getEditorInstallGuide(editorCmd: string): void {
  const editor = SUPPORTED_EDITORS.find((e) => e.cmd === editorCmd);

  if (editor && editor.installGuide) {
    console.log(
      `❌ ${colorize.error(`Editor '${editorCmd}' not found.`)} ${colorize.warning(`To install ${editor.name}:`)}`,
    );
    editor.installGuide.forEach((step) => {
      console.log(`   ${colorize.step(step)}`);
    });
    console.log("");
    console.log(
      `📝 ${colorize.warning("After installation, restart your development server to use the new editor.")}`,
    );
  } else {
    console.log(
      `❌ ${colorize.error(`Editor command '${editorCmd}' not found.`)}`,
    );
    console.log(
      `💡 ${colorize.info("Make sure the editor is installed and the command is available in your PATH.")}`,
    );
    console.log(
      `🔍 ${colorize.dim("Supported editors:")} ${colorize.magenta("cursor, code, nvim, vim, subl, webstorm, idea, etc.")}`,
    );
  }
}

/**
 * Validate if an editor command is available
 */
function validateEditor(editorCmd: string): boolean {
  if (editorCmd === "fallback") {
    return true; // fallback is always valid
  }

  try {
    if (process.platform === "win32") {
      execSync(`where ${editorCmd}`, { stdio: "ignore" });
    } else {
      execSync(`which ${editorCmd}`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Vite plugin for code jumping functionality
 * Handles click events on elements with data-insp-path attribute to open files in manually specified editor
 */
export function codeJumpPlugin(options: CodeJumpPluginOptions): Plugin {
  // Validate that editor is provided
  if (!options.editor) {
    console.log(
      `❌ ${colorize.error("Editor must be manually specified!")} ${colorize.warning("Please provide an editor command in the plugin options.")}`,
    );
    console.log(
      `💡 ${colorize.info("Example usage:")} ${colorize.highlight('codeJumpPlugin({ editor: "cursor" })')}`,
    );
    console.log(`📚 ${colorize.info("Supported editors:")}`);
    SUPPORTED_EDITORS.forEach((editor) => {
      console.log(
        `   • ${colorize.highlight(editor.name)}: ${colorize.dim(editor.cmd)}`,
      );
    });
    throw new Error("Editor command is required for code jump plugin");
  }

  const { editor } = options;
  const {
    hotkey = "F2", // Hotkey to enable code jumping
    enabled = true, // Enable/disable the plugin
    showOverlay = true, // Show visual overlay when hovering
    showLogs = false, // Show console logs for debugging
    gracefulDegrade = true, // Gracefully degrade when editor is not available
  } = options;

  // Validate that the manually specified editor exists
  const isEditorAvailable = validateEditor(editor);

  if (!isEditorAvailable) {
    if (gracefulDegrade) {
      // Graceful degradation: warn but don't throw error
      console.log(
        `⚠️  ${colorize.warning(`Editor '${editor}' is not available on this system.`)}`,
      );
      console.log(
        `🔄 ${colorize.info("Code jump plugin will be disabled for this session.")}`,
      );

      if (showLogs) {
        console.log(
          `💡 ${colorize.dim("To fix this, install the editor or set gracefulDegrade: false to see installation guide.")}`,
        );
      }

      // Return a minimal plugin that does nothing
      return {
        name: "code-jump-plugin-disabled",
        apply: "serve",
      };
    } else {
      // Strict mode: show installation guide and throw error
      if (showLogs) {
        console.log(`⚠️  ${colorize.warning("Editor validation failed:")}`);
      }
      getEditorInstallGuide(editor);
      throw new Error(
        `Editor command '${editor}' is not available on this system`,
      );
    }
  } else {
    if (showLogs) {
      console.log(
        `✅ ${colorize.success("Using manually configured editor:")} ${colorize.highlight(editor)}`,
      );
    }
  }

  return {
    name: "code-jump-plugin",
    apply: "serve", // Only apply in development

    configureServer(server) {
      // Add middleware to handle code jump requests
      server.middlewares.use("/api/code-jump", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", async () => {
          try {
            const { filePath, line, column } = JSON.parse(body);
            await openInEditor(filePath, line, column, editor, showLogs);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
          } catch (error) {
            if (showLogs) {
              console.error("Code jump error:", error);
            }
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: (error as Error).message }));
          }
        });
      });

      // Add middleware to serve client script for SSR pages
      server.middlewares.use("/code-jump-client.js", (req, res, next) => {
        if (req.method !== "GET") {
          return next();
        }

        if (showLogs) {
          console.log("🔧 Serving code-jump client script");
        }

        res.writeHead(200, {
          "Content-Type": "application/javascript",
          "Cache-Control": "no-cache",
        });
        res.end(getClientScript(hotkey, showOverlay, enabled, showLogs));
      });
    },
  };
}

/**
 * Open file in editor with support for multiple editors
 */
async function openInEditor(
  filePath: string,
  line: number = 1,
  column: number = 1,
  editor: string = "code",
  showLogs: boolean = false,
): Promise<void> {
  const fullPath = path.resolve(process.cwd(), filePath);

  // Handle fallback case - use open package or system default
  if (editor === "fallback") {
    try {
      const open = await getOpenPackage();
      if (open) {
        if (showLogs) {
          console.log(
            `🔄 ${colorize.info("Using system default editor to open:")} ${colorize.highlight(path.basename(fullPath))}`,
          );
        }
        await open(fullPath);
        return;
      } else {
        if (showLogs) {
          console.log(
            `📦 ${colorize.warning("Install")} ${colorize.magenta("'open'")} ${colorize.warning("package for better fallback support:")} ${colorize.dim("npm install --save-dev open")}`,
          );
          console.log(
            `🔄 ${colorize.info("Attempting to use system open command for:")} ${colorize.highlight(path.basename(fullPath))}`,
          );
        }

        // Try platform-specific commands
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";

        const child = spawn(openCmd, [fullPath], {
          stdio: "ignore",
          detached: true,
          shell: process.platform === "win32",
        });
        child.unref();
        return;
      }
    } catch (error) {
      if (showLogs) {
        console.error("❌ Failed to open file with system default:", error);
      }
      return;
    }
  }

  try {
    let args: string[] = [];

    // Different editors have different command line formats
    switch (editor) {
      case "cursor":
        // Cursor: cursor -g file:line:column
        args = ["-g", `${fullPath}:${line}:${column}`];
        break;

      case "code":
      case "code-insiders":
        // VS Code: code --reuse-window --goto file:line:column
        args = ["--reuse-window", "--goto", `${fullPath}:${line}:${column}`];
        break;

      case "subl":
        // Sublime Text: subl file:line:column
        args = [`${fullPath}:${line}:${column}`];
        break;

      case "atom":
        // Atom: atom file:line:column
        args = [`${fullPath}:${line}:${column}`];
        break;

      case "vim":
        // Vim: vim +line file
        args = [`+${line}`, fullPath];
        break;

      case "nvim":
      case "lazyvim":
        // Neovim/LazyVim: nvim +line file
        // LazyVim users might have different configs, so we support multiple formats
        // Some users might create 'lazyvim' alias pointing to configured nvim
        // For better LazyVim experience, we can also pass column info via command
        if (editor === "lazyvim") {
          // If using lazyvim alias, try to be more specific
          args = [`+${line}`, `+normal ${column}|`, fullPath];
        } else {
          // Standard nvim approach
          args = [`+${line}`, fullPath];
        }
        break;

      case "emacs":
        // Emacs: emacs +line:column file
        args = [`+${line}:${column}`, fullPath];
        break;

      case "webstorm":
      case "idea":
      case "phpstorm":
      case "pycharm":
      case "rubymine":
      case "clion":
      case "goland":
      case "datagrip":
      case "rider":
        // JetBrains IDEs: idea --line line --column column file
        args = [
          "--line",
          line.toString(),
          "--column",
          column.toString(),
          fullPath,
        ];
        break;

      default:
        // Default format: try file:line:column first, then just file
        args = [`${fullPath}:${line}:${column}`];
        break;
    }

    if (showLogs) {
      console.log(
        `🚀 ${colorize.info("Opening file in")} ${colorize.highlight(editor)}: ${colorize.dim(args.join(" "))}`,
      );
    }

    const child = spawn(editor, args, {
      stdio: "ignore",
      detached: true,
    });

    child.unref();

    if (showLogs) {
      console.log(
        `✅ ${colorize.success("Successfully opened")} ${colorize.highlight(path.basename(fullPath))} ${colorize.info("at line")} ${colorize.bold(line.toString())}`,
      );
    }
  } catch (error) {
    if (showLogs) {
      console.error(
        `❌ ${colorize.error("Failed to open file in editor:")}`,
        error,
      );
    }

    // Check if the error indicates the command doesn't exist
    const errorString = String(error).toLowerCase();
    const isCommandNotFound =
      errorString.includes("enoent") ||
      errorString.includes("command not found") ||
      errorString.includes("not found") ||
      (errorString.includes("spawn") && errorString.includes("failed"));

    if (isCommandNotFound) {
      // Provide installation guidance for the specific editor
      getEditorInstallGuide(editor);
      return; // Don't try fallback if command is missing
    }

    // Fallback: try to open just the file without line/column
    try {
      const fallbackChild = spawn(editor, [fullPath], {
        stdio: "ignore",
        detached: true,
      });
      fallbackChild.unref();

      if (showLogs) {
        console.log(
          `🔄 ${colorize.warning("Fallback:")} ${colorize.info("opened file without line positioning")}`,
        );
      }
    } catch (fallbackError) {
      if (showLogs) {
        console.error(
          `❌ ${colorize.error("Fallback also failed:")}`,
          fallbackError,
        );
      }

      // Check again if it's a command not found error
      const fallbackErrorString = String(fallbackError).toLowerCase();
      const isFallbackCommandNotFound =
        fallbackErrorString.includes("enoent") ||
        fallbackErrorString.includes("command not found") ||
        fallbackErrorString.includes("not found") ||
        (fallbackErrorString.includes("spawn") &&
          fallbackErrorString.includes("failed"));

      if (isFallbackCommandNotFound) {
        getEditorInstallGuide(editor);
      }
    }
  }
}

/**
 * Get client-side script for handling click events
 */
function getClientScript(
  hotkey: string,
  showOverlay: boolean,
  enabled: boolean,
  showLogs: boolean,
): string {
  return `
    (function() {
      let isCodeJumpEnabled = false;
      let overlay = null;
      let currentTarget = null;

      // Create visual overlay
      function createOverlay() {
        if (!${showOverlay}) return null;

        const div = document.createElement('div');
        div.className = 'code-jump-overlay';
        div.style.cssText = \`
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(59, 130, 246, 0.1);
          border: 2px solid #3b82f6;
          pointer-events: none;
          z-index: 9999;
          opacity: 0;
          transition: opacity 0.2s ease;
          display: none;
        \`;

        const label = document.createElement('div');
        label.style.cssText = \`
          color: #e5e7eb;
          font-size: 14px;
          font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Consolas', monospace;
          white-space: nowrap;
          font-weight: 400;
          letter-spacing: 0.025em;
        \`;
        label.textContent = 'Click to jump to code';

        div.appendChild(label);
        document.body.appendChild(div);
        return div;
      }

      // Initialize overlay
      overlay = createOverlay();

      // Parse data-insp-path attribute
      function parseInspPath(path) {
        if (!path) return null;

        // Format: "src/components/AgentCard.tsx:92:11:h3"
        const match = path.match(/^(.+):(\\d+):(\\d+):/);
        if (!match) return null;

        return {
          filePath: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10)
        };
      }

      // Send jump request to server
      async function jumpToCode(filePath, line, column) {
        try {
          const response = await fetch('/api/code-jump', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ filePath, line, column })
          });

          if (response.ok) {
            if (${showLogs}) {
              console.log('✅ Code jump successful');
            }
          } else {
            if (${showLogs}) {
              console.error('❌ Code jump failed');
            }
          }
        } catch (error) {
          if (${showLogs}) {
            console.error('Code jump error:', error);
          }
        }
      }

      // Show overlay for element
      function showElementOverlay(element, mouseX, mouseY) {
        if (!overlay || !${showOverlay}) return;

        const rect = element.getBoundingClientRect();
        const label = overlay.querySelector('div');
        const inspPath = element.getAttribute('data-insp-path');

        if (label && inspPath) {
          // Display the raw data-insp-path value directly
          label.textContent = inspPath;
        }

        // Position tooltip to avoid covering the mouse cursor
        const tooltipHeight = 24; // Estimated height for auto-sized tooltip
        const margin = 10; // Comfortable margin

        let tooltipX = mouseX + margin;
        let tooltipY = mouseY - tooltipHeight - margin;

        // Adjust if tooltip would go off screen (using estimated max width)
        const estimatedWidth = 400; // Estimated width for positioning
        if (tooltipX + estimatedWidth > window.innerWidth) {
          tooltipX = mouseX - estimatedWidth - margin;
        }
        if (tooltipY < 0) {
          tooltipY = mouseY + margin;
        }

        overlay.style.position = 'fixed';
        overlay.style.top = tooltipY + 'px';
        overlay.style.left = tooltipX + 'px';
        overlay.style.height = '30px';
        overlay.style.lineHeight = '30px';
        overlay.style.background = 'linear-gradient(135deg, #1f2937 0%, #374151 100%)';
        overlay.style.border = '1px solid rgba(156, 163, 175, 0.3)';
        overlay.style.borderRadius = '4px';
        overlay.style.padding = '0 8px';
        overlay.style.whiteSpace = 'nowrap';
        overlay.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2), 0 1px 3px rgba(0, 0, 0, 0.1)';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.style.opacity = '1';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.zIndex = '9999';
        overlay.style.pointerEvents = 'none';

        // Calculate text width and set right position
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = '14px SF Mono, Monaco, Inconsolata, Roboto Mono, Consolas, monospace';
        const textWidth = context.measureText(label.textContent).width;
        const paddingWidth = 16; // 8px padding on each side
        overlay.style.right = (window.innerWidth - tooltipX - textWidth - 3 * paddingWidth) + 'px';

        // Add prominent outline to the hovered element
        element.style.outline = '3px solid #ff6b35';
        element.style.outlineOffset = '2px';
        element.style.boxShadow = '0 0 0 1px rgba(255, 107, 53, 0.3), 0 0 10px rgba(255, 107, 53, 0.4)';
      }

      // Hide overlay
      function hideOverlay(element) {
        if (!overlay) return;
        overlay.style.opacity = '0';
        setTimeout(() => {
          if (overlay) overlay.style.display = 'none';
        }, 200);

        // Remove outline from previously hovered element
        if (element) {
          element.style.outline = '';
          element.style.outlineOffset = '';
          element.style.boxShadow = '';
        }
      }

      // Handle keydown events
      document.addEventListener('keydown', (e) => {
        const targetKey = '${hotkey === "alt" ? "Alt" : hotkey}';

        // Allow Escape key to force exit code jump mode
        if (e.key === 'Escape' && isCodeJumpEnabled) {
          forceCleanup();
          return;
        }

        if (e.key === targetKey && !e.repeat) {
          // Activate code jump mode on keydown
          isCodeJumpEnabled = true;
          document.body.style.cursor = 'crosshair';
          if (${showLogs}) {
            console.log('🎯 Code jump mode activated');
          }

          // Add visual indication
          document.body.style.setProperty('--code-jump-enabled', '1');
          if (!document.getElementById('code-jump-styles')) {
            const styles = document.createElement('style');
            styles.id = 'code-jump-styles';
            styles.textContent = \`
              /* Visual overlay for entire page */
              body {
                position: relative !important;
              }

              body::before {
                content: "🎯 Code Jump Mode - Hover over elements to see code location. Press ${hotkey} to exit." !important;
                position: fixed !important;
                top: 10px !important;
                left: 50% !important;
                transform: translateX(-50%) !important;
                background: #3b82f6 !important;
                color: white !important;
                padding: 8px 16px !important;
                border-radius: 6px !important;
                font-size: 14px !important;
                font-family: system-ui, -apple-system, sans-serif !important;
                z-index: 10000 !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
                pointer-events: none !important;
                animation: codeJumpFadeIn 0.3s ease !important;
              }

              @keyframes codeJumpFadeIn {
                from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
                to { opacity: 1; transform: translateX(-50%) translateY(0); }
              }

              /* Disable pointer events on all interactive elements */
              button, a, input, select, textarea, [onclick], [role="button"] {
                pointer-events: none !important;
                opacity: 0.7 !important;
              }

              /* Re-enable pointer events only for inspectable elements */
              [data-insp-path] {
                pointer-events: auto !important;
                opacity: 1 !important;
              }
            \`;
            document.head.appendChild(styles);
          }
        }
      });

      // Handle keyup events (for all keys)
      document.addEventListener('keyup', (e) => {
        const targetKey = '${hotkey === "alt" ? "Alt" : hotkey}';

        if (e.key === targetKey) {
          // Deactivate mode on keyup
          isCodeJumpEnabled = false;

          // Clean up current target
          if (currentTarget) {
            currentTarget.style.outline = '';
            currentTarget.style.outlineOffset = '';
            currentTarget.style.boxShadow = '';
          }
          currentTarget = null;

          document.body.style.cursor = '';
          hideOverlay();

          // Force remove visual indication
          const styles = document.getElementById('code-jump-styles');
          if (styles) {
            styles.remove();
          }

          // Additional cleanup - remove any inline styles
          document.querySelectorAll('[data-insp-path]').forEach(el => {
            el.style.outline = '';
            el.style.outlineOffset = '';
            el.style.boxShadow = '';
          });

          // Reset body properties
          document.body.style.removeProperty('--code-jump-enabled');

          if (${showLogs}) {
            console.log('🎯 Code jump mode deactivated');
          }
        }
      });

      // Handle mouse events
      document.addEventListener('mouseover', (e) => {
        if (!isCodeJumpEnabled) return;

        const target = e.target.closest('[data-insp-path]');
        if (target && target !== currentTarget) {
          // Remove outline from previous target if exists
          if (currentTarget) {
            currentTarget.style.outline = '';
            currentTarget.style.outlineOffset = '';
            currentTarget.style.boxShadow = '';
          }

          currentTarget = target;
          showElementOverlay(target, e.clientX, e.clientY);
        }
      });

      document.addEventListener('mousemove', (e) => {
        if (!isCodeJumpEnabled || !currentTarget) return;

        // Update tooltip position when mouse moves
        showElementOverlay(currentTarget, e.clientX, e.clientY);
      });

      document.addEventListener('mouseout', (e) => {
        if (!isCodeJumpEnabled) return;

        const target = e.target.closest('[data-insp-path]');
        if (!target) {
          hideOverlay(currentTarget);
          currentTarget = null;
        }
      });

      // Handle click events - capture phase to prevent all interactions
      document.addEventListener('click', (e) => {
        if (!isCodeJumpEnabled) return;

        // Immediately prevent all default behaviors and stop propagation
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const target = e.target.closest('[data-insp-path]');
        if (!target) return;

        const inspPath = target.getAttribute('data-insp-path');
        const parsed = parseInspPath(inspPath);

        if (parsed) {
          jumpToCode(parsed.filePath, parsed.line, parsed.column);
          if (${showLogs}) {
            console.log('🚀 Jump to:', parsed.filePath + ':' + parsed.line);
          }
        }
      }, true); // Use capture phase to intercept before other handlers

      // Block all other mouse interactions when code jump is enabled
      ['mousedown', 'mouseup', 'dblclick', 'contextmenu'].forEach(eventType => {
        document.addEventListener(eventType, (e) => {
          if (!isCodeJumpEnabled) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, true);
      });

      // Block form interactions when code jump is enabled
      ['submit', 'input', 'change', 'focus', 'blur'].forEach(eventType => {
        document.addEventListener(eventType, (e) => {
          if (!isCodeJumpEnabled) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, true);
      });

      // Emergency cleanup function
      function forceCleanup() {
        isCodeJumpEnabled = false;

        // Clean up current target
        if (currentTarget) {
          currentTarget.style.outline = '';
          currentTarget.style.outlineOffset = '';
          currentTarget.style.boxShadow = '';
        }
        currentTarget = null;

        document.body.style.cursor = '';
        hideOverlay();

        // Remove styles
        const styles = document.getElementById('code-jump-styles');
        if (styles) styles.remove();

        // Clean inline styles
        document.querySelectorAll('[data-insp-path]').forEach(el => {
          el.style.outline = '';
          el.style.outlineOffset = '';
          el.style.boxShadow = '';
        });

        document.body.style.removeProperty('--code-jump-enabled');
      }

      // Backup cleanup triggers
      document.addEventListener('blur', forceCleanup);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && isCodeJumpEnabled) {
          forceCleanup();
        }
      });

      // Clean up on page unload
      window.addEventListener('beforeunload', () => {
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
        forceCleanup();
      });

      // Expose cleanup function globally for manual use
      window.clearCodeJumpStyles = forceCleanup;

      if (${showLogs}) {
        console.log('🔧 Code jump plugin loaded. Press "${hotkey}" to enable code jumping.');
      }
    })();
  `;
}
