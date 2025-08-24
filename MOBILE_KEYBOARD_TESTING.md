# 移动端键盘适配优化 - 测试指南

## 概述

本文档描述了针对移动端键盘适配问题的优化方案和测试方法。优化基于您提供的最佳实践，实现了智能的键盘检测、输入框自动滚动和固定定位元素适配。

## 主要优化内容

### 1. 增强的键盘检测 (`mobile.ts`)

**改进点：**
- 使用 `visualViewport` API 作为主要检测方式
- 支持多种检测阈值（移动端120px，桌面端150px）
- 完善的回退机制支持旧版浏览器
- 智能的输入框滚动逻辑

**关键功能：**
```typescript
// 自动输入框滚动到可视区域
activeInput.scrollIntoView({
  behavior: 'smooth',
  block: 'end',
  inline: 'nearest'
});

// 精确的键盘高度计算
const heightDiffFromInitial = this.initialVisualViewportHeight - currentViewportHeight;
const keyboardHeight = Math.max(heightDiffFromInitial, windowDiff, 0);
```

### 2. CSS 视口适配 (`index.css`)

**新增样式：**
- 键盘状态感知的CSS变量
- 增强的安全区域支持
- 智能输入框定位
- 固定定位元素适配

**关键CSS变量：**
```css
:root {
  --keyboard-height: 0px;
  --effective-viewport-height: 100vh;
  --dynamic-viewport-height: 100dvh;
}

.keyboard-visible {
  --effective-viewport-height: calc(var(--dynamic-viewport-height) - var(--keyboard-height));
}
```

### 3. 应用层优化 (`App.tsx`)

**简化改进：**
- 移除复杂的键盘检测逻辑
- 使用统一的mobile utilities
- 优化状态管理和性能

### 4. 终端组件优化 (`EnhancedTerminalView.tsx`)

**增强功能：**
- 集成键盘和输入焦点管理
- 固定定位元素支持
- 智能终端高度计算
- 移动端专用交互优化

## 测试方法

### 设备要求

**推荐测试设备：**
1. **iOS设备：** iPhone (Safari, Chrome)
2. **Android设备：** 各品牌手机 (Chrome, Firefox, Samsung Internet)
3. **平板设备：** iPad, Android平板

### 测试场景

#### 场景1: 基本键盘适配
1. 打开应用到主页面
2. 点击输入框（会话票据输入）
3. **预期结果：**
   - 键盘弹出时应用高度自动调整
   - 输入框自动滚动到键盘上方
   - 页面内容不被键盘遮挡
   - Debug信息显示正确的键盘状态

#### 场景2: 终端界面键盘适配
1. 连接到一个P2P会话
2. 进入终端界面
3. 点击终端区域（激活输入）
4. **预期结果：**
   - 终端高度根据键盘状态动态调整
   - 终端内容保持可见
   - 移动键盘按钮正确定位

#### 场景3: 移动端虚拟键盘
1. 在终端界面点击键盘图标
2. 使用虚拟键盘发送命令
3. **预期结果：**
   - 虚拟键盘出现时自动调整布局
   - 外部键盘弹出时虚拟键盘自动隐藏
   - 按键响应正常，有触觉反馈

#### 场景4: 旋转屏幕适配
1. 在不同界面旋转设备
2. 在横屏/竖屏间切换
3. **预期结果：**
   - 键盘检测在旋转后正常工作
   - 布局正确适应新的屏幕尺寸
   - 无异常滚动或布局错误

#### 场景5: 多输入框测试
1. 在设置界面或搜索功能中
2. 在多个输入框间切换
3. **预期结果：**
   - 每个输入框都能正确滚动到可视区域
   - 键盘状态跟踪准确
   - 无内存泄漏或事件监听器堆积

### 调试功能

**Debug信息面板：**
在开发环境中（localhost），页面顶部会显示调试信息：
```
Debug: Keyboard: Visible, Height: 336px, Viewport: 553px, Effective: 553px
```

**浏览器开发者工具：**
- 查看控制台中的键盘检测日志
- 检查CSS变量是否正确设置
- 验证事件监听器清理

### 性能验证

**内存管理：**
1. 长时间使用应用
2. 频繁切换输入框
3. 检查内存使用是否稳定

**响应速度：**
1. 键盘弹出到布局调整的延迟应 <200ms
2. 输入框滚动应平滑无卡顿
3. 终端尺寸调整应及时响应

## 常见问题排查

### 问题1: 键盘检测不准确
**可能原因：**
- 浏览器不支持`visualViewport` API
- 阈值设置不适合特定设备

**解决方案：**
- 检查`MobileKeyboard.init()`是否正确调用
- 调整`mobile.ts`中的检测阈值
- 验证浏览器兼容性

### 问题2: 输入框未自动滚动
**可能原因：**
- 输入框未注册到`InputFocusManager`
- `scrollIntoView`被其他样式覆盖

**解决方案：**
- 确认输入框有`data-focus-managed`属性
- 检查CSS中是否有冲突的`scroll-behavior`设置

### 问题3: 固定元素定位异常
**可能原因：**
- 元素未注册到`KeyboardManager`
- CSS类名缺失或错误

**解决方案：**
- 使用`KeyboardManager.registerFixedElement()`注册
- 添加`fixed-bottom`CSS类
- 确认cleanup函数正确调用

### 问题4: iOS Safari特殊问题
**常见症状：**
- 键盘弹出时页面跳动
- 视口高度计算错误

**解决方案：**
- 使用`-webkit-fill-available`
- 设置`viewport-fit=cover`
- 禁用缩放：`user-scalable=no`

## 兼容性说明

**支持的浏览器：**
- iOS Safari 13+
- Chrome Mobile 70+
- Firefox Mobile 68+
- Samsung Internet 10+
- Edge Mobile 79+

**API支持状况：**
- `visualViewport`: 现代浏览器完全支持
- `scrollIntoView`: 广泛支持
- CSS自定义属性: IE11+不支持（但应用主要面向移动端）

## 后续优化建议

1. **添加键盘动画预测：** 在键盘动画期间提前调整布局
2. **智能缓存机制：** 缓存不同设备的键盘高度
3. **手势优化：** 支持滑动调整键盘高度阈值
4. **无障碍支持：** 添加屏幕阅读器兼容性

## 测试清单

- [ ] iOS Safari 键盘适配
- [ ] Android Chrome 键盘适配  
- [ ] 输入框自动滚动
- [ ] 虚拟键盘功能
- [ ] 屏幕旋转适配
- [ ] 固定元素定位
- [ ] 性能和内存管理
- [ ] 调试信息准确性
- [ ] 多设备兼容性测试
- [ ] 边界情况处理

---

**注意：** 测试时建议在真实设备上进行，因为浏览器开发者工具的移动端模拟可能无法完全复现真实的键盘行为。