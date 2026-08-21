import mermaid from 'mermaid';

let initialized = false;

/**
 * Renders a mermaid diagram string to an SVG document string.
 * Separated from the component so tests can mock this module and never depend
 * on real DOM measurement (jsdom cannot render mermaid SVG faithfully).
 */
export async function renderMermaid(uid: string, code: string): Promise<string> {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose'
    });
    initialized = true;
  }
  const { svg } = await mermaid.render(uid, code);
  return svg;
}