import type { NextConfig } from "next";
const configDir = process.cwd();

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    root: configDir,
  },
  outputFileTracingRoot: configDir,
};

export default nextConfig;
