import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "showcase-static/**",
      "deploy/china-future/**",
      "docs/evidence/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
