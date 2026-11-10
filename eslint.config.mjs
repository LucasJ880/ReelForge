import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".claude/**",
      ".cursor/**",
      "designs/**",
      "showcase-static/**",
      "deploy/china-future/**",
      "docs/evidence/**",
      "playwright-report/**",
      "test-results/**",
      /// tmp 不进仓库（.gitignore）：本机的一次性脚本不该让 npm run lint 变红
      "tmp/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
