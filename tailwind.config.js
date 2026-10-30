/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        rojo: '#D7263D',
        oro: '#F4C20D',
        azul: '#1B4F9C',
        verde: '#2E8B57',
        crema: '#FFF4D6',
        tinta: '#1A1A1A',
        frijol: '#5B2A1B',
      },
      fontFamily: {
        display: ['"Alfa Slab One"', 'Georgia', 'serif'],
        verse: ['Lora', 'Georgia', 'serif'],
      },
      borderWidth: { 3: '3px', 6: '6px' },
      boxShadow: {
        print: '4px 4px 0 0 #1A1A1A',
        'print-lg': '8px 8px 0 0 #1A1A1A',
      },
    },
  },
  plugins: [],
};
