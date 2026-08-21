import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // CodeCompass palette: subtle slate-based UI with a single blue accent
        accent: {
          DEFAULT: '#2563eb',
          soft: '#dbeafe'
        }
      }
    }
  },
  plugins: [typography]
};