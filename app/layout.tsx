import type { Metadata, Viewport } from "next";
import { Libre_Franklin, Zilla_Slab } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MobileCTA } from "@/components/MobileCTA";
import { BUSINESS } from "@/lib/constants";
import { TOWNS } from "@/lib/towns";

const franklin = Libre_Franklin({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-franklin",
});

const zilla = Zilla_Slab({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-zilla",
});

const siteUrl = BUSINESS.siteUrl;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${BUSINESS.name} — Handyman in Garner, Raleigh & Cary, NC`,
    template: `%s | ${BUSINESS.name}`,
  },
  description:
    "Forge Handyman Service — honest work and fair prices from a 40-year veteran craftsman. Serving Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs & Fuquay-Varina, NC.",
  keywords: [
    "handyman Garner NC",
    "handyman Raleigh NC",
    "handyman Cary NC",
    "handyman Clayton NC",
    "handyman Knightdale NC",
    "handyman Wendell NC",
    "handyman Holly Springs NC",
    "handyman Fuquay-Varina NC",
    "deck repair Garner",
    "drywall repair Clayton",
    "home repair Wake County",
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
      "Trusted local handyman serving Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs, and Fuquay-Varina. Free estimates, fully insured, 40+ years of craftsmanship.",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BUSINESS.name} — Honest Work. Built to Last.`,
    description:
      "Trusted local handyman serving Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs, and Fuquay-Varina. Free estimates, fully insured.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#EFE7D5",
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
  // All 8 towns inside the 20-mile radius — kept in lockstep with lib/towns.ts
  // (the per-town landing pages) and the public service-area copy.
  areaServed: TOWNS.map((t) => ({
    "@type": "City",
    name: t.name,
    address: { "@type": "PostalAddress", addressRegion: "NC" },
  })),
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
    <html lang="en" className={`${franklin.variable} ${zilla.variable}`}>
      <body className="flex min-h-screen flex-col scroll-safe font-sans">
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
