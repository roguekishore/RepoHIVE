/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Poppins'", 'sans-serif'],
        body: ["'Poppins'", 'sans-serif'],
        serif: ["'Source Serif 4'", 'serif'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
      },
    },
  },
  plugins: [],
};
