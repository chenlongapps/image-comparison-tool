/**
 * 中文翻译文件
 *
 * 定义翻译接口类型和中文翻译文本
 * 作为默认语言，其他语言文件（如英文）需要实现相同的接口
 */

/**
 * 翻译接口定义
 *
 * 定义应用中所有需要翻译的文本键名
 * 确保所有语言文件都实现相同的接口，保证类型安全
 */
export interface Translations {
    // 通用 UI 文本
    imageCompare: string;
    clear: string;
    zoomIn: string;
    zoomOut: string;
    reset: string;
    lockView: string;
    unlockView: string;

    // 状态消息
    processing: string;
    dropOrClick: string;
    loadError: string;
    animationResourceError: string;
    animationDecodeError: string;
    playbackProgress: string;
    play: string;
    pause: string;
    mute: string;
    unmute: string;
    deleteMedia: string;

    // 语言切换
    language: string;
    switchTo: string;

    // 粘贴功能
    pasteSuccess: string;
    // 帮助系统
    help: string;
    helpTitle: string;
    helpDescription: string;
    versionLabel: string;

    // 帮助 - 开始使用
    gettingStarted: string;
    uploadImages: string;
    uploadImagesDesc: string;
    compareImages: string;
    compareImagesDesc: string;

    // 帮助 - 交互手势
    gestures: string;
    dragToPan: string;
    dragToPanDesc: string;
    pinchToZoom: string;
    pinchToZoomDesc: string;
    scrollToZoom: string;
    scrollToZoomDesc: string;
    trackpadPan: string;
    trackpadPanDesc: string;
    alignImagesDesc: string;
    keyboardShortcuts: string;
    keyboardImageDesc: string;
    keyboardVideoDesc: string;
    keyboardMixedDesc: string;

    // 帮助 - 常见问题
    faq: string;
    faq1Question: string;
    faq1Answer: string;
    faq2Question: string;
    faq2Answer: string;
    faq3Question: string;
    faq3Answer: string;
    faq4Question: string;
    faq4Answer: string;

    // 对话框按钮
    close: string;
    gotIt: string;
}

/**
 * 中文翻译对象
 *
 * 包含应用所有界面的中文翻译文本
 * 作为默认语言，其他语言文件需要实现相同的键名
 */
export const zh: Translations = {
    // 通用 UI 文本
    imageCompare: '多媒体对比',
    clear: '清空',
    zoomIn: '放大',
    zoomOut: '缩小',
    reset: '重置',
    lockView: '锁定视图（同步移动）',
    unlockView: '解锁视图（独立移动）',

    // 状态消息
    processing: '正在处理...',
    dropOrClick: '拖放或点击上传图片、动图或视频',
    loadError: '加载失败，请检查文件格式',
    animationResourceError: '浏览器资源不足，无法解码此动图；已保留原媒体',
    animationDecodeError: '动图解码失败，已保留原媒体',
    playbackProgress: '播放进度',
    play: '播放',
    pause: '暂停',
    mute: '静音',
    unmute: '取消静音',
    deleteMedia: '删除媒体',

    // 语言切换
    language: '中文',
    switchTo: 'EN',

    // 粘贴功能
    pasteSuccess: '内容已粘贴到 {side}',
    // 帮助系统
    help: '使用说明',
    helpTitle: '多媒体对比工具使用指南',
    helpDescription: '快速了解如何使用此工具进行图片、动图和视频对比',
    versionLabel: '版本',

    // 帮助 - 开始使用
    gettingStarted: '开始使用',
    uploadImages: '1. 上传文件',
    uploadImagesDesc: '拖放图片、GIF、APNG、动画 WebP 或视频到左右两侧，或点击选择文件',
    compareImages: '2. 对比内容',
    compareImagesDesc: '自动同步缩放和平移；动图和视频可联动播放、暂停，并按各自时长比例定位',

    // 帮助 - 交互手势
    gestures: '交互手势',
    dragToPan: '拖拽平移',
    dragToPanDesc: '在内容上按住鼠标左键拖动，可平移查看不同区域',
    pinchToZoom: '双指缩放',
    pinchToZoomDesc: '使用触控板或触摸屏进行双指捏合来缩放内容',
    scrollToZoom: '鼠标滚轮缩放',
    scrollToZoomDesc: '滚动鼠标滚轮可缩放内容，以光标为中心点',
    trackpadPan: '触控板平移',
    trackpadPanDesc: '使用触控板双指滑动可平移内容',
    alignImagesDesc: '点击顶部解锁按钮，可独立移动单侧内容进行位置对齐',
    keyboardShortcuts: '键盘操作',
    keyboardImageDesc: '图片模式下，可使用方向键同步移动已加载的图片',
    keyboardVideoDesc: '动图或视频模式下，左右方向键每次调整 0.5 秒，空格键播放或暂停；重置会暂停并回到起点',
    keyboardMixedDesc: '锁定时操作两侧联动，解锁后各自控制；播放期间保持原速，一侧结束不影响另一侧',

    // 帮助 - 常见问题
    faq: '常见问题',
    faq1Question: '如何上传文件？',
    faq1Answer: '可拖放或选择图片、动图和视频，也可用 Ctrl+V 粘贴。只有剪贴板提供原始动图文件时，动画才会保留。',
    faq2Question: '缩放范围是多少？',
    faq2Answer: '支持 0.1x 到 10x 的缩放范围。您可以通过顶部控制栏的 +/− 按钮，鼠标滚轮，或双指捏合来调整。',
    faq3Question: '支持动图与视频对比吗？',
    faq3Answer: '支持 GIF、APNG、动画 WebP 和视频。动图加载后停在首帧；只有多帧文件显示播放控件。锁定时播放操作联动，拖动按各自时长的百分比定位。',
    faq4Question: '数据如何处理？',
    faq4Answer: '所有文件都只在浏览器本地处理，不会上传到服务器。关闭浏览器后数据会自动清理，保障您的隐私安全。',

    // 对话框按钮
    close: '关闭',
    gotIt: '明白了'
};
