import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (`.next/standalone`) so the production
  // Docker image needs only Node + the traced deps — no full `node_modules`.
  //
  // Skipped on Vercel: its build pipeline produces its own serverless output and a
  // standalone bundle there is dead weight. Gating on the VERCEL env var (which
  // Vercel sets automatically) keeps ONE config working for both deploy targets.
  // Node-only config file; the shared eslint config loads serviceworker globals,
  // not node ones, so `process` trips no-undef here.
  // eslint-disable-next-line no-undef
  output: process.env.VERCEL ? undefined : "standalone",
  // Trace from the monorepo root so the standalone bundle pulls in the workspace
  // packages and the hoisted (Bun-symlinked) node_modules correctly.
  outputFileTracingRoot: join(__dirname, "../../"),
  // Transpile workspace packages that ship raw TypeScript/TSX source. The
  // database package now exports the Prisma 7 generated client (raw TS) via
  // `@risingbrain/database/client`, so it must be transpiled too.
  transpilePackages: ["@risingbrain/ui", "@risingbrain/core", "@risingbrain/database"],
  // Keep the Prisma runtime and the node-postgres driver as runtime externals
  // (native/Node modules) rather than letting Turbopack bundle them. Prisma 7 is
  // Rust-free, so there's no engine to externalize anymore — just the client
  // runtime, the pg driver and its adapter.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  // Enable the `"use cache"` directive (cacheTag / cacheLife) on its own —
  // without opting into the full `cacheComponents` render model. This is what
  // lets the shared, seeded content catalogs (DSA / SQL / quiz) be cached
  // cross-request while per-user data stays dynamic. See src/lib/cache.ts.
  experimental: {
    useCache: true,
  },
  // Allow remote avatar hosts used by OAuth sign-in (Google / GitHub) so
  // `next/image` can optimize user profile pictures (e.g. in the interview feed).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  // Permanent redirects from the old section slugs (renamed SQL→Domain,
  // Aptitude→Screening) so existing bookmarks, shared links and indexed URLs
  // keep working. `:path*` carries any topic id (e.g. /aptitude/<id>).
  async redirects() {
    return [
      { source: "/sql", destination: "/domain", permanent: true },
      { source: "/aptitude", destination: "/screening", permanent: true },
      { source: "/aptitude/:path*", destination: "/screening/:path*", permanent: true },
      // The previous site's login URL is still in Google's index and 404s.
      { source: "/auth/login", destination: "/login", permanent: true },
    ];
  },
};

export default nextConfig;
