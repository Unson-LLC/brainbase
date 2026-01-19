module.exports = {
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "import"],
  rules: {
    // レベル1: 基本的な型安全性
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/prefer-const": "error",
    "no-var": "error",

    // レベル2: 設計原則
    "@typescript-eslint/no-empty-interface": "error",
    "@typescript-eslint/consistent-type-imports": "error",
    "import/no-default-export": "warn",
    "max-lines-per-function": ["warn", { max: 50 }],

    // レベル3: 追加ルール（段階的適用）
    complexity: ["warn", { max: 10 }],
    "max-depth": ["warn", { max: 4 }],
    "max-params": ["warn", { max: 5 }],
  },
  env: {
    node: true,
    es2022: true,
  },
  extends: ["@typescript-eslint/recommended"],
};
