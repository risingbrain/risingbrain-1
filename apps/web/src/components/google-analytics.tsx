import Script from "next/script";

// GA4 Measurement ID for the RisingBrain property. This is a PUBLIC identifier —
// it ships in the page source of every site that uses Analytics, so it is not a
// secret and lives here rather than in an env var. Hardcoding it also means the
// Docker/standalone build needs no NEXT_PUBLIC_* build-arg plumbing: it works
// identically on Vercel and on the EC2 compose deploy.
export const GA_MEASUREMENT_ID = "G-7G1RJWFCRH";

/**
 * Loads gtag.js and bootstraps GA4.
 *
 * Only mounted in production builds so local `next dev` sessions (and CI) don't
 * pollute the real property with fake traffic. `NODE_ENV` is inlined by the
 * bundler, so in dev this component compiles away to `null`.
 *
 * Client-side route changes are NOT tracked here on purpose: GA4's Enhanced
 * Measurement ("Page changes based on browser history events", on by default)
 * already fires a page_view for every App Router navigation. Sending our own
 * would double-count every page.
 */
export function GoogleAnalytics() {
  if (process.env.NODE_ENV !== "production") return null;

  return (
    <>
      {/* `afterInteractive` = loaded right after hydration: early enough to catch
          the first page_view, late enough not to block first paint. */}
      <Script
        id="ga-loader"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_MEASUREMENT_ID}');
        `}
      </Script>
    </>
  );
}
