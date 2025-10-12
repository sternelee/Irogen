# 创建终端功能增强

## 概述
为 RemoteSessionView 组件添加了创建终端时的交互式对话框，允许用户输入终端名称，并自动计算终端大小以适配当前页面宽度。

## 功能特性

### 1. 终端名称输入
- 用户可以在创建终端时输入自定义名称（可选）
- 支持回车键快速创建
- 名称为空时会使用默认名称

### 2. 自动计算终端大小
- 基于容器的实际宽度和高度计算终端列数和行数
- 假设字符宽度约 9px，高度约 14px
- 最小尺寸保护：24行 × 80列
- 实时显示预计的终端大小

### 3. 用户体验改进
- 美观的模态对话框
- 清晰的操作提示
- 支持 ESC 键关闭对话框
- 支持点击背景关闭对话框

## 代码变更

### 新增状态管理
```typescript
const [showCreateDialog, setShowCreateDialog] = createSignal(false);
const [terminalName, setTerminalName] = createSignal("");
let containerRef: HTMLDivElement | undefined;
```

### 新增函数
1. `calculateTerminalSize()` - 计算终端大小
2. `openCreateDialog()` - 打开创建对话框
3. `confirmCreateTerminal()` - 确认创建终端

### UI 组件
添加了一个模态对话框，包含：
- 终端名称输入框
- 终端大小预览
- 确认/取消按钮

## 使用方式

用户点击"新建终端"或"创建第一个终端"按钮时，会弹出对话框：
1. 输入终端名称（可选）
2. 查看预计的终端大小
3. 点击"创建"按钮或按回车键确认
4. 终端将使用输入的名称和自动计算的大小创建

## 技术细节

- 使用 SolidJS 的 `Show` 组件控制对话框显示
- 使用 `ref` 获取容器元素以计算尺寸
- 对话框样式使用 DaisyUI 的 modal 组件
- 支持键盘快捷键（Enter 确认，点击背景关闭）
