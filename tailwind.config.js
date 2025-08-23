/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'mono': ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Source Code Pro', 'Menlo', 'Consolas', 'DejaVu Sans Mono', 'monospace'],
        'sans': ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      backdropBlur: {
        'xs': '2px',
      },
      screens: {
        'xs': '475px',
      },
    },
  },
  plugins: [
    require("daisyui")
  ],
  daisyui: {
    themes: [
      "light",
      "dark", 
      "corporate",
      "business",
      "night",
      "forest",
      "dracula",
      "luxury",
      "synthwave",
      "terminal",
      {
        "riterm-mobile": {
          "primary": "#4F46E5",
          "primary-content": "#ffffff",
          "secondary": "#10B981",
          "secondary-content": "#ffffff",
          "accent": "#F59E0B",
          "accent-content": "#ffffff",
          "neutral": "#374151",
          "neutral-content": "#D1D5DB",
          "base-100": "#ffffff",
          "base-200": "#F8FAFC",
          "base-300": "#E2E8F0",
          "base-content": "#1E293B",
          "info": "#0EA5E9",
          "success": "#22C55E",
          "warning": "#F97316",
          "error": "#EF4444",
        },
        "riterm-dark": {
          "primary": "#6366F1",
          "primary-content": "#ffffff",
          "secondary": "#10B981",
          "secondary-content": "#ffffff",
          "accent": "#F59E0B",
          "accent-content": "#ffffff",
          "neutral": "#374151",
          "neutral-content": "#D1D5DB",
          "base-100": "#0F172A",
          "base-200": "#1E293B",
          "base-300": "#334155",
          "base-content": "#F1F5F9",
          "info": "#0EA5E9",
          "success": "#22C55E",
          "warning": "#F97316",
          "error": "#EF4444",
        },
        "riterm-terminal": {
          "primary": "#00FF00",
          "primary-content": "#000000",
          "secondary": "#00FFFF",
          "secondary-content": "#000000",
          "accent": "#FFFF00",
          "accent-content": "#000000",
          "neutral": "#333333",
          "neutral-content": "#00FF00",
          "base-100": "#000000",
          "base-200": "#111111",
          "base-300": "#222222",
          "base-content": "#00FF00",
          "info": "#00FFFF",
          "success": "#00FF00",
          "warning": "#FFFF00",
          "error": "#FF0000",
        }
      }
    ],
    darkTheme: "riterm-dark",
    base: true,
    styled: true,
    utils: true,
  },
}
