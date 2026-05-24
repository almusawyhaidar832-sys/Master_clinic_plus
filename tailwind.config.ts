import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#14b8a6",
          50: "#f0fdfa",
          100: "#ccfbf1",
          200: "#99f6e4",
          300: "#5eead4",
          400: "#2dd4bf",
          500: "#14b8a6",
          600: "#0d9488",
          700: "#0f766e",
          800: "#115e59",
          900: "#134e4a",
        },
        slate: {
          text: "#0f172a",
          muted: "#64748b",
          border: "#e2e8f0",
        },
        surface: {
          DEFAULT: "#f8fafc",
          card: "#ffffff",
        },
        debt: {
          DEFAULT: "#fef2f2",
          text: "#b91c1c",
          border: "#fecaca",
        },
      },
      fontFamily: {
        arabic: ["var(--font-noto-arabic)", "Tahoma", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.06)",
        premium: "0 4px 24px -4px rgb(20 184 166 / 0.15)",
      },
    },
  },
  plugins: [],
};

export default config;
