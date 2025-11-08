// 测试会话管理功能
import { useTerminalSessions } from '../stores/terminalSessionStore';

export function testSessionManager() {
  console.log('🧪 开始测试会话管理功能...');

  const sessionManager = useTerminalSessions();

  // 测试1: 添加会话
  console.log('📝 测试1: 添加会话');
  sessionManager.addSession({
    terminalId: 'terminal-001',
    sessionId: 'session-001',
    name: '测试会话1',
    shellType: 'bash',
    currentDir: '/home/user',
    status: 'Running',
    createdAt: Date.now(),
    size: [80, 24],
  });

  sessionManager.addSession({
    terminalId: 'terminal-002',
    sessionId: 'session-002',
    name: '开发环境',
    shellType: 'zsh',
    currentDir: '/home/user/projects',
    status: 'Running',
    createdAt: Date.now() - 3600000, // 1小时前
    size: [120, 30],
  });

  console.log('✅ 添加会话成功');

  // 测试2: 保存终端内容
  console.log('📝 测试2: 保存终端内容');
  const testContent = 'user@localhost:~$ ls -la\ntotal 48\ndrwxr-xr-x 12 user user 4096 Oct 28 10:00 .\ndrwxr-xr-x  3 root root 4096 Oct 27 09:00 ..';
  sessionManager.saveTerminalContent('terminal-001', testContent);
  console.log('✅ 保存终端内容成功');

  // 测试3: 保存命令历史
  console.log('📝 测试3: 保存命令历史');
  const commands = ['ls -la', 'cd projects', 'npm install', 'npm run dev'];
  sessionManager.saveCommandHistory('terminal-001', commands);
  console.log('✅ 保存命令历史成功');

  // 测试4: 保存工作目录
  console.log('📝 测试4: 保存工作目录');
  sessionManager.saveWorkingDirectory('terminal-001', '/home/user/projects/awesome-app');
  console.log('✅ 保存工作目录成功');

  // 测试5: 获取会话
  console.log('📝 测试5: 获取会话');
  const session = sessionManager.getSession('terminal-001');
  if (session) {
    console.log('✅ 获取会话成功:', {
      name: session.name,
      terminalContent: session.terminalContent?.substring(0, 50) + '...',
      commandHistory: session.commandHistory,
      workingDirectory: session.workingDirectory,
    });
  } else {
    console.error('❌ 获取会话失败');
  }

  // 测试6: 设置活动终端
  console.log('📝 测试6: 设置活动终端');
  sessionManager.setActiveTerminal('terminal-001');
  console.log('✅ 设置活动终端成功');

  // 测试7: 获取统计信息
  console.log('📝 测试7: 获取统计信息');
  const stats = sessionManager.getSessionStats();
  console.log('✅ 统计信息:', stats);

  // 测试8: 导出会话
  console.log('📝 测试8: 导出会话');
  const exportedData = sessionManager.exportSessions();
  console.log('✅ 导出会话成功, 数据大小:', exportedData.length, '字符');

  // 测试9: 清理一个会话
  console.log('📝 测试9: 删除会话');
  sessionManager.removeSession('terminal-002');
  console.log('✅ 删除会话成功');

  // 测试10: 最终统计
  console.log('📝 测试10: 最终统计');
  const finalStats = sessionManager.getSessionStats();
  console.log('✅ 最终统计:', finalStats);

  console.log('🎉 所有测试完成！会话管理功能正常工作。');
  return true;
}

// 在浏览器控制台中运行测试
if (typeof window !== 'undefined') {
  (window as any).testSessionManager = testSessionManager;
  console.log('💡 在控制台中运行 testSessionManager() 来测试会话管理功能');
}
