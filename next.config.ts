import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/billing/checkout": ["./public/brand/symbol-white.svg"],
  },
};
export default config;
