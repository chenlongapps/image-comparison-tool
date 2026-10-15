import { describe, expect, it } from 'vitest';

import { getMediaDisplayStyles, isSvgFile } from '@/lib/media-display';

describe('SVG file detection', () => {
  it.each([
    { name: 'image', type: 'image/svg+xml' },
    { name: 'image', type: 'image/svg+xml;charset=utf-8' },
    { name: 'image', type: 'IMAGE/SVG+XML' },
    { name: 'image.svg', type: '' },
    { name: 'image.SVG', type: 'application/octet-stream' }
  ])('recognizes SVG metadata: $name ($type)', (file) => {
    expect(isSvgFile(file)).toBe(true);
  });

  it.each([
    { name: 'image.png', type: 'image/png' },
    { name: 'image.svg.png', type: 'image/png' },
    { name: 'image.svgz', type: 'application/gzip' },
    { name: 'video.mp4', type: 'video/mp4' }
  ])('does not classify other media as SVG: $name', (file) => {
    expect(isSvgFile(file)).toBe(false);
  });
});

describe('media display styles', () => {
  const media = { width: 800, height: 600, baseScale: 0.5, isSvg: true };
  const initialView = { scale: 1, offsetX: 0, offsetY: 0 };

  it('fits SVG using its rendered dimensions instead of a scale transform', () => {
    const styles = getMediaDisplayStyles(media, initialView);

    expect(styles.image).toEqual({ width: 400, height: 300, flexShrink: 0 });
    expect(styles.container).toEqual({ transform: 'translate(0px, 0px)' });
  });

  it.each([0.1, 1.25, 10])('redraws SVG at the requested zoom: %s', (scale) => {
    const styles = getMediaDisplayStyles(media, { ...initialView, scale });

    expect(styles.image?.width).toBe(400 * scale);
    expect(styles.image?.height).toBe(300 * scale);
    expect(styles.image?.flexShrink).toBe(0);
    expect(styles.container.transform).not.toContain('scale');
    expect(styles.container.willChange).toBeUndefined();
  });

  it('preserves fractional SVG dimensions without rounding', () => {
    const styles = getMediaDisplayStyles(
      { width: 33, height: 17, baseScale: 0.5, isSvg: true },
      { ...initialView, scale: 1.25 }
    );

    expect(styles.image).toMatchObject({ width: 20.625, height: 10.625 });
  });

  it('keeps pan offsets in screen pixels independently of SVG zoom', () => {
    const view = { scale: 10, offsetX: 32.5, offsetY: -48 };
    const svgStyles = getMediaDisplayStyles(media, view);
    const rasterStyles = getMediaDisplayStyles({ ...media, isSvg: false }, view);

    expect(svgStyles.container.transform).toBe('translate(32.5px, -48px)');
    expect(rasterStyles.container.transform).toBe('translate(32.5px, -48px) scale(5)');
    expect(svgStyles.image).toMatchObject({ width: 4000, height: 3000 });
  });

  it('preserves transform-based rendering for raster images, animations and video', () => {
    const styles = getMediaDisplayStyles({ ...media, isSvg: false }, initialView);

    expect(styles).toEqual({
      container: {
        transform: 'translate(0px, 0px) scale(0.5)',
        transformOrigin: 'center center',
        willChange: 'transform'
      }
    });
  });

  it('preserves the content point under the cursor when zooming SVG', () => {
    const cursor = { x: 120, y: -75 };
    const beforeView = { scale: 1, offsetX: 25, offsetY: -10 };
    const nextScale = 2.5;
    const scaleRatio = nextScale / beforeView.scale;
    const afterView = {
      scale: nextScale,
      offsetX: cursor.x - (cursor.x - beforeView.offsetX) * scaleRatio,
      offsetY: cursor.y - (cursor.y - beforeView.offsetY) * scaleRatio
    };
    const before = getMediaDisplayStyles(media, beforeView);
    const after = getMediaDisplayStyles(media, afterView);
    const beforeWidth = Number(before.image?.width);
    const beforeHeight = Number(before.image?.height);
    const afterWidth = Number(after.image?.width);
    const afterHeight = Number(after.image?.height);

    expect((cursor.x - beforeView.offsetX) / beforeWidth)
      .toBeCloseTo((cursor.x - afterView.offsetX) / afterWidth);
    expect((cursor.y - beforeView.offsetY) / beforeHeight)
      .toBeCloseTo((cursor.y - afterView.offsetY) / afterHeight);
  });
});
