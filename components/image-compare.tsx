/**
 * 图片对比主组件
 *
 * 核心功能：
 * 1. 左右并排显示两张图片进行对比
 * 2. 支持拖拽上传、点击上传、粘贴上传
 * 3. 同步/独立缩放和平移
 * 4. 多种交互方式：鼠标拖拽、滚轮缩放、触控板手势
 * 5. 深色模式支持
 * 6. 国际化支持
 */

'use client';

import type React from 'react';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, ImageIcon, X, Loader2, Languages, CheckCircle, AlertCircle, HelpCircle, Lock, Unlock, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { useGesture } from '@use-gesture/react';
import { Button } from '@/components/ui/button';
import LiquidGlass from '@/components/ui/liquid-glass';
import { HelpModal } from '@/components/help-modal';
import { advanceAnimation, clampTime, frameIndexAtTime, linkedSeekTime, setPlaying, type AnimationMetadata, type PlaybackState } from '@/lib/animation';
import { AnimationSession } from '@/lib/animation-session';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useLoadingVisibility } from '@/lib/use-loading-visibility';
import type { Translations } from '@/lib/locales';

/**
 * 视图状态接口
 * 记录图片的缩放和平移状态
 */
interface ViewState {
  scale: number;    // 缩放比例
  offsetX: number;  // X 轴偏移量
  offsetY: number;  // Y 轴偏移量
}

/**
 * 媒体信息接口
 */
interface MediaInfo {
  src: string;        // 媒体 URL（Blob URL）
  fileName: string;   // 原始文件名
  width: number;      // 原始宽度
  height: number;     // 原始高度
  baseScale: number;  // 基础缩放比例（使媒体适应容器）
  type: 'image' | 'animation' | 'video'; // 媒体类型
  animation?: AnimationMetadata;
  animationSession?: AnimationSession;
}

/**
 * 视频控制接口
 */
interface DynamicControls extends PlaybackState {
  isMuted: boolean;
}

type KeyboardMediaMode = 'none' | 'image' | 'dynamic';
type PanelSide = 'left' | 'right';

interface DragMemo {
  x: number;
  y: number;
  blocked: boolean;
}

const IMAGE_KEYBOARD_PAN_STEP = 32;
const DYNAMIC_STEP = 0.5;
const FILE_NAME_HEAD_LEN = 14;
const FILE_NAME_TAIL_LEN = 10;
const FILE_NAME_FONT = '12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FILE_NAME_BUDGET_PADDING = 96;

const textMeasureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function measureTextWidth(text: string, font: string) {
  const context = textMeasureCanvas?.getContext('2d');
  if (!context) {
    return text.length * 8;
  }

  context.font = font;
  return context.measureText(text).width;
}

function fitFileNameToWidth(fileName: string, maxWidth: number, font: string) {
  if (!fileName) {
    return '';
  }

  if (maxWidth <= 0) {
    return fileName;
  }

  if (measureTextWidth(fileName, font) <= maxWidth) {
    return fileName;
  }

  const lastDotIndex = fileName.lastIndexOf('.');
  const hasExtension = lastDotIndex > 0 && lastDotIndex < fileName.length - 1;
  const baseName = hasExtension ? fileName.slice(0, lastDotIndex) : fileName;
  const extension = hasExtension ? fileName.slice(lastDotIndex) : '';
  const ellipsis = '…';

  if (measureTextWidth(ellipsis + extension, font) >= maxWidth) {
    let tailLength = Math.max(1, fileName.length - 1);

    while (tailLength > 1) {
      const candidate = `${ellipsis}${fileName.slice(-tailLength)}`;
      if (measureTextWidth(candidate, font) <= maxWidth) {
        return candidate;
      }
      tailLength -= 1;
    }

    return ellipsis;
  }

  let headLength = Math.min(FILE_NAME_HEAD_LEN, baseName.length);
  let tailLength = Math.min(FILE_NAME_TAIL_LEN, baseName.length - headLength);

  if (tailLength <= 0) {
    tailLength = Math.min(FILE_NAME_TAIL_LEN, Math.max(baseName.length - 1, 1));
    headLength = Math.max(baseName.length - tailLength, 1);
  }

  const minHeadLength = Math.min(3, Math.max(baseName.length - 1, 1));
  const minTailLength = Math.min(3, Math.max(baseName.length - 1, 1));

  while (headLength >= minHeadLength && tailLength >= minTailLength) {
    const candidate = `${baseName.slice(0, headLength)}${ellipsis}${baseName.slice(-tailLength)}${extension}`;
    if (measureTextWidth(candidate, font) <= maxWidth) {
      return candidate;
    }

    if (headLength > minHeadLength) {
      headLength -= 1;
    } else if (tailLength > minTailLength) {
      tailLength -= 1;
    } else {
      break;
    }
  }

  return `${ellipsis}${extension || fileName.slice(-Math.min(fileName.length, FILE_NAME_TAIL_LEN))}`;
}

function isTouchInput(event: Event) {
  if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent) {
    return event.pointerType === 'touch';
  }

  return typeof TouchEvent !== 'undefined' && event instanceof TouchEvent;
}

function isGestureBlockedTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest('[data-gesture-blocker="true"]') !== null;
}

function isDynamicProgressTarget(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.dataset.dynamicProgress === 'true';
}

function getDynamicProgressSide(target: EventTarget | null): PanelSide | null {
  if (!isDynamicProgressTarget(target)) {
    return null;
  }

  const side = target.dataset.dynamicSide;
  return side === 'left' || side === 'right' ? side : null;
}

function cancelledError() {
  return new DOMException('Upload cancelled', 'AbortError');
}

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
}

function isSupportedMediaFile(file: File) {
  return file.type.startsWith('image/') || isVideoFile(file) || /\.(gif|png|apng|webp|jpe?g|bmp|avif|svg)$/i.test(file.name);
}

function isAnimationCandidate(file: File) {
  return ['image/gif', 'image/png', 'image/apng', 'image/webp'].includes(file.type) || /\.(gif|png|apng|webp)$/i.test(file.name);
}

function loadDimensions(url: string, isVideo: boolean, signal: AbortSignal): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const element = isVideo ? document.createElement('video') : new Image();
    const cleanup = () => {
      element.onload = null;
      element.onerror = null;
      if (element instanceof HTMLVideoElement) { element.onloadedmetadata = null; }
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      element.removeAttribute('src');
      reject(cancelledError());
    };
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    element.onerror = () => { cleanup(); reject(new Error('media-load-failed')); };
    if (element instanceof HTMLVideoElement) {
      element.preload = 'metadata';
      element.onloadedmetadata = () => {
        const result = { width: element.videoWidth, height: element.videoHeight, duration: element.duration };
        cleanup();
        resolve(result);
      };
    } else {
      element.onload = () => {
        const result = { width: element.naturalWidth, height: element.naturalHeight, duration: 0 };
        cleanup();
        resolve(result);
      };
    }
    element.src = url;
  });
}

/**
 * 媒体面板属性接口
 */
interface MediaPanelProps {
  media: MediaInfo | null;                    // 媒体信息
  onUpload: (file: File) => void;            // 上传回调
  onDelete: () => void;                      // 删除回调
  viewState: ViewState;                      // 视图状态
  onViewChange: (state: ViewState) => void;  // 视图变化回调
  side: PanelSide;                           // 面板侧别
  label: string;                             // 面板标签（'A' 或 'B'）
  isLoading: boolean;                        // 是否正在加载
  t: Translations;                           // 翻译文本
  activeTouchCountRef: { current: number };  // 当前页面触摸点数量
  onActivate: () => void;                    // 激活当前面板
  dynamicControls?: DynamicControls;         // 动态媒体控制状态
  onDynamicControlChange?: (controls: Partial<DynamicControls>) => void;
  onTogglePlay?: (side: PanelSide) => void;  // 按侧播放/暂停
  onSeek?: (time: number) => void;           // 按比例同步拖动进度条
  onAnimationError: (error: Error) => void;
}

/**
 * 媒体面板组件
 *
 * 功能：
 * - 显示图片/视频或上传提示
 * - 处理拖拽上传
 * - 处理手势交互（拖拽、缩放、滚轮）
 * - 显示媒体尺寸信息
 * - 提供删除按钮
 * - 提供视频播放控制
 */
function MediaPanel({ media, onUpload, onDelete, viewState, onViewChange, side, label, isLoading, t, activeTouchCountRef, onActivate, dynamicControls, onDynamicControlChange, onTogglePlay, onSeek, onAnimationError }: MediaPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dynamicControlsRef = useRef(dynamicControls);
  dynamicControlsRef.current = dynamicControls;
  const drawnFrameRef = useRef(-1);
  const drawnMediaRef = useRef<MediaInfo | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  // 动图首帧尚未绘制的标记：仅在此期间显示“正在处理”遮罩，
  // 播放/拖动过程中的逐帧解码不驱动遮罩，避免按帧频闪烁。
  const [firstFramePending, setFirstFramePending] = useState(false);

  /**
   * 处理拖拽上传
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      onActivate();
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && isSupportedMediaFile(file)) {
        onUpload(file);
      }
    },
    [onActivate, onUpload]
  );

  /**
   * 处理文件选择上传
   */
  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onActivate();
      const file = e.target.files?.[0];
      if (file) {
        onUpload(file);
      }
      e.target.value = '';
    },
    [onActivate, onUpload]
  );

  /** 同步视频状态到 DOM。 */
  useEffect(() => {
    if (media?.type === 'video' && videoRef.current && dynamicControls) {
      if (dynamicControls.isPlaying && videoRef.current.paused) {
        videoRef.current.play().catch(() => onDynamicControlChange?.({ isPlaying: false }));
      } else if (!dynamicControls.isPlaying && !videoRef.current.paused) {
        videoRef.current.pause();
      }

      if (Math.abs(videoRef.current.currentTime - dynamicControls.currentTime) > 0.1) {
        videoRef.current.currentTime = dynamicControls.currentTime;
      }

      videoRef.current.muted = dynamicControls.isMuted;
    }
  }, [media?.type, dynamicControls, onDynamicControlChange]);

  /** 动图按实际经过时间播放，不改变文件中的帧时长。 */
  useEffect(() => {
    if (media?.type !== 'animation' || !media.animation || !dynamicControls?.isPlaying || !onDynamicControlChange) { return; }
    let frameRequest = 0;
    let lastTimestamp: number | null = null;
    const tick = (timestamp: number) => {
      if (lastTimestamp !== null) {
        const current = dynamicControlsRef.current;
        if (current?.isPlaying) {
          const next = advanceAnimation(current, (timestamp - lastTimestamp) / 1000, media.animation!.loopCount);
          dynamicControlsRef.current = { ...current, ...next };
          onDynamicControlChange(next);
          if (!next.isPlaying) { return; }
        }
      }
      lastTimestamp = timestamp;
      frameRequest = requestAnimationFrame(tick);
    };
    frameRequest = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRequest);
  }, [media, dynamicControls?.isPlaying, onDynamicControlChange]);

  /** 首帧和后续画面均由会话持有，绘制后立即关闭 ImageBitmap。 */
  useEffect(() => {
    if (media?.type !== 'animation' || !media.animationSession || !canvasRef.current) {
      setFirstFramePending(false);
      return;
    }
    // 新动图挂载后首帧还没绘制，此时用遮罩兜住空白画布。
    setFirstFramePending(true);
    drawnMediaRef.current = media;
    drawnFrameRef.current = -1;
    const context = canvasRef.current.getContext('2d');
    if (!context) { return; }
    const first = media.animationSession.takeFirstFrame();
    if (first) {
      context.drawImage(first, 0, 0);
      first.close();
      drawnFrameRef.current = 0;
      setFirstFramePending(false);
    }
    return media.animationSession.subscribe((bitmap, index) => {
      try {
        if (drawnMediaRef.current === media && canvasRef.current) {
          canvasRef.current.getContext('2d')?.drawImage(bitmap, 0, 0);
          drawnFrameRef.current = index;
          setFirstFramePending(false);
        }
      } finally {
        bitmap.close();
      }
    }, (error) => {
      setFirstFramePending(false);
      onDynamicControlChange?.({ isPlaying: false });
      onAnimationError(error);
    });
  }, [media, onAnimationError, onDynamicControlChange]);

  // 仅负责请求目标帧：解码期间画布保留上一帧，不切换 loading 状态，
  // 否则播放或拖动进度条时遮罩会按帧率反复明灭，造成屏幕闪烁。
  useEffect(() => {
    if (media?.type !== 'animation' || !media.animation || !media.animationSession) { return; }
    const index = frameIndexAtTime(media.animation.durations, dynamicControls?.currentTime ?? 0);
    if (index !== drawnFrameRef.current) {
      media.animationSession.requestFrame(index);
    }
  }, [media, dynamicControls?.currentTime]);

  /**
   * 监听面板宽度变化，用于计算文件名可用宽度
   */
  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setPanelWidth(element.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const fileName = useMemo(() => {
    if (!media) {
      return '';
    }

    return fitFileNameToWidth(media.fileName, Math.max(0, panelWidth - FILE_NAME_BUDGET_PADDING), FILE_NAME_FONT);
  }, [media, panelWidth]);

  /**
   * 使用 @use-gesture/react 处理手势交互
   */
  useGesture(
    {
      // 拖拽处理：平移媒体
      onDrag: ({ first, movement: [mx, my], memo, event }) => {
        if (!media) { return memo; }
        if (isGestureBlockedTarget(event.target)) {
          return first || !memo ? { x: viewState.offsetX, y: viewState.offsetY, blocked: true } : memo;
        }

        const isMultiTouchDrag = isTouchInput(event) && activeTouchCountRef.current > 1;
        const currentMemo: DragMemo = first || !memo
          ? { x: viewState.offsetX, y: viewState.offsetY, blocked: isMultiTouchDrag }
          : memo;

        if (isMultiTouchDrag) {
          currentMemo.blocked = true;
        }

        if (currentMemo.blocked) {
          return currentMemo;
        }

        if (first) {
          currentMemo.x = viewState.offsetX;
          currentMemo.y = viewState.offsetY;
        }

        onViewChange({
          ...viewState,
          offsetX: currentMemo.x + mx,
          offsetY: currentMemo.y + my
        });
        return currentMemo;
      },
      // 捏合缩放处理：以捏合中心点为基准缩放
      onPinch: ({ first, origin: [ox, oy], movement: [ms], memo, event }) => {
        if (!media) { return; }
        if (isGestureBlockedTarget(event.target)) { return memo; }
        event.preventDefault();

        if (first) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) { return { initialScale: viewState.scale, initialOffset: { x: 0, y: 0 }, mouseX: 0, mouseY: 0 }; }

          const mouseX = ox - rect.left - rect.width / 2;
          const mouseY = oy - rect.top - rect.height / 2;

          return {
            initialScale: viewState.scale,
            initialOffset: { x: viewState.offsetX, y: viewState.offsetY },
            mouseX,
            mouseY
          };
        }

        const { initialScale, initialOffset, mouseX, mouseY } = memo;
        const newScale = Math.min(Math.max(initialScale * ms, 0.1), 10);
        const scaleDiff = newScale / initialScale;

        // 计算新的偏移量，使缩放以捏合中心为基准
        const newOffsetX = mouseX - (mouseX - initialOffset.x) * scaleDiff;
        const newOffsetY = mouseY - (mouseY - initialOffset.y) * scaleDiff;

        onViewChange({
          scale: newScale,
          offsetX: newOffsetX,
          offsetY: newOffsetY
        });

        return memo;
      },
      // 滚轮处理：区分触控板平移和鼠标滚轮缩放
      onWheel: ({ event, delta: [dx, dy] }) => {
        if (!media) { return; }
        if (isGestureBlockedTarget(event.target)) { return; }
        if (event.ctrlKey) { return; }

        // 水平滚动时阻止默认行为
        if (Math.abs(dx) > Math.abs(dy)) {
          event.preventDefault();
        }

        // 判断是触控板还是鼠标滚轮
        const isTrackpad = Math.abs(dy) < 40;

        if (isTrackpad) {
          // 触控板：平移内容
          event.preventDefault();
          onViewChange({
            ...viewState,
            offsetX: viewState.offsetX - dx,
            offsetY: viewState.offsetY - dy
          });
        } else {
          // 鼠标滚轮：以光标为中心缩放
          event.preventDefault();
          const delta = dy > 0 ? 0.9 : 1.1;
          const newScale = Math.min(Math.max(viewState.scale * delta, 0.1), 10);

          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) {
            const mouseX = event.clientX - rect.left - rect.width / 2;
            const mouseY = event.clientY - rect.top - rect.height / 2;

            const scaleDiff = newScale / viewState.scale;
            const newOffsetX = mouseX - (mouseX - viewState.offsetX) * scaleDiff;
            const newOffsetY = mouseY - (mouseY - viewState.offsetY) * scaleDiff;

            onViewChange({
              scale: newScale,
              offsetX: newOffsetX,
              offsetY: newOffsetY
            });
          }
        }
      }
    },
    {
      target: containerRef,
      eventOptions: { passive: false },
      enabled: !!media
    }
  );

  // 计算实际显示的缩放比例（基础缩放 * 视图缩放）
  const displayScale = media ? viewState.scale * media.baseScale : viewState.scale;

  // 遮罩状态做延迟展示与最短展示时长处理，避免短解码任务造成屏幕闪烁。
  const showProcessing = useLoadingVisibility(isLoading || (firstFramePending && media?.type === 'animation'));

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full relative overflow-hidden',
        media ? 'cursor-grab active:cursor-grabbing' : '',
        isLoading && 'cursor-wait'
      )}
      style={{ touchAction: 'none' }}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onPointerDown={() => onActivate()}
      onFocusCapture={() => onActivate()}
    >
      {media ? (
        <>
          {/* 媒体显示区域 */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `translate(${viewState.offsetX}px, ${viewState.offsetY}px) scale(${displayScale})`,
              transformOrigin: 'center center',
              willChange: 'transform'
            }}
          >
            {media.type === 'image' ? (
              <img
                src={media.src}
                alt={label}
                className="max-w-none select-none pointer-events-none"
                draggable={false}
              />
            ) : media.type === 'animation' ? (
              <canvas
                ref={canvasRef}
                width={media.animation?.renderWidth}
                height={media.animation?.renderHeight}
                style={{ width: media.width, height: media.height }}
                className="max-w-none select-none pointer-events-none"
                aria-label={label}
                role="img"
              />
            ) : (
              <video
                ref={videoRef}
                src={media.src}
                className="max-w-none select-none pointer-events-none"
                muted={dynamicControls?.isMuted}
                playsInline
                onLoadedMetadata={(e) => {
                  if (onDynamicControlChange) {
                    onDynamicControlChange({ duration: e.currentTarget.duration });
                  }
                }}
                onTimeUpdate={() => {
                  if (onDynamicControlChange && videoRef.current) {
                    onDynamicControlChange({ currentTime: videoRef.current.currentTime });
                  }
                }}
                onEnded={() => {
                  if (onDynamicControlChange) {
                    onDynamicControlChange({ isPlaying: false, currentTime: dynamicControlsRef.current?.duration || 0 });
                  }
                }}
              />
            )}
          </div>

          {/* 动态媒体控制栏 */}
          {media.type !== 'image' && dynamicControls && onDynamicControlChange && (
            <div
              data-gesture-blocker="true"
              className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2"
            >
              <LiquidGlass
                radius={12}
                frost={0.1}
                className="flex items-center gap-2 px-3 py-1.5"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-neutral-800 dark:text-white"
                  aria-label={dynamicControls.isPlaying ? t.pause : t.play}
                  onClick={(e) => {
                    e.stopPropagation();
                    onActivate();
                    onTogglePlay?.(side);
                  }}
                >
                  {dynamicControls.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>

                <div className="flex flex-col w-32 gap-1">
                  <input
                    data-dynamic-progress="true"
                    data-dynamic-side={side}
                    type="range"
                    min={0}
                    max={dynamicControls.duration || 100}
                    step={0.01}
                    value={dynamicControls.currentTime}
                    aria-label={t.playbackProgress}
                    onChange={(e) => {
                      onActivate();
                      onSeek?.(parseFloat(e.target.value));
                    }}
                    onPointerUp={(e) => {
                      // 拖动后释放焦点，避免空格键继续操作进度条。
                      e.currentTarget.blur();
                    }}
                    onTouchEnd={(e) => {
                      e.currentTarget.blur();
                    }}
                    className="w-full h-2 md:h-1 bg-neutral-300 dark:bg-white/20 rounded-lg appearance-none cursor-pointer accent-neutral-800 dark:accent-white"
                  />
                </div>

                {media.type === 'video' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-neutral-800 dark:text-white"
                    aria-label={dynamicControls.isMuted ? t.unmute : t.mute}
                    onClick={(e) => {
                      e.stopPropagation();
                      onActivate();
                      onDynamicControlChange({ isMuted: !dynamicControls.isMuted });
                    }}
                  >
                    {dynamicControls.isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                )}
              </LiquidGlass>
            </div>
          )}

          {/* 底部信息栏：同一容器内排布，避免长文件名覆盖分辨率。 */}
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
            {/* 媒体尺寸信息 */}
            <LiquidGlass
              radius={12}
              frost={0.1}
              containerClassName="shrink-0"
              className="px-3 py-1.5 text-xs font-mono text-neutral-800 dark:text-white"
            >
              {media.width} × {media.height} {media.type !== 'image' && `(${(dynamicControls?.currentTime ?? 0).toFixed(1)}s / ${(dynamicControls?.duration ?? 0).toFixed(1)}s)`}
            </LiquidGlass>
            {/* 文件名信息 */}
            <LiquidGlass
              radius={12}
              frost={0.1}
              containerClassName="min-w-0 max-w-full shrink"
              className="px-3 py-1.5 text-xs text-neutral-800 dark:text-white"
            >
              <span
                className="block max-w-full truncate"
                title={media.fileName}
              >
                {fileName}
              </span>
            </LiquidGlass>
          </div>
          {/* 删除按钮 */}
          <LiquidGlass
            radius={8}
            frost={0.1}
            containerClassName={cn(
              'absolute z-20 h-7 w-7',
              // 移动端顶部工具栏会覆盖上方面板，A 面板删除按钮需要避开。
              label === 'A' ? 'left-3 top-16 md:top-3' : 'right-3 top-3'
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-full rounded-none bg-transparent border-none shadow-none text-neutral-600 dark:text-white/70 hover:text-neutral-900 dark:hover:text-white hover:bg-white/20 dark:hover:bg-white/10"
              aria-label={t.deleteMedia}
              onClick={onDelete}
            >
              <X className="h-4 w-4" />
            </Button>
          </LiquidGlass>
        </>
      ) : !isLoading ? (
        /* 上传提示 */
        <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageIcon className="h-10 w-10 opacity-40" />
            <div className="text-center">
              <p className="text-sm">{t.dropOrClick}</p>
            </div>
          </div>
          <input type="file" accept="image/*,video/*,.gif,.png,.apng,.webp" className="hidden" onChange={handleFileInput} />
        </label>
      ) : null}
      {showProcessing && (
        <div
          className={cn(
            'absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 select-none pointer-events-none',
            'bg-background/40 animate-in fade-in duration-200'
          )}
        >
          <Loader2 className="h-10 w-10 animate-spin text-neutral-600 dark:text-white/70" />
          <p className="text-sm text-neutral-600 dark:text-white/70">{t.processing}</p>
        </div>
      )}
    </div>
  );
}

/**
 * 图片对比主组件
 *
 * 功能：
 * - 管理左右两张图片的状态
 * - 控制同步/独立模式
 * - 处理上传、删除、清空等操作
 * - 提供缩放、重置等控制功能
 * - 支持粘贴上传
 * - 显示帮助模态框
 */
export function ImageCompare() {
  const { t, locale, setLocale } = useI18n();
  // 左右媒体状态
  const [leftMedia, setLeftMedia] = useState<MediaInfo | null>(null);
  const [rightMedia, setRightMedia] = useState<MediaInfo | null>(null);

  // 动图和视频的控制状态（每侧独立）
  const [leftDynamicControls, setLeftDynamicControls] = useState<DynamicControls | undefined>(undefined);
  const [rightDynamicControls, setRightDynamicControls] = useState<DynamicControls | undefined>(undefined);

  // 加载状态
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);

  // Toast 消息状态
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // 帮助模态框显示状态
  const [showHelp, setShowHelp] = useState(false);

  // 同步模式状态
  const [isSynced, setIsSynced] = useState(true);
  const isSyncedRef = useRef(isSynced);
  isSyncedRef.current = isSynced;
  const [activePanel, setActivePanel] = useState<PanelSide>('left');

  const leftHasDynamic = leftMedia?.type === 'video' || leftMedia?.type === 'animation';
  const rightHasDynamic = rightMedia?.type === 'video' || rightMedia?.type === 'animation';

  // 左右视图状态
  const [leftViewState, setLeftViewState] = useState<ViewState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0
  });

  const [rightViewState, setRightViewState] = useState<ViewState>({
    scale: 1,
    offsetX: 0,
    offsetY: 0
  });
  const leftViewStateRef = useRef(leftViewState);
  const rightViewStateRef = useRef(rightViewState);

  useEffect(() => {
    leftViewStateRef.current = leftViewState;
  }, [leftViewState]);

  useEffect(() => {
    rightViewStateRef.current = rightViewState;
  }, [rightViewState]);

  /**
   * 判断当前键盘操作应控制的媒体类型
   */
  const getKeyboardMediaMode = useCallback((left: MediaInfo | null, right: MediaInfo | null): KeyboardMediaMode => {
    if (left?.type === 'animation' || left?.type === 'video' || right?.type === 'animation' || right?.type === 'video') { return 'dynamic'; }
    return left || right ? 'image' : 'none';
  }, []);

  /**
   * 处理单侧动态媒体控制变化
   */
  const handleLeftDynamicControlChange = useCallback((newControls: Partial<DynamicControls>) => {
    setLeftDynamicControls(prev => prev ? { ...prev, ...newControls } : prev);
  }, []);

  const handleRightDynamicControlChange = useCallback((newControls: Partial<DynamicControls>) => {
    setRightDynamicControls(prev => prev ? { ...prev, ...newControls } : prev);
  }, []);

  /**
   * 锁定时播放/暂停两侧；自然结束的一侧不影响另一侧。
   */
  const setAllDynamicPlayback = useCallback((shouldPlay: boolean) => {
    setLeftDynamicControls(prev => setPlaying(prev, shouldPlay));
    setRightDynamicControls(prev => setPlaying(prev, shouldPlay));
  }, []);

  const toggleAllDynamicPlayback = useCallback(() => {
    const shouldPlay = !(leftDynamicControls?.isPlaying || rightDynamicControls?.isPlaying);
    setAllDynamicPlayback(shouldPlay);
  }, [leftDynamicControls?.isPlaying, rightDynamicControls?.isPlaying, setAllDynamicPlayback]);

  /**
   * 按比例同步拖动进度条
   * 拖动一侧时，另一侧按相同比例跳转
   */
  const handleLeftSeek = useCallback((time: number) => {
    setLeftDynamicControls(prev => prev ? { ...prev, currentTime: clampTime(time, prev.duration), completedLoops: 0 } : prev);
    if (leftDynamicControls && rightDynamicControls) {
      const linkedTime = linkedSeekTime(time, leftDynamicControls.duration, rightDynamicControls.duration, isSynced);
      if (linkedTime === null) { return; }
      setRightDynamicControls(prev => prev ? {
        ...prev,
        currentTime: clampTime(linkedTime, prev.duration),
        completedLoops: 0
      } : prev);
    }
  }, [isSynced, leftDynamicControls, rightDynamicControls]);

  const handleRightSeek = useCallback((time: number) => {
    setRightDynamicControls(prev => prev ? { ...prev, currentTime: clampTime(time, prev.duration), completedLoops: 0 } : prev);
    if (leftDynamicControls && rightDynamicControls) {
      const linkedTime = linkedSeekTime(time, rightDynamicControls.duration, leftDynamicControls.duration, isSynced);
      if (linkedTime === null) { return; }
      setLeftDynamicControls(prev => prev ? {
        ...prev,
        currentTime: clampTime(linkedTime, prev.duration),
        completedLoops: 0
      } : prev);
    }
  }, [isSynced, leftDynamicControls, rightDynamicControls]);

  const handleTogglePlay = useCallback((side: PanelSide) => {
    if (isSynced) {
      toggleAllDynamicPlayback();
    } else {
      const setter = side === 'left' ? setLeftDynamicControls : setRightDynamicControls;
      setter(prev => setPlaying(prev, !prev?.isPlaying));
    }
  }, [isSynced, toggleAllDynamicPlayback]);

  const getKeyboardDynamicSide = useCallback((preferredSide?: PanelSide): PanelSide | null => {
    const side = preferredSide ?? activePanel;
    const hasPreferredDynamic = side === 'left' ? leftHasDynamic : rightHasDynamic;

    if (hasPreferredDynamic) {
      return side;
    }

    if (leftHasDynamic) {
      return 'left';
    }

    if (rightHasDynamic) {
      return 'right';
    }

    return null;
  }, [activePanel, leftHasDynamic, rightHasDynamic]);

  const toggleKeyboardDynamicPlayback = useCallback((preferredSide?: PanelSide) => {
    const side = getKeyboardDynamicSide(preferredSide);
    if (!side) {
      return;
    }

    handleTogglePlay(side);
  }, [getKeyboardDynamicSide, handleTogglePlay]);

  const seekKeyboardDynamic = useCallback((delta: number) => {
    const side = getKeyboardDynamicSide();
    if (!side) {
      return;
    }

    const controls = side === 'left' ? leftDynamicControls : rightDynamicControls;
    if (!controls) {
      return;
    }

    const nextTime = clampTime(controls.currentTime + delta, controls.duration);
    if (side === 'left') {
      handleLeftSeek(nextTime);
    } else {
      handleRightSeek(nextTime);
    }
  }, [getKeyboardDynamicSide, handleLeftSeek, handleRightSeek, leftDynamicControls, rightDynamicControls]);

  /**
   * 处理视图变化
   * 在同步模式下，一侧的新状态会直接同步到另一侧，避免变化量累计误差。
   */
  const handleViewChange = useCallback((side: PanelSide, newState: ViewState) => {
    setActivePanel(side);

    if (side === 'left') {
      leftViewStateRef.current = newState;
      setLeftViewState(newState);

      if (isSynced) {
        rightViewStateRef.current = newState;
        setRightViewState(newState);
      }
    } else {
      rightViewStateRef.current = newState;
      setRightViewState(newState);

      if (isSynced) {
        leftViewStateRef.current = newState;
        setLeftViewState(newState);
      }
    }
  }, [isSynced]);

  const containerRef = useRef<HTMLDivElement>(null);
  const activeTouchIdsRef = useRef<Set<number>>(new Set());
  const activeTouchCountRef = useRef(0);

  // 管理 Blob URL，防止内存泄漏
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // 使用 ref 存储媒体信息，避免闭包问题
  const leftMediaRef = useRef<MediaInfo | null>(null);
  const rightMediaRef = useRef<MediaInfo | null>(null);
  const uploadSequenceRef = useRef({ left: 0, right: 0 });
  const uploadControllerRef = useRef<{ left: AbortController | null; right: AbortController | null }>({ left: null, right: null });

  useEffect(() => {
    leftMediaRef.current = leftMedia;
  }, [leftMedia]);

  useEffect(() => {
    rightMediaRef.current = rightMedia;
  }, [rightMedia]);

  /**
   * 全局跟踪触摸点数量，避免两个面板同时触发单指拖拽造成同步冲突。
   */
  useEffect(() => {
    if (typeof PointerEvent === 'undefined') {
      const handleTouchChange = (event: TouchEvent) => {
        activeTouchCountRef.current = event.touches.length;
      };

      window.addEventListener('touchstart', handleTouchChange, { passive: true });
      window.addEventListener('touchmove', handleTouchChange, { passive: true });
      window.addEventListener('touchend', handleTouchChange, { passive: true });
      window.addEventListener('touchcancel', handleTouchChange, { passive: true });

      return () => {
        window.removeEventListener('touchstart', handleTouchChange);
        window.removeEventListener('touchmove', handleTouchChange);
        window.removeEventListener('touchend', handleTouchChange);
        window.removeEventListener('touchcancel', handleTouchChange);
      };
    }

    const updateTouchCount = () => {
      activeTouchCountRef.current = activeTouchIdsRef.current.size;
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        return;
      }

      activeTouchIdsRef.current.add(event.pointerId);
      updateTouchCount();
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        return;
      }

      activeTouchIdsRef.current.delete(event.pointerId);
      updateTouchCount();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      activeTouchIdsRef.current.clear();
      activeTouchCountRef.current = 0;
    };
  }, []);

  // 监听系统深色模式变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  /**
   * 计算基础缩放比例
   * 使媒体适应容器大小
   */
  const calculateBaseScale = useCallback((mediaWidth: number, mediaHeight: number) => {
    const container = containerRef.current;
    if (!container) { return 1; }

    const isDesktop = container.clientWidth >= 768;
    // 移动端上下堆叠，每个面板约占媒体区域一半高度。
    const containerWidth = (isDesktop ? container.clientWidth / 2 : container.clientWidth) - 32;
    const containerHeight = (isDesktop ? container.clientHeight : container.clientHeight / 2) - 32;

    const scaleX = containerWidth / mediaWidth;
    const scaleY = containerHeight / mediaHeight;

    return Math.min(scaleX, scaleY, 1);
  }, []);

  /** 新文件验证成功后再替换旧媒体，避免失败时丢失原画面。 */
  const handleUpload = useCallback(
    async(file: File, side: PanelSide) => {
      setActivePanel(side);
      uploadControllerRef.current[side]?.abort();
      const controller = new AbortController();
      uploadControllerRef.current[side] = controller;
      const sequence = ++uploadSequenceRef.current[side];
      if (side === 'left') { setLeftLoading(true); } else { setRightLoading(true); }
      const objectUrl = URL.createObjectURL(file);
      let committed = false;
      let animationSession: AnimationSession | null = null;
      try {
        let width: number;
        let height: number;
        let type: MediaInfo['type'];
        let duration = 0;
        let animation: AnimationMetadata | undefined;

        if (isVideoFile(file)) {
          const dimensions = await loadDimensions(objectUrl, true, controller.signal);
          ({ width, height, duration } = dimensions);
          type = 'video';
        } else {
          if (isAnimationCandidate(file)) {
            animationSession = await AnimationSession.create(file, controller.signal);
          }
          if (animationSession?.metadata) {
            animation = animationSession.metadata;
            width = animation.width;
            height = animation.height;
            duration = animation.duration;
            type = 'animation';
          } else {
            const dimensions = await loadDimensions(objectUrl, false, controller.signal);
            width = dimensions.width;
            height = dimensions.height;
            type = 'image';
          }
        }

        if (controller.signal.aborted || sequence !== uploadSequenceRef.current[side]) { throw cancelledError(); }
        if (!width || !height) { throw new Error('media-load-failed'); }
        const mediaInfo: MediaInfo = {
          src: objectUrl,
          fileName: file.name,
          width,
          height,
          baseScale: calculateBaseScale(width, height),
          type,
          animation,
          animationSession: animationSession ?? undefined
        };
        const dynamicControls: DynamicControls | undefined = type === 'image' ? undefined : {
          isPlaying: false,
          currentTime: 0,
          duration,
          completedLoops: 0,
          isMuted: true
        };
        const oldMedia = side === 'left' ? leftMediaRef.current : rightMediaRef.current;
        objectUrlsRef.current.add(objectUrl);
        committed = true;
        if (side === 'left') {
          leftMediaRef.current = mediaInfo;
          setLeftMedia(mediaInfo);
          setLeftDynamicControls(dynamicControls);
          setLeftLoading(false);
        } else {
          rightMediaRef.current = mediaInfo;
          setRightMedia(mediaInfo);
          setRightDynamicControls(dynamicControls);
          setRightLoading(false);
        }
        if (dynamicControls && isSyncedRef.current) {
          setLeftDynamicControls(prev => prev ? { ...prev, isPlaying: false, currentTime: 0, completedLoops: 0 } : prev);
          setRightDynamicControls(prev => prev ? { ...prev, isPlaying: false, currentTime: 0, completedLoops: 0 } : prev);
        }
        oldMedia?.animationSession?.dispose();
        if (oldMedia && objectUrlsRef.current.delete(oldMedia.src)) { URL.revokeObjectURL(oldMedia.src); }
      } catch (error) {
        if (sequence === uploadSequenceRef.current[side]) {
          if (side === 'left') { setLeftLoading(false); } else { setRightLoading(false); }
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setToast({ message: error instanceof Error && error.message === 'animation-resource-error' ? t.animationResourceError : error instanceof Error && error.message === 'animation-decode-failed' ? t.animationDecodeError : t.loadError, type: 'error' });
            setTimeout(() => setToast(null), 3000);
          }
        }
        throw error;
      } finally {
        if (!committed) {
          animationSession?.dispose();
          URL.revokeObjectURL(objectUrl);
        }
        if (uploadControllerRef.current[side] === controller) { uploadControllerRef.current[side] = null; }
      }
    },
    [calculateBaseScale, t]
  );

  /**
   * 重置视图状态
   */
  const handleReset = useCallback(() => {
    const initialState = { scale: 1, offsetX: 0, offsetY: 0 };
    leftViewStateRef.current = initialState;
    rightViewStateRef.current = initialState;
    setLeftViewState(initialState);
    setRightViewState(initialState);
    setIsSynced(true);
    setLeftDynamicControls(prev => prev ? { ...prev, currentTime: 0, isPlaying: false, completedLoops: 0 } : prev);
    setRightDynamicControls(prev => prev ? { ...prev, currentTime: 0, isPlaying: false, completedLoops: 0 } : prev);
  }, []);

  /**
   * 放大媒体
   */
  const handleZoomIn = useCallback(() => {
    const newStateFn = (prev: ViewState) => ({
      ...prev,
      scale: Math.min(prev.scale * 1.25, 10)
    });

    setLeftViewState((prev) => {
      const nextState = newStateFn(prev);
      leftViewStateRef.current = nextState;
      return nextState;
    });
    setRightViewState((prev) => {
      const nextState = newStateFn(prev);
      rightViewStateRef.current = nextState;
      return nextState;
    });
  }, []);

  /**
   * 缩小媒体
   */
  const handleZoomOut = useCallback(() => {
    const newStateFn = (prev: ViewState) => ({
      ...prev,
      scale: Math.max(prev.scale / 1.25, 0.1)
    });

    setLeftViewState((prev) => {
      const nextState = newStateFn(prev);
      leftViewStateRef.current = nextState;
      return nextState;
    });
    setRightViewState((prev) => {
      const nextState = newStateFn(prev);
      rightViewStateRef.current = nextState;
      return nextState;
    });
  }, []);

  const hasMedia = leftMedia || rightMedia;
  const isLoading = leftLoading || rightLoading;

  /**
   * 清理所有 Blob URL
   */
  const cleanupAllUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
    });
    objectUrlsRef.current.clear();
  }, []);

  // 组件卸载时清理 Blob URL
  useEffect(() => {
    return () => {
      uploadControllerRef.current.left?.abort();
      uploadControllerRef.current.right?.abort();
      leftMediaRef.current?.animationSession?.dispose();
      rightMediaRef.current?.animationSession?.dispose();
      cleanupAllUrls();
    };
  }, [cleanupAllUrls]);

  /**
   * 删除单侧媒体
   */
  const handleDeleteMedia = useCallback(
    (side: PanelSide) => {
      uploadSequenceRef.current[side] += 1;
      uploadControllerRef.current[side]?.abort();
      uploadControllerRef.current[side] = null;
      const mediaRef = side === 'left' ? leftMediaRef : rightMediaRef;
      const oldUrl = mediaRef.current?.src;
      mediaRef.current?.animationSession?.dispose();
      if (oldUrl && objectUrlsRef.current.has(oldUrl)) {
        URL.revokeObjectURL(oldUrl);
        objectUrlsRef.current.delete(oldUrl);
      }

      setActivePanel((prev) => prev === side ? (side === 'left' ? 'right' : 'left') : prev);

      if (side === 'left') {
        leftMediaRef.current = null;
        setLeftMedia(null);
        setLeftDynamicControls(undefined);
        setLeftLoading(false);
      } else {
        rightMediaRef.current = null;
        setRightMedia(null);
        setRightDynamicControls(undefined);
        setRightLoading(false);
      }
    },
    []
  );

  /**
   * 清空所有媒体
   */
  const handleClearAll = useCallback(() => {
    uploadSequenceRef.current.left += 1;
    uploadSequenceRef.current.right += 1;
    uploadControllerRef.current.left?.abort();
    uploadControllerRef.current.right?.abort();
    uploadControllerRef.current.left = null;
    uploadControllerRef.current.right = null;
    leftMediaRef.current?.animationSession?.dispose();
    rightMediaRef.current?.animationSession?.dispose();
    cleanupAllUrls();
    leftMediaRef.current = null;
    rightMediaRef.current = null;
    setLeftMedia(null);
    setRightMedia(null);
    setLeftLoading(false);
    setRightLoading(false);
    handleReset();
    setLeftDynamicControls(undefined);
    setRightDynamicControls(undefined);
  }, [cleanupAllUrls, handleReset]);

  /**
   * 显示 Toast 消息
   */
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleAnimationError = useCallback((error: Error) => {
    showToast(error.message === 'animation-resource-error' ? t.animationResourceError : t.animationDecodeError, 'error');
  }, [showToast, t]);

  /**
   * 打开帮助模态框
   */
  const handleOpenHelp = useCallback(() => {
    setShowHelp(true);
  }, []);

  /**
   * 关闭帮助模态框
   */
  const handleCloseHelp = useCallback(() => {
    setShowHelp(false);
  }, []);

  /**
   * 处理粘贴上传
   */
  const handlePaste = useCallback(
    async(e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) {return;}

      const file = Array.from(items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .find((item): item is File => item !== null && isSupportedMediaFile(item));
      if (!file) {
        return;
      }

      e.preventDefault();

      // 确定上传到哪一侧
      let targetSide: PanelSide;
      if (!leftMedia) {
        targetSide = 'left';
      } else if (!rightMedia) {
        targetSide = 'right';
      } else {
        targetSide = 'left';
      }

      try {
        await handleUpload(file, targetSide);
        const sideName = targetSide === 'left' ? 'A' : 'B';
        showToast(t.pasteSuccess.replace('{side}', sideName), 'success');
      } catch {
        // 上传流程已经显示了具体错误；取消的旧请求不需要提示。
      }
    },
    [handleUpload, leftMedia, rightMedia, showToast, t]
  );

  // 监听粘贴事件，支持移动端外接键盘或浏览器剪贴板事件。
  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  // 监听键盘快捷键（仅在桌面端）
  useEffect(() => {
    const isDesktop = window.innerWidth >= 768;
    if (!isDesktop) {return;}

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (showHelp) {
        return;
      }

      if (e.key === ' ' && isDynamicProgressTarget(target)) {
        e.preventDefault();
        e.stopPropagation();
        toggleKeyboardDynamicPlayback(getDynamicProgressSide(target) ?? undefined);
        return;
      }

      if (
        target instanceof HTMLElement &&
        (
          target.closest('input, textarea, select, [contenteditable="true"]') ||
          target.isContentEditable
        )
      ) {
        return;
      }

      const mediaMode = getKeyboardMediaMode(leftMedia, rightMedia);

      if (e.key === ' ') {
        const side = getKeyboardDynamicSide();
        if (!side) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        toggleKeyboardDynamicPlayback(side);
        return;
      }

      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        return;
      }

      if (mediaMode === 'none' || (mediaMode === 'dynamic' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (mediaMode === 'image') {
        let deltaX = 0;
        let deltaY = 0;

        if (e.key === 'ArrowLeft') { deltaX = -IMAGE_KEYBOARD_PAN_STEP; }
        if (e.key === 'ArrowRight') { deltaX = IMAGE_KEYBOARD_PAN_STEP; }
        if (e.key === 'ArrowUp') { deltaY = -IMAGE_KEYBOARD_PAN_STEP; }
        if (e.key === 'ArrowDown') { deltaY = IMAGE_KEYBOARD_PAN_STEP; }

        if (leftMedia?.type === 'image') {
          setLeftViewState((prev) => {
            const nextState = {
              ...prev,
              offsetX: prev.offsetX + deltaX,
              offsetY: prev.offsetY + deltaY
            };
            leftViewStateRef.current = nextState;
            return nextState;
          });
        }

        if (rightMedia?.type === 'image') {
          setRightViewState((prev) => {
            const nextState = {
              ...prev,
              offsetX: prev.offsetX + deltaX,
              offsetY: prev.offsetY + deltaY
            };
            rightViewStateRef.current = nextState;
            return nextState;
          });
        }

        return;
      }

      if (mediaMode === 'dynamic' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const delta = e.key === 'ArrowLeft' ? -DYNAMIC_STEP : DYNAMIC_STEP;
        seekKeyboardDynamic(delta);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [getKeyboardMediaMode, getKeyboardDynamicSide, leftMedia, rightMedia, seekKeyboardDynamic, showHelp, toggleKeyboardDynamicPlayback]);

  const handleLeftUpload = useCallback((file: File) => { void handleUpload(file, 'left').catch(() => {}); }, [handleUpload]);
  const handleRightUpload = useCallback((file: File) => { void handleUpload(file, 'right').catch(() => {}); }, [handleUpload]);
  const handleLeftDelete = useCallback(() => handleDeleteMedia('left'), [handleDeleteMedia]);
  const handleRightDelete = useCallback(() => handleDeleteMedia('right'), [handleDeleteMedia]);
  const handleLeftViewChange = useCallback((state: ViewState) => handleViewChange('left', state), [handleViewChange]);
  const handleRightViewChange = useCallback((state: ViewState) => handleViewChange('right', state), [handleViewChange]);
  const activateLeft = useCallback(() => setActivePanel('left'), []);
  const activateRight = useCallback(() => setActivePanel('right'), []);

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* 顶部控制栏 */}
      <LiquidGlass
        radius={16}
        frost={0.1}
        containerClassName="absolute left-1/2 top-3 z-10 w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2"
        className="flex w-max max-w-[calc(100vw-1.5rem)] items-center gap-1 overflow-x-auto px-2 py-1.5 md:max-w-none md:px-3"
      >
        {/* 标题 */}
        <div className="hidden items-center min-w-[120px] justify-center px-2 md:flex">
          <div className="relative flex items-center justify-center">
            {isLoading && (
              <Loader2 className="h-3 w-3 animate-spin absolute -left-5" />
            )}
            <span className="text-sm font-medium text-neutral-800 dark:text-white">
              {t.imageCompare}
            </span>
          </div>
        </div>
        <div className="hidden w-px h-4 bg-neutral-400/30 dark:bg-white/20 mx-1 md:block" />
        {/* 缩放比例显示 */}
        <span className="text-xs text-neutral-600 dark:text-white/70 px-2 font-mono">
          {Math.round(leftViewState.scale * 100)}%
        </span>
        {/* 缩小按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg text-neutral-600 dark:text-white/70 hover:text-neutral-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/20"
          onClick={handleZoomOut}
          disabled={!hasMedia || isLoading}
          title={t.zoomOut}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        {/* 放大按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg text-neutral-600 dark:text-white/70 hover:text-neutral-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/20"
          onClick={handleZoomIn}
          disabled={!hasMedia || isLoading}
          title={t.zoomIn}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        {/* 重置按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg text-neutral-600 dark:text-white/70 hover:text-neutral-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/20"
          onClick={handleReset}
          disabled={!hasMedia || isLoading}
          title={t.reset}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        <div className="w-px h-4 bg-neutral-400/30 dark:bg-white/20 mx-1" />
        {/* 同步/独立切换按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7 rounded-lg transition-colors',
            isSynced
              ? 'text-neutral-600 dark:text-white/70 hover:text-neutral-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/20'
              : 'text-amber-600 dark:text-amber-400 bg-amber-100/50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50'
          )}
          onClick={() => setIsSynced(!isSynced)}
          disabled={!hasMedia || isLoading}
          title={isSynced ? t.unlockView : t.lockView}
        >
          {isSynced ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
        </Button>

        <div className="w-px h-4 bg-neutral-400/30 dark:bg-white/20 mx-1" />
        {/* 清空按钮 */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 rounded-lg px-0 text-xs text-neutral-600 dark:text-white/70 hover:text-neutral-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/20 md:w-auto md:px-3"
          onClick={handleClearAll}
          disabled={!hasMedia && !isLoading}
          title={t.clear}
        >
          <X className="h-3.5 w-3.5 md:hidden" />
          <span className="hidden md:inline">{t.clear}</span>
        </Button>
        <div className="w-px h-4 bg-neutral-400/30 dark:bg-white/20 mx-1" />
        {/* 语言切换按钮 */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 rounded-lg px-0 text-xs text-neutral-600 dark:text-white/70 hover:text-neutral-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/20 flex items-center gap-1 md:w-auto md:px-3"
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          title={t.switchTo}
        >
          <Languages className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{t.switchTo}</span>
        </Button>
        <div className="w-px h-4 bg-neutral-400/30 dark:bg-white/20 mx-1" />
        {/* 帮助按钮 */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 rounded-lg px-0 text-xs text-neutral-600 dark:text-white/70 hover:text-neutral-900 dark:hover:text-white hover:bg-white/30 dark:hover:bg-white/20 flex items-center gap-1 md:w-auto md:px-3"
          onClick={handleOpenHelp}
          title={t.help}
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span className="hidden md:inline">{t.help}</span>
        </Button>
      </LiquidGlass>

      {/* 媒体显示区域 */}
      <div ref={containerRef} className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 左侧媒体面板 */}
        <div className="min-h-0 flex-1 bg-secondary">
          <MediaPanel
            media={leftMedia}
            onUpload={handleLeftUpload}
            onDelete={handleLeftDelete}
            viewState={leftViewState}
            onViewChange={handleLeftViewChange}
            side="left"
            label="A"
            isLoading={leftLoading}
            t={t}
            activeTouchCountRef={activeTouchCountRef}
            onActivate={activateLeft}
            dynamicControls={leftMedia?.type !== 'image' ? leftDynamicControls : undefined}
            onDynamicControlChange={handleLeftDynamicControlChange}
            onTogglePlay={handleTogglePlay}
            onAnimationError={handleAnimationError}
            onSeek={handleLeftSeek}
          />
        </div>
        {/* 中间分隔线 */}
        <div className="h-px w-full bg-white/20 backdrop-blur-sm dark:bg-white/10 md:h-auto md:w-px" />
        {/* 右侧媒体面板 */}
        <div className="min-h-0 flex-1 bg-secondary">
          <MediaPanel
            media={rightMedia}
            onUpload={handleRightUpload}
            onDelete={handleRightDelete}
            viewState={rightViewState}
            onViewChange={handleRightViewChange}
            side="right"
            label="B"
            isLoading={rightLoading}
            t={t}
            activeTouchCountRef={activeTouchCountRef}
            onActivate={activateRight}
            dynamicControls={rightMedia?.type !== 'image' ? rightDynamicControls : undefined}
            onDynamicControlChange={handleRightDynamicControlChange}
            onTogglePlay={handleTogglePlay}
            onAnimationError={handleAnimationError}
            onSeek={handleRightSeek}
          />
        </div>
      </div>

      {/* Toast 消息提示 */}
      {toast && (
        <LiquidGlass
          radius={16}
          frost={0.15}
          containerClassName="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2"
          className={cn(
            'px-4 py-3 min-w-[280px] flex items-center gap-2 justify-center',
            toast.type === 'success'
              ? 'text-green-700 dark:text-green-300'
              : 'text-red-700 dark:text-red-300'
          )}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <span className="text-sm font-medium">{toast.message}</span>
        </LiquidGlass>
      )}

      {/* 帮助模态框 */}
      <HelpModal
        isOpen={showHelp}
        onClose={handleCloseHelp}
      />
    </div>
  );
}
