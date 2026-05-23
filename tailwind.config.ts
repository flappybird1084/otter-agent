import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#0b0d10",
        panel: "#14171c",
        panel2: "#1b1f26",
        border: "#262b33",
        text: "#e6e8eb",
        muted: "#8a93a3",
        accent: "#7aa2f7",
      },
    },
  },
  plugins: [],
};

export default config;
