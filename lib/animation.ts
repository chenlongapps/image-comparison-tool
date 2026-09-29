export type AnimationFormat = 'gif' | 'apng' | 'webp';

export interface AnimationMetadata {
  format: AnimationFormat;
  width: number;
  height: number;
  renderWidth: number;
  renderHeight: number;
  frameCount: number;
  // 0 表示无限循环，其余值是总播放次数。
  loopCount: number;
  durations: number[];
  duration: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  completedLoops: number;
}

export function renderSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('animation-resource-error');
  }
  const scale = Math.min(1, 4096 / width, 4096 / height, Math.sqrt(4_000_000 / (width * height)));
  let renderWidth = Math.max(1, Math.round(width * scale));
  let renderHeight = Math.max(1, Math.round(height * scale));
  while (renderWidth * renderHeight > 4_000_000) {
    if (renderWidth >= renderHeight) { renderWidth -= 1; } else { renderHeight -= 1; }
  }
  return { width: renderWidth, height: renderHeight };
}

export function normalizeFrameDuration(durationMs: number): number {
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 10;
}

export function frameIndexAtTime(durations: readonly number[], time: number): number {
  if (durations.length === 0) { return 0; }
  let elapsed = 0;
  const milliseconds = Math.max(0, time * 1000);
  for (let index = 0; index < durations.length; index += 1) {
    elapsed += durations[index];
    if (milliseconds < elapsed) { return index; }
  }
  return durations.length - 1;
}

export function clampTime(time: number, duration: number): number {
  const safe = Number.isFinite(time) ? Math.max(0, time) : 0;
  return Number.isFinite(duration) && duration > 0 ? Math.min(safe, duration) : safe;
}

export function proportionalTime(time: number, sourceDuration: number, targetDuration: number): number {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || !Number.isFinite(targetDuration) || targetDuration <= 0) {
    return 0;
  }
  return clampTime(time, sourceDuration) / sourceDuration * targetDuration;
}

export function linkedSeekTime(time: number, sourceDuration: number, targetDuration: number, locked: boolean): number | null {
  return locked && Number.isFinite(sourceDuration) && sourceDuration > 0 && Number.isFinite(targetDuration) && targetDuration > 0
    ? proportionalTime(time, sourceDuration, targetDuration)
    : null;
}

export function setPlaying<T extends PlaybackState>(state: T | undefined, shouldPlay: boolean): T | undefined {
  if (!state) { return undefined; }
  const restart = shouldPlay && state.currentTime >= state.duration;
  return {
    ...state,
    isPlaying: shouldPlay,
    currentTime: restart ? 0 : state.currentTime,
    completedLoops: restart ? 0 : state.completedLoops
  };
}

export function advanceAnimation(state: PlaybackState, deltaSeconds: number, loopCount: number): PlaybackState {
  if (!state.isPlaying || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || state.duration <= 0) { return state; }
  const absolute = state.currentTime + deltaSeconds;
  const crossed = Math.floor(absolute / state.duration);
  const completedLoops = state.completedLoops + crossed;
  if (loopCount > 0 && completedLoops >= loopCount) {
    return { ...state, isPlaying: false, currentTime: state.duration, completedLoops: loopCount };
  }
  return { ...state, currentTime: absolute % state.duration, completedLoops };
}
