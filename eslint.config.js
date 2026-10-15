// ESLint 全局配置，支持 JavaScript、TypeScript 及 JSX/TSX 文件
module.exports = [
  {
    // 忽略特定目录及配置文件，避免对其做语法检查
    ignores: [
      '**/node_modules/**',   // 第三方依赖
      '**/.next/**',          // Next.js 构建缓存
      '**/out/**',            // 输出目录
      '**/dist/**',           // 打包产物
      '**/playwright-report/**', // 浏览器测试报告
      '**/test-results/**',   // 浏览器测试产物
      '**/*.config.js',       // 各类 *.config.js 配置文件
      '**/eslint.config.js',  // 自身配置文件
      '**/postcss.config.mjs',// PostCSS 配置文件
      "**/public/sw.js",      // Service Worker 文件
      "**/public/swe-worker-*.js", // SW 缓存 Worker 文件
      "**/public/workbox-*.js",    // Workbox 库文件
    ],
  },
  {
    // 针对 JS/JSX/TS/TSX 通用规则
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2025,      // 使用 ECMAScript 2025 语法
      sourceType: 'module',   // 采用 ES Module
      parserOptions: {
        ecmaVersion: 2025,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,          // 启用 JSX
        },
      },
      // 声明 Node.js 全局变量为只读，避免误报未定义
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
      },
    },
    plugins: {
      'jsx': require('eslint-plugin-jsx'), // 引入 JSX 插件
    },
    rules: {
      'prefer-const': 'error',            // 建议使用 const
      'no-unused-vars': 'off',            // 关闭普通未使用变量检查（TS 规则会覆盖）
      'no-console': ['warn', { allow: ['warn', 'error'] }], // 限制 console，仅允许 warn/error
      'eqeqeq': ['error', 'always'],      // 强制使用 === 和 !==
      'curly': 'error',                   // 强制使用花括号
      'semi': ['error', 'always'],        // 强制使用分号
      'quotes': ['error', 'single'],      // 强制单引号
      'comma-dangle': ['error', 'never'], // 禁止尾随逗号
      'object-curly-spacing': ['error', 'always'], // 对象花括号内侧保留空格
      'array-bracket-spacing': ['error', 'never'], // 数组方括号内侧不留空格
      'space-before-function-paren': ['error', 'never'], // 函数括号前不留空格
      'keyword-spacing': 'error',         // 关键字前后保留空格
      'space-infix-ops': 'error',         // 中缀操作符两侧保留空格
      'eol-last': 'error',                // 文件末尾保留空行
      'no-trailing-spaces': 'error',      // 禁止行尾空格
    },
  },
  {
    // 仅对 TypeScript 文件生效的规则
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'), // 使用 TS 解析器
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'), // 引入 TS 插件
    },
    rules: {
      // 未使用变量检查，允许以 _ 开头的参数
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',      // 不强制函数返回类型
      '@typescript-eslint/explicit-module-boundary-types': 'off',   // 不强制模块边界类型
      '@typescript-eslint/no-explicit-any': 'warn',                 // 使用 any 类型时给出警告
    },
  },
];
