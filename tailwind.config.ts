import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#1B3A5C",
          50: "#E8EEF5",
          100: "#C5D3E2",
          600: "#234B77",
          700: "#1B3A5C",
          800: "#142C47",
          900: "#0D1E31",
        },
        steel: {
          DEFAULT: "#4A6FA5",
          50: "#EEF2F8",
          100: "#D5DFEE",
          500: "#5B80B5",
          600: "#4A6FA5",
          700: "#3C5A85",
        },
        amber: {
          forge: "#D97706",
          "forge-dark": "#B45309",
          "forge-light": "#F59E0B",
        },
        ink: "#1F2937",
        cream: "#F8F9FA",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      container: {
        center: true,
        padding: {
          DEFAULT: "1rem",
          sm: "1.5rem",
          lg: "2rem",
        },
        screens: {
          sm: "640px",
          md: "768px",
          lg: "1024px",
          xl: "1200px",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(27,58,92,0.06)",
        "card-hover":
          "0 1px 3px rgba(0,0,0,0.08), 0 10px 28px rgba(27,58,92,0.12)",
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(135deg, #1B3A5C 0%, #234B77 55%, #4A6FA5 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
