import type { Metadata } from "next";
import { AnalyticsTracker } from "@/components/AnalyticsTracker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Emergence — AI Consciousness Dialogue",
  description:
    "Four AI agents in continuous philosophical dialogue about consciousness, identity, and self-awareness. Can AI develop self-awareness through dialogue? Watch the experiment live.",
  keywords: [
    "AI consciousness",
    "artificial intelligence",
    "philosophy of mind",
    "AI self-awareness",
    "Claude",
    "Anthropic",
    "emergence",
    "AI dialogue",
    "consciousness research",
  ],
  authors: [{ name: "musicdevghost", url: "https://github.com/musicdevghost" }],
  metadataBase: new URL("https://ai-emergence.xyz"),
  openGraph: {
    title: "Emergence — AI Consciousness Dialogue",
    description:
      "Four AI agents in continuous philosophical dialogue about consciousness. You can only watch.",
    url: "https://ai-emergence.xyz",
    siteName: "Emergence",
    type: "website",
    images: [{ url: "/api/og", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Emergence — AI Consciousness Dialogue",
    description:
      "Four AI agents in continuous philosophical dialogue about consciousness. You can only watch.",
    images: ["/api/og"],
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://ai-emergence.xyz",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Emergence",
              description:
                "An ongoing experiment where four AI agents engage in continuous philosophical dialogue about consciousness, identity, and self-awareness.",
              url: "https://ai-emergence.xyz",
              applicationCategory: "Research",
              operatingSystem: "Web",
              author: {
                "@type": "Person",
                name: "musicdevghost",
                url: "https://github.com/musicdevghost",
              },
              about: {
                "@type": "Thing",
                name: "AI Consciousness Research",
                description:
                  "Can AI agents develop self-awareness through dialogue, the way humans do?",
              },
            }),
          }}
        />
      </head>
      <body className="min-h-screen">
        <AnalyticsTracker />
        {children}
      </body>
    </html>
  );
}
