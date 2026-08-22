import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from './download';

describe('downloadTextFile (issue 14)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a temporary anchor with the target file name and clicks it', () => {
    let captured: Blob | undefined;
    const createObjectURL = vi.fn((blob: Blob) => {
      captured = blob;
      return 'blob:mock-download';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL,
      revokeObjectURL
    });

    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked = this;
    });

    downloadTextFile('shop-ONBOARDING.md', '# hello\n');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(captured).toBeDefined();
    expect(captured?.type).toBe('text/markdown;charset=utf-8');
    expect(captured?.size).toBe('# hello\n'.length);

    expect(clicked).toBeDefined();
    expect(clicked?.download).toBe('shop-ONBOARDING.md');
    expect(clicked?.href).toContain('blob:mock-download');
    // The anchor is removed from the DOM right after the click.
    expect(clicked?.parentNode).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-download');
  });
});