/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Ink scale used inside the preview overlay (SelectionLayer, etc.).
        // The rest of the app reads --ag-* tokens directly via CSS modules.
        ink: {
          50: '#f7f7f8',
          100: '#eeeef0',
          200: '#d8d8de',
          300: '#a9a9b3',
          400: '#6f6f7a',
          500: '#4a4a55',
          600: '#2e2e36',
          700: '#1f1f25',
          800: '#15151a',
          900: '#0d0d12',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
