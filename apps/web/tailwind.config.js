/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './taskpane.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#b00020',
          hover: '#8f001a',
          subtle: '#fff1f2',
          50: '#fff5f5',
          100: '#fff1f2',
          // brand-300: outline / focus-ring hover tint (audit U-13).
          // Previously hand-mixed as brand/40 at call sites.
          300: '#e89aa4',
          500: '#b00020',
          600: '#8f001a',
          700: '#7a0017',
          900: '#3d000b',
        },
        success: { 50: '#ecfdf5', 500: '#10b981', 700: '#047857' },
        warning: { 50: '#fffbeb', 500: '#f59e0b', 700: '#b45309' },
        danger: { 50: '#fef2f2', 500: '#ef4444', 700: '#b91c1c' },
        info: { 50: '#eff6ff', 500: '#3b82f6', 700: '#1d4ed8' },
        // Warm neutral scale for premium surfaces (auth shell, cards).
        // Additive: pairs with Tailwind's gray-* for dark mode; nothing
        // existing is renamed. Sourced from the SES design package.
        ink: { DEFAULT: '#16181d', 2: '#3a3f48', 3: '#6b7280' },
        surface: { app: '#fbfaf9' },
        rule: { DEFAULT: '#e6e4e0' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04)',
        panel: '0 4px 12px rgba(0,0,0,0.06)',
        modal: '0 20px 40px rgba(0,0,0,0.12)',
      },
      // 4-step radius scale (audit U-13 / Design Package · D).
      // Additive: Tailwind's built-in rounded/-lg/-xl keys are preserved,
      // so no existing class breaks. New surfaces should pick one of these:
      // input = md, card = lg, modal/drawer = xl.
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
    },
  },
  plugins: [],
};
