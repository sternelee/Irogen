import { createSignal } from "solid-js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { EnhancedTerminalView } from "./EnhancedTerminalView";

/**
 * 测试组件 - 演示增强终端的WebGL/Canvas渲染和性能监控功能
 */
export function TestEnhancedTerminal() {
  const [terminal, setTerminal] = createSignal<Terminal | null>(null);
  const [fitAddon, setFitAddon] = createSignal<FitAddon | null>(null);
  const [isConnected, setIsConnected] = createSignal(false);
  const [keyboardVisible, setKeyboardVisible] = createSignal(false);

  const handleTerminalReady = (term: Terminal, fit: FitAddon) => {
    console.log("Enhanced Terminal Ready with WebGL/Canvas support!");
    setTerminal(term);
    setFitAddon(fit);
    setIsConnected(true);

    // 模拟终端输出以测试渲染性能
    setTimeout(() => {
      term.write("\r\n\x1b[32m[TEST]\x1b[0m WebGL/Canvas渲染器测试开始...\r\n");
      
      // 输出彩色文本测试渲染器
      for (let i = 0; i < 10; i++) {
        const colors = [31, 32, 33, 34, 35, 36]; // 红绿黄蓝紫青
        const color = colors[i % colors.length];
        term.write(`\x1b[${color}m行 ${i + 1}: 这是WebGL/Canvas渲染的彩色文本 🚀\x1b[0m\r\n`);
      }
      
      term.write("\r\n\x1b[36m提示：\x1b[0m\r\n");
      term.write("• 使用双指缩放调整字体大小\r\n");
      term.write("• 点击'操作'按钮查看渲染器选项\r\n");
      term.write("• 点击'性能'按钮查看实时性能统计\r\n");
      term.write("• 支持WebGL、Canvas和DOM三种渲染模式\r\n");
      term.write("\r\n\x1b[33m[READY]\x1b[0m 终端已就绪，可以开始输入命令\r\n");
      term.write("$ ");
    }, 1000);
  };

  const handleInput = (data: string) => {
    const term = terminal();
    if (!term) return;

    // 简单的命令处理演示
    if (data === '\r') {
      term.write('\r\n$ ');
    } else if (data === '\u0003') { // Ctrl+C
      term.write('^C\r\n$ ');
    } else if (data === '\u000c') { // Ctrl+L
      term.clear();
      term.write('$ ');
    } else {
      term.write(data);
    }
  };

  return (
    <div class="w-full h-screen bg-base-100">
      <div class="container mx-auto p-4 h-full">
        <div class="mb-4">
          <h1 class="text-2xl font-bold mb-2">增强终端测试</h1>
          <p class="text-sm opacity-70">
            这是一个演示WebGL/Canvas渲染和性能监控功能的测试终端
          </p>
        </div>
        
        <div class="border border-base-300 rounded-lg h-96 overflow-hidden">
          <EnhancedTerminalView
            onReady={handleTerminalReady}
            onInput={handleInput}
            isConnected={isConnected()}
            sessionTitle="测试会话"
            terminalType="zsh"
            workingDirectory="/home/user"
            keyboardVisible={keyboardVisible()}
            onKeyboardToggle={setKeyboardVisible}
            preferredRenderer="webgl" // 默认使用WebGL渲染器
            enablePerformanceMonitoring={true} // 启用性能监控
          />
        </div>

        <div class="mt-4 p-4 bg-base-200 rounded-lg">
          <h3 class="font-bold mb-2">功能说明：</h3>
          <ul class="text-sm space-y-1 list-disc list-inside">
            <li><strong>WebGL渲染：</strong> 在桌面设备上提供最佳性能</li>
            <li><strong>Canvas渲染：</strong> 移动设备优先选择，平衡性能与兼容性</li>
            <li><strong>DOM渲染：</strong> 通用回退选项，兼容所有设备</li>
            <li><strong>性能监控：</strong> 实时显示FPS、帧时间和渲染器状态</li>
            <li><strong>移动优化：</strong> 触摸手势、键盘适配和低功耗模式</li>
            <li><strong>自动回退：</strong> 渲染器失败时自动切换到兼容模式</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default TestEnhancedTerminal;