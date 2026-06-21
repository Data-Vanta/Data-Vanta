import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    // Production gzip on the Node server. The dev server doesn't compress
    // either way; for `npm start` this trims wire bytes ~70%.
    compress: true,

    // Skip emitting .map files in the production bundle. Lighthouse counts
    // source maps in transferred-bytes if they happen to land in /_next.
    productionBrowserSourceMaps: false,

    // Tree-shake heavy libs at the import level so a `import { X } from
    // 'lib'` doesn't pull in the whole library. Next.js rewrites these
    // to per-export sub-imports automatically. Cuts a few hundred KB
    // off the initial chunk for any page that uses them.
    experimental: {
        optimizePackageImports: [
            "echarts",
            "echarts-for-react",
            "react-icons",
            "react-grid-layout",
            "react-markdown",
            "remark-gfm",
            "lucide-react",
        ],
    },

    // Stronger long-term caching for hashed static assets. Public files
    // get a small max-age so updates aren't sticky.
    async headers() {
        return [
            {
                source: "/_next/static/:path*",
                headers: [
                    { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
                ],
            },
            {
                source: "/:all*(svg|jpg|png|webp|woff2)",
                headers: [
                    { key: "Cache-Control", value: "public, max-age=86400" },
                ],
            },
        ];
    },
};

export default nextConfig;
