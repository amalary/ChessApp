import type { NextConfig } from "next";
const configDir = process.cwd();

function backendConnectSource(): string | null {
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? process.env.BACKEND_URL;
  if (!backendUrl || backendUrl.startsWith("/")) {
    return null;
  }

  try {
    const url = new URL(backendUrl);
    return url.origin;
  } catch {
    return null;
  }
}

const connectSources = ["'self'", "https:"];
const backendSource = backendConnectSource();
if (backendSource && !connectSources.includes(backendSource)) {
  connectSources.push(backendSource);
}

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    root: configDir,
  },
  outputFileTracingRoot: configDir,
  async rewrites() {
    const backendUrl = (
      process.env.BACKEND_URL ??
      process.env.NEXT_PUBLIC_BACKEND_URL ??
      "http://127.0.0.1:8010"
    ).replace(/\/+$/, "");

    return [
      {
        source: "/backend/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              `connect-src ${connectSources.join(" ")}`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
