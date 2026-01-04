import toast, { ToastOptions } from 'solid-toast';

// Toast 配置选项
const defaultOptions: ToastOptions = {
  duration: 4000,
  position: 'top-right',
  style: {
    background: '#ef4444',
    color: 'white',
    padding: '12px 16px',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    borderLeft: '4px solid #dc2626',
    maxWidth: '400px',
    wordWrap: 'break-word',
  },
  iconTheme: {
    primary: '#ffffff',
    secondary: '#dc2626',
  },
};

export interface ToastMessage {
  title?: string;
  description?: string;
  type?: 'error' | 'success' | 'info' | 'warning';
}

// Toast 服务
export class ToastService {
  static showError(message: string, title?: string) {
    toast.error(title || '错误', {
      description: message,
      ...defaultOptions,
    });
  }

  static showSuccess(message: string, title?: string) {
    toast.success(title || '成功', {
      description: message,
      duration: 3000,
      style: {
        ...defaultOptions.style!,
        background: '#10b981',
        borderLeftColor: '#059669',
      },
      iconTheme: {
        primary: '#ffffff',
        secondary: '#059669',
      },
    });
  }

  static showInfo(message: string, title?: string) {
    toast.info(title || '信息', {
      description: message,
      duration: 3000,
      style: {
        ...defaultOptions.style!,
        background: '#3b82f6',
        borderLeftColor: '#2563eb',
      },
      iconTheme: {
        primary: '#ffffff',
        secondary: '#2563eb',
      },
    });
  }

  static showWarning(message: string, title?: string) {
    toast.warning(title || '警告', {
      description: message,
      duration: 5000,
      style: {
        ...defaultOptions.style!,
        background: '#f59e0b',
        borderLeftColor: '#d97706',
      },
      iconTheme: {
        primary: '#ffffff',
        secondary: '#d97706',
      },
    });
  }
}

// 快捷函数
export const showError = ToastService.showError;
export const showSuccess = ToastService.showSuccess;
export const showInfo = ToastService.showInfo;
export const showWarning = ToastService.showWarning;