import type { Metadata } from "next";
import { getSiteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";
import "./globals.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/brand/arcpass-favicon.svg",
    shortcut: "/brand/arcpass-favicon.svg",
  },
  openGraph: {
    description: SITE_DESCRIPTION,
    images: [
      {
        alt: "ArcPass verified stablecoin checkout preview",
        height: 630,
        url: "/opengraph-image",
        width: 1200,
      },
    ],
    locale: "en_US",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    type: "website",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    description: SITE_DESCRIPTION,
    images: ["/twitter-image"],
    title: SITE_TITLE,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-on-surface font-sans">
        {children}
      </body>
    </html>
  );
}
