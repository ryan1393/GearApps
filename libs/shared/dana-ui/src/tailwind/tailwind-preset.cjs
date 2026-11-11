const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    ...defaultTheme,
    extend: {
      colors: {
        // Tailwind colour classes used in templates (text-slate-500, bg-red-50, ...) resolve to
        // the shared Dana tokens, so changing a token recolours them too.
        slate: {
          50: 'var(--dana-neutral-soft)',
          100: 'var(--dana-border)',
          200: 'var(--dana-border)',
          400: 'var(--dana-placeholder)',
          500: 'var(--dana-muted)',
          600: 'var(--dana-muted)',
          700: 'var(--dana-text)',
          900: 'var(--dana-primary-dark)',
        },
        gray: { 100: 'var(--dana-neutral-soft)' },
        red: {
          50: 'var(--dana-danger-soft)',
          200: 'color-mix(in srgb, var(--dana-danger) 30%, var(--dana-surface))',
          700: 'var(--dana-danger)',
          800: 'var(--dana-danger)',
        },
        blue: {
          50: 'var(--dana-info-soft)',
          200: 'color-mix(in srgb, var(--dana-info) 30%, var(--dana-surface))',
          700: 'var(--dana-info)',
          800: 'var(--dana-info)',
        },
        emerald: {
          50: 'var(--dana-success-soft)',
          200: 'color-mix(in srgb, var(--dana-success) 30%, var(--dana-surface))',
          600: 'var(--dana-success)',
          700: 'var(--dana-success)',
          800: 'var(--dana-success)',
        },
        amber: { 700: 'var(--dana-warning)' },
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
