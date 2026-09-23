import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

/** Pearl ocean navy — rgb channels for opacity modifiers (bg-primary/5, etc.) */
const primary = {
  DEFAULT: "rgb(var(--color-primary-500-rgb) / <alpha-value>)",
  50:  "rgb(var(--color-primary-50-rgb) / <alpha-value>)",
  100: "rgb(var(--color-primary-100-rgb) / <alpha-value>)",
  200: "rgb(var(--color-primary-200-rgb) / <alpha-value>)",
  300: "rgb(var(--color-primary-300-rgb) / <alpha-value>)",
  400: "rgb(var(--color-primary-400-rgb) / <alpha-value>)",
  500: "rgb(var(--color-primary-500-rgb) / <alpha-value>)",
  600: "rgb(var(--color-primary-600-rgb) / <alpha-value>)",
  700: "rgb(var(--color-primary-700-rgb) / <alpha-value>)",
  800: "rgb(var(--color-primary-800-rgb) / <alpha-value>)",
  900: "rgb(var(--color-primary-900-rgb) / <alpha-value>)",
  950: "rgb(6 26 48 / <alpha-value>)",
};

/** Premium gold/brass — rgb channels for opacity modifiers (bg-premium/10, etc.) */
const premium = {
  DEFAULT: "rgb(var(--color-premium-500-rgb) / <alpha-value>)",
  50:  "rgb(var(--color-premium-50-rgb) / <alpha-value>)",
  100: "rgb(var(--color-premium-100-rgb) / <alpha-value>)",
  200: "rgb(var(--color-premium-200-rgb) / <alpha-value>)",
  300: "rgb(var(--color-premium-300-rgb) / <alpha-value>)",
  400: "rgb(var(--color-premium-400-rgb) / <alpha-value>)",
  500: "rgb(var(--color-premium-500-rgb) / <alpha-value>)",
  600: "rgb(var(--color-premium-600-rgb) / <alpha-value>)",
  700: "rgb(var(--color-premium-700-rgb) / <alpha-value>)",
  800: "rgb(var(--color-premium-800-rgb) / <alpha-value>)",
  900: "rgb(var(--color-premium-900-rgb) / <alpha-value>)",
};

const royal = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [
    s,
    `rgb(var(--color-royal-${s}-rgb) / <alpha-value>)`,
  ])
) as Record<number, string>;
royal[950] = "rgb(28 24 51 / <alpha-value>)";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary,
        premium,
        /** Stray hues fold into the Pearl palette so legacy classes stay on-brand (and dark-aware). */
        teal: primary,
        blue: primary,
        sky: primary,
        cyan: primary,
        indigo: primary,
        royal,
        violet: royal,
        purple: royal,
        fuchsia: royal,
        gray: colors.slate,
        zinc: colors.slate,
        neutral: colors.slate,
        slate: {
          text:   "var(--color-text)",
          muted:  "var(--color-muted)",
          border: "var(--color-border)",
        },
        surface: {
          DEFAULT:  "var(--color-surface)",
          card:     "var(--color-surface-card)",
          elevated: "var(--color-surface-elevated)",
        },
        debt: {
          DEFAULT: "var(--color-debt-bg)",
          text:    "var(--color-debt-text)",
          border:  "var(--color-debt-border)",
        },
        success: {
          DEFAULT: "var(--color-success-bg)",
          text:    "var(--color-success-text)",
          border:  "var(--color-success-border)",
        },
        warning: {
          DEFAULT: "var(--color-warning-bg)",
          text:    "var(--color-warning-text)",
          border:  "var(--color-warning-border)",
        },
        /** emerald/green القديمة → ألوان النجاح الموحّدة */
        emerald: {
          50:  "var(--color-success-bg)",
          100: "var(--color-success-bg)",
          200: "var(--color-success-border)",
          300: "var(--color-success-border)",
          400: "var(--color-success-text)",
          500: "var(--color-success-text)",
          600: "var(--color-success-text)",
          700: "var(--color-success-text)",
          800: "var(--color-success-text)",
          900: "var(--color-success-text)",
        },
        green: {
          50:  "var(--color-success-bg)",
          100: "var(--color-success-bg)",
          200: "var(--color-success-border)",
          800: "var(--color-success-text)",
        },
        accent: {
          history: {
            DEFAULT: "var(--accent-history-bg)",
            text:    "var(--accent-history-text)",
            border:  "var(--accent-history-border)",
          },
          clinic: {
            DEFAULT: "var(--accent-clinic-bg)",
            text:    "var(--accent-clinic-text)",
            border:  "var(--accent-clinic-border)",
          },
          salary: {
            DEFAULT: "var(--accent-salary-bg)",
            text:    "var(--accent-salary-text)",
            border:  "var(--accent-salary-border)",
          },
          general: {
            DEFAULT: "var(--accent-general-bg)",
            text:    "var(--accent-general-text)",
            border:  "var(--accent-general-border)",
          },
        },
      },
      fontFamily: {
        arabic: ["var(--font-noto-arabic)", "Tahoma", "Arial", "sans-serif"],
      },
      borderRadius: {
        mc:    "var(--radius-lg)",
        "mc-sm": "var(--radius-sm)",
        "mc-md": "var(--radius-md)",
        "mc-lg": "var(--radius-xl)",
        "mc-xl": "var(--radius-2xl)",
        "mc-2xl": "var(--radius-3xl)",
      },
      boxShadow: {
        card:     "var(--shadow-card)",
        soft:     "var(--shadow-soft)",
        elevated: "var(--shadow-elevated)",
        premium:  "var(--shadow-premium)",
        glow:     "var(--shadow-glow)",
        glass:    "var(--shadow-glass)",
        gold:     "var(--shadow-gold)",
      },
      ringColor: {
        DEFAULT: "var(--color-ring)",
        strong:  "var(--color-ring-strong)",
      },
      backgroundImage: {
        "mc-navy": "var(--pearl-navy-gradient)",
        "mc-gold": "linear-gradient(135deg, var(--color-premium-300) 0%, var(--color-premium-400) 50%, var(--color-premium-500) 100%)",
        "mc-pearl": "var(--pearl-champagne-gradient)",
      },
      letterSpacing: {
        tightest2: "-0.03em",
      },
      transitionTimingFunction: {
        "mc-out": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
