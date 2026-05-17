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
          // brand-ring: soft focus-ring tint for light surfaces (lighter than 300).
          ring: '#f4c4cb',
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
        // surface.app = page bg; surface.2 = inset/zebra/table-header surface.
        surface: { app: '#fbfaf9', 2: '#f6f5f3' },
        // rule = hairline border; rule.2 = stronger row/section divider.
        rule: { DEFAULT: '#e6e4e0', 2: '#dcdad5' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04)',
        panel: '0 4px 12px rgba(0,0,0,0.06)',
        modal: '0 20px 40px rgba(0,0,0,0.12)',
        // Premium two-layer elevation scale (cooler tint than `card`).
        // Additive — existing card/panel/modal keys are untouched.
        // Use: soft = resting card, soft-md = hover/raised, soft-lg = modal/drawer/popover.
        soft: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        'soft-md': '0 4px 12px -2px rgba(16,24,40,0.08), 0 2px 6px -2px rgba(16,24,40,0.05)',
        'soft-lg': '0 12px 28px -6px rgba(16,24,40,0.12), 0 4px 10px -4px rgba(16,24,40,0.06)',
      },
      backgroundImage: {
        // Very low-contrast accent washes. Brand-neutral so dark mode is safe.
        'gradient-surface':
          'linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 100%)',
        'gradient-brand-faint':
          'linear-gradient(135deg, rgba(176,0,32,0.06) 0%, rgba(176,0,32,0) 60%)',
      },
      transitionTimingFunction: {
        // Premium ease-out for hovers/lifts. Additive.
        soft: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        // Opt-in skeleton shimmer; `animate-pulse` stays valid for existing callers.
        shimmer: 'shimmer 1.5s infinite',
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
