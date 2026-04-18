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
        },
      },
    },
  },
  plugins: [],
};
