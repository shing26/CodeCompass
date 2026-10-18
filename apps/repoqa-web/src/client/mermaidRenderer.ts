import mermaid from 'mermaid';

export type MermaidTheme = 'clean' | 'cyber';

/** Theme-aware mermaid variables, sourced from the design tokens in index.css. */
const THEME_VARIABLES: Record<MermaidTheme, Record<string, string>> = {
  clean: {
    background: '#f8fafc',
    primaryColor: '#2563eb',
    primaryTextColor: '#0f172a',
    primaryBorderColor: '#e2e8f0',
    lineColor: '#94a3b8',
    fontFamily: 'system-ui'
  },
  cyber: {
    background: '#0b1728',
    primaryColor: '#22d3ee',
    primaryTextColor: '#e2e8f0',
    primaryBorderColor: '#2d3a60',
    lineColor: '#64748b',
    fontFamily: 'system-ui'
  }
};

let initializedTheme: MermaidTheme | null = null;

/**
 * Renders a mermaid diagram string to an SVG document string.
 * Separated from the component so tests can mock this module and never depend
 * on real DOM measurement (jsdom cannot render mermaid SVG faithfully).
 */
export async function renderMermaid(
  uid: string,
  code: string,
  theme: MermaidTheme = 'clean'
): Promise<string> {
  // Re-initialize on theme switch so the rendered canvas follows the app
  // theme (RISK-3); the theme key, not a bool, drives the re-entry.
  if (initializedTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      // v1.4.1 评审 P1 — 仓库内容可以进入标签（路由名就是源码里的字符串
      // 字面量），loose 会跳过 mermaid 的全部净化，再经 innerHTML 落地即
      // 存储型 XSS。点击导航是本组件的 DOM 事件代理，不依赖 mermaid 的
      // click 回调，因此切 strict 不掉任何功能。
      securityLevel: 'strict',
      themeVariables: THEME_VARIABLES[theme]
    });
    initializedTheme = theme;
  }
  const { svg } = await mermaid.render(uid, code);
  return svg;
}
