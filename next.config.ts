import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // ExcelJS 4.x ships a prebuilt browser entry. Resolve that entry rather
      // than its index.ts/Node entry when compiling the client-side export.
      // This is a bundler-only alias; the existing dynamic import and
      // disabled-by-default financial Shadow runtime remain unchanged.
      exceljs: "exceljs/dist/exceljs.min.js"
    }
  }
};

export default nextConfig;
