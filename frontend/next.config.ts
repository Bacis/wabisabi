import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@remotion/lambda",
    "@remotion/renderer",
    "@remotion/cli",
    "@remotion/compositor-linux-arm64-musl",
    "@remotion/compositor-linux-arm64-gnu",
    "@remotion/compositor-linux-x64-gnu",
    "@remotion/compositor-linux-x64-musl",
    "@remotion/compositor-win32-x64-msvc"
  ]
};

export default nextConfig;
