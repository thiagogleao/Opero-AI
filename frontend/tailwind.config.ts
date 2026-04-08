import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:      '#0B0D0F',
        surface: '#111318',
        border:  '#1E2028',
        'border-light': '#2A2D38',
        accent:  '#8B5CF6',
        'accent-dim': '#6D28D9',
        emerald: '#10B981',
        rose:    '#F43F5E',
        amber:   '#F59E0B',
        sky:     '#38BDF8',
        'text-1': '#F4F4F5',
        'text-2': '#A1A1AA',
        'text-3': '#52525B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-up': 'fadeUp 0.5s ease forwards',
        'pulse-slow': 'pulse 3s infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
