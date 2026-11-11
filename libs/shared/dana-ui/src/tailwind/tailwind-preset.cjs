const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    ...defaultTheme,
    extend: {
      colors: {
        gear: {
          950: '#16191f',
          900: '#161a1f',
          800: '#1e2229',
          700: '#ae520b',
          600: '#bf5d12',
          500: '#ad5410',
          page: '#f6f7f8',
          border: '#e1e3e7',
          text: '#1b1f25',
          muted: '#6b7381',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          ...defaultTheme.fontFamily.sans,
        ],
      },
      borderRadius: {
        gear: '12px',
      },
      boxShadow: {
        'gear-panel': '0 2px 7px rgba(37, 42, 51, .05)',
        'gear-raised': '0 12px 28px rgba(37, 42, 51, .10)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
