import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // This folder is the app root (a stray lockfile higher up would otherwise be picked).
  outputFileTracingRoot: path.resolve(__dirname),
  serverExternalPackages: ["mailparser", "nodemailer", "pg"],
  // Policy PDFs, commission statements and forwarded emails with attachments.
  // middlewareClientMaxBodySize: middleware runs on every path and would otherwise cut request bodies at 10 MB.
  experimental: { serverActions: { bodySizeLimit: "25mb" }, middlewareClientMaxBodySize: "32mb" },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
