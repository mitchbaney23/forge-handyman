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
        brand: {
          orange: "#BF5700",
          "orange-dark": "#8A3E00",
          "orange-light": "#E07420",
          ink: "#1E1E1E",
        },
        cream: "#F8F9FA",
        // "The Workshop" palette — warm kraft-paper direction.
        paper: { DEFAULT: "#EFE7D5", 2: "#E7DCC5" }, // page bg / deeper kraft
        card: "#FBF6EA", // raised surfaces
        ink: { DEFAULT: "#24211B", 2: "#433D32", 3: "#6B6353" }, // text: strong / mid / muted
        orange: { DEFAULT: "#BF5700", 2: "#D8650A" }, // logo-accurate primary + hover
        rust: "#9E3C0B", // hard-shadow / deep accent
        ember: "#E27A20", // warm highlight (icons on dark)
        teal: { DEFAULT: "#2E5D55", bg: "#E4ECE8" }, // positive accent + success bg
        red: { DEFAULT: "#B23B2E", bg: "#F6E5DF" }, // form error state
        line: { DEFAULT: "#CDBF9F", 2: "#DCD0B5" }, // hairlines / dashed seams
      },
      fontFamily: {
        sans: ["var(--font-franklin)", "system-ui", "sans-serif"],
        display: ["var(--font-zilla)", "Georgia", "serif"],
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
        // Hard offset shadows — no blur, like a printed sticker.
        card: "4px 4px 0 rgba(36,33,27,.10)",
        "card-hover": "8px 8px 0 rgba(191,87,0,.22)",
        ticket: "8px 8px 0 rgba(36,33,27,.14)",
        btn: "0 3px 0 #9E3C0B",
        "btn-ink": "0 3px 0 #000",
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(135deg, #1B3A5C 0%, #234B77 55%, #4A6FA5 100%)",
        "paper-dots":
          "radial-gradient(rgba(36,33,27,.035) 1px, transparent 1.3px)",
      },
    },
  },
  plugins: [],
};

export default config;
