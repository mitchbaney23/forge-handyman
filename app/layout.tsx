import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MobileCTA } from "@/components/MobileCTA";
import { BUSINESS } from "@/lib/constants";

const siteUrl = BUSINESS.siteUrl;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${BUSINESS.name} — Handyman in Garner & Clayton, NC`,
    template: `%s | ${BUSINESS.name}`,
  },
  description:
    "Forge Handyman Service — honest work and fair prices from a 40-year veteran craftsman. Serving Garner, Clayton, South Raleigh, and surrounding NC communities.",
  keywords: [
    "handyman Garner NC",
    "handyman Clayton NC",
    "handyman South Raleigh",
    "deck repair Garner",
    "drywall repair Clayton",
    "home repair Wake County",
    "Johnston County handyman",
  ],
  applicationName: BUSINESS.name,
  authors: [{ name: BUSINESS.owner }],
  creator: BUSINESS.name,
  publisher: BUSINESS.name,
  formatDetection: {
    telephone: true,
    address: true,
    email: true,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: BUSINESS.name,
    title: `${BUSINESS.name} — Honest Work. Built to Last.`,
    description:
      "Trusted local handyman serving Garner, Clayton, and South Raleigh. Free estimates, licensed and insured, 40+ years of craftsmanship.",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BUSINESS.name} — Honest Work. Built to Last.`,
    description:
      "Trusted local handyman serving Garner, Clayton, and South Raleigh. Free estimates, licensed and insured.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#1B3A5C",
  width: "device-width",
  initialScale: 1,
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "HomeAndConstructionBusiness",
  "@id": `${siteUrl}/#business`,
  name: BUSINESS.name,
  description:
    "Local handyman services including general repairs, carpentry, painting, assembly, deck/fence, drywall, and pressure washing.",
  image: `${siteUrl}/og-image.png`,
  url: siteUrl,
  telephone: BUSINESS.phone,
  email: BUSINESS.email,
  priceRange: "$$",
  address: {
    "@type": "PostalAddress",
    addressLocality: BUSINESS.city,
    addressRegion: BUSINESS.region,
    addressCountry: BUSINESS.country,
  },
  areaServed: [
    { "@type": "City", name: "Garner", address: { "@type": "PostalAddress", addressRegion: "NC" } },
    { "@type": "City", name: "Clayton", address: { "@type": "PostalAddress", addressRegion: "NC" } },
    { "@type": "City", name: "Raleigh", address: { "@type": "PostalAddress", addressRegion: "NC" } },
    { "@type": "City", name: "Fuquay-Varina", address: { "@type": "PostalAddress", addressRegion: "NC" } },
    { "@type": "City", name: "Knightdale", address: { "@type": "PostalAddress", addressRegion: "NC" } },
    { "@type": "City", name: "Wendell", address: { "@type": "PostalAddress", addressRegion: "NC" } },
    { "@type": "City", name: "Smithfield", address: { "@type": "PostalAddress", addressRegion: "NC" } },
    { "@type": "City", name: "Archer Lodge", address: { "@type": "PostalAddress", addressRegion: "NC" } },
    { "@type": "City", name: "Willow Spring", address: { "@type": "PostalAddress", addressRegion: "NC" } },
  ],
  openingHoursSpecification: BUSINESS.hoursStructured.map((block) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: block.days,
    opens: block.opens,
    closes: block.closes,
  })),
  founder: { "@type": "Person", name: BUSINESS.owner },
  slogan: BUSINESS.tagline,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col scroll-safe">
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
        <MobileCTA />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </body>
    </html>
  );
}
