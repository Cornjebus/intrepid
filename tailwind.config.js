/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'intrepid-green': '#5AC278',
        'intrepid-blue': '#5093A6',
        'intrepid-gray': '#CCCCCC',
        'intrepid-dark': '#1C1F21',
      },
      fontFamily: {
        'montserrat': ['Montserrat', 'sans-serif'],
        'open-sans': ['Open Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}