import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--color-surface-raised) / <alpha-value>)',
        elevated: 'rgb(var(--color-surface-raised) / <alpha-value>)',
        subtle: 'rgb(var(--color-subtle) / <alpha-value>)',
        hover: 'rgb(var(--color-subtle) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          soft: 'rgb(var(--color-accent-soft) / <alpha-value>)'
        },
        success: 'rgb(var(--color-success) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        code: 'rgb(var(--color-code) / <alpha-value>)',
        callee: 'rgb(var(--color-callee) / <alpha-value>)'
      },
      boxShadow: {
        neon: 'var(--shadow-neon)'
      },
      // v0.30 票 02（D5 两档语义化）：全仓任意值字号收编——11px→text-xs(12px)、
      // 9/10px→text-micro。micro 行高按 1.35 紧凑（元数据行不撑高）；显式
      // leading-* 类仍覆盖此默认。禁止再引入 text-[Npx] 任意值（G8 终扫）。
      fontSize: {
        micro: ['10px', { lineHeight: '1.35' }]
      }
    }
  },
  plugins: [typography]
};
