import type { Metadata } from "next";
import Script from "next/script";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { COOKIES } from "@/lib/auth/constants";
import { SessionKeepAlive } from "@/components/session-keep-alive";
import { GoogleAnalytics } from "@/components/google-analytics";
import { SITE_NAME, SITE_DESCRIPTION, SITE_KEYWORDS, siteUrl } from "@/lib/seo";
import "./globals.css";

// Site-wide typography. Plus Jakarta Sans for content, JetBrains Mono for code.
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-app-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-app-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Resolves all relative URLs below (Open Graph, canonical, sitemap, images).
  metadataBase: siteUrl,
  title: {
    default: `${SITE_NAME} — Crack your dream product company from any college`,
    // Child pages set a bare title (e.g. "DSA Sheets") and this appends the brand.
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  // NO canonical / og:url here: metadata merges shallowly, so whatever the root
  // sets is inherited by every page that doesn't override it — a root canonical
  // of "/" told Google every section page was a duplicate of the homepage. Each
  // indexable page sets its own via `pageMetadata()` (lib/seo.ts).
  category: "education",
  formatDetection: { email: false, telephone: false, address: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: `${SITE_NAME} — Crack your dream product company from any college`,
    description: SITE_DESCRIPTION,
    // opengraph-image.tsx generates the image automatically.
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Crack your dream product company from any college`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // Icons are auto-detected from app/icon.svg + app/apple-icon.tsx — no manual
  // `icons` map needed (and pointing at the removed favicon.ico would override them).
};

// Runs before paint to apply the saved/system theme and avoid a flash of the
// wrong palette. Defaults to dark (matching the RisingBrain web app).
const themeInitScript = `(function () {
  try {
    var stored = localStorage.getItem("theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = stored ? stored === "dark" : true;
    document.documentElement.classList.toggle("dark", isDark);
  } catch (e) {
    document.documentElement.classList.add("dark");
  }
})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A session cookie present? Keep the access token fresh in the background.
  const jar = await cookies();
  const hasRefresh = jar.has(COOKIES.REFRESH);
  const hasSession = hasRefresh || jar.has(COOKIES.ACCESS);
  // Refresh cookie but no access cookie = a recoverable session that has already
  // lapsed (the browser drops rb_at at its max-age). Tell the keep-alive to renew
  // immediately rather than on its next 12-minute tick, so the user isn't shown a
  // signed-out navbar in the meantime. Normally the edge proxy has already fixed
  // this before render; this is the fallback for the requests it doesn't handle.
  const staleSession = hasRefresh && !jar.has(COOKIES.ACCESS);
  return (
    <html
      lang="en"
      className={`dark ${sans.variable} ${mono.variable}`}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/* Pre-paint theme apply (no flash). next/script `beforeInteractive` is
            injected into the initial HTML and runs before hydration. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {hasSession && <SessionKeepAlive stale={staleSession} />}
        {children}
        {/* Google Analytics (production builds only). */}
        <GoogleAnalytics />
      </body>
    </html>
  );
}
