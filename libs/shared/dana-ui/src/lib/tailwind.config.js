const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    ...defaultTheme,
    extend: {
      colors: {
        gear: {
          950: '#061a2f',
          900: '#071a30',
          800: '#08233d',
          700: '#0b5fc9',
          600: '#1676e8',
          500: '#2563eb',
          page: '#f4f7fb',
          border: '#dce4ee',
          text: '#0f1f36',
          muted: '#64748b',
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
        'gear-panel': '0 2px 7px rgba(20, 43, 69, .05)',
        'gear-raised': '0 12px 28px rgba(20, 43, 69, .10)',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
