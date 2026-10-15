import type { CSSProperties } from 'react';

/** 记录媒体相对于面板中心的缩放和平移状态。 */
export interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface MediaDisplayInfo {
  width: number;
  height: number;
  baseScale: number;
  isSvg: boolean;
}

interface MediaDisplayStyles {
  container: CSSProperties;
  image?: CSSProperties;
}

export function isSvgFile(file: Pick<File, 'type' | 'name'>) {
  const mimeType = file.type.split(';', 1)[0].trim().toLowerCase();
  return mimeType === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

export function getMediaDisplayStyles(media: MediaDisplayInfo, viewState: ViewState): MediaDisplayStyles {
  const displayScale = media.baseScale * viewState.scale;
  const translation = `translate(${viewState.offsetX}px, ${viewState.offsetY}px)`;

  if (media.isSvg) {
    // SVG 按实际显示尺寸重绘，避免 scale 和强制合成层放大已栅格化的缓存。
    return {
      container: { transform: translation },
      image: {
        width: media.width * displayScale,
        height: media.height * displayScale,
        // 放大后允许超出面板，不能被 flex 布局重新压缩。
        flexShrink: 0
      }
    };
  }

  return {
    container: {
      transform: `${translation} scale(${displayScale})`,
      transformOrigin: 'center center',
      willChange: 'transform'
    }
  };
}
