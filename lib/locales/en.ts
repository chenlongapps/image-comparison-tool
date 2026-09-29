/**
 * 英文翻译文件
 *
 * 包含应用所有界面的英文翻译文本
 * 与中文翻译文件保持相同的键名结构，以便于切换语言
 */

import type { Translations } from './zh';

/**
 * 英文翻译对象
 *
 * 包含以下分类的翻译：
 * - 通用 UI 文本（按钮、标签等）
 * - 状态消息（加载、错误、成功等）
 * - 帮助文档（开始使用、手势、FAQ）
 */
export const en: Translations = {
    // 通用 UI 文本
    imageCompare: 'Media Compare',
    clear: 'Clear',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    reset: 'Reset',
    lockView: 'Lock View (Sync Move)',
    unlockView: 'Unlock View (Allow Independent Move)',

    // 状态消息
    processing: 'Processing...',
    dropOrClick: 'Drop or click to upload images, animations, or videos',
    loadError: 'Failed to load, please check the file format',
    animationResourceError: 'Browser resources could not decode this animation; the previous media was kept',
    animationDecodeError: 'Could not decode the animation; the previous media was kept',
    playbackProgress: 'Playback progress',
    play: 'Play',
    pause: 'Pause',
    mute: 'Mute',
    unmute: 'Unmute',
    deleteMedia: 'Remove media',

    // 语言切换
    language: 'English',
    switchTo: '中',

    // 粘贴功能
    pasteSuccess: 'Content pasted to {side}',
    // 帮助系统
    help: 'Help',
    helpTitle: 'Media Comparison Tool Guide',
    helpDescription: 'Quick guide to comparing images, animations, and videos',
    versionLabel: 'Version',

    // 帮助 - 开始使用
    gettingStarted: 'Getting Started',
    uploadImages: '1. Upload Files',
    uploadImagesDesc: 'Drop images, GIFs, APNGs, animated WebPs, or videos onto either side, or click to select files',
    compareImages: '2. Compare Media',
    compareImagesDesc: 'Zoom and pan together; animations and videos share play/pause actions and seek by percentage of their own durations',

    // 帮助 - 交互手势
    gestures: 'Gestures',
    dragToPan: 'Drag to Pan',
    dragToPanDesc: 'Hold and drag on content to move around',
    pinchToZoom: 'Pinch to Zoom',
    pinchToZoomDesc: 'Use trackpad or touch screen to zoom with pinch gesture',
    scrollToZoom: 'Scroll to Zoom',
    scrollToZoomDesc: 'Use mouse wheel to zoom, centered on cursor position',
    trackpadPan: 'Trackpad Pan',
    trackpadPanDesc: 'Use trackpad two-finger swipe to pan the content',
    alignImagesDesc: 'Click the unlock button in the top bar to move each side independently for alignment',
    keyboardShortcuts: 'Keyboard Shortcuts',
    keyboardImageDesc: 'In image mode, use the arrow keys to move any loaded images in sync',
    keyboardVideoDesc: 'For animations or videos, Left/Right steps by 0.5 seconds, Space plays or pauses, and Reset pauses at the start',
    keyboardMixedDesc: 'Locked panels share controls; unlocked panels are independent. Each keeps its own speed and can end independently.',

    // 帮助 - 常见问题
    faq: 'FAQ',
    faq1Question: 'How to upload files?',
    faq1Answer: 'Drop, select, or paste images, animations, and videos. Pasting preserves animation only when the clipboard provides the original animated file.',
    faq2Question: 'What is the zoom range?',
    faq2Answer: 'Supports zoom from 0.1x to 10x. You can adjust using +/- buttons, mouse wheel, or pinch gestures.',
    faq3Question: 'Can I compare animations and videos?',
    faq3Answer: 'Yes. GIF, APNG, animated WebP, and video are supported. Animations load paused on the first frame, and only multi-frame files get playback controls. Locked panels share play/pause and seek by relative progress.',
    faq4Question: 'How is my data handled?',
    faq4Answer: 'All files are processed locally in your browser and never uploaded to any server. Data is automatically cleared when you close the browser.',

    // 对话框按钮
    close: 'Close',
    gotIt: 'Got it'
};
