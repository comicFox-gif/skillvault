/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Orbitron", "Rajdhani", "sans-serif"],
        body: ["Rajdhani", "Orbitron", "sans-serif"],
      },
    },
  },
  plugins: [],
};
