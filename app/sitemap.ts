import type { MetadataRoute } from "next";
import { BUSINESS } from "@/lib/constants";
import { TOWNS } from "@/lib/towns";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = BUSINESS.siteUrl.replace(/\/$/, "");
  const lastModified = new Date();
  const routes = [
    "",
    "/services",
    "/about",
    "/contact",
    ...TOWNS.map((t) => `/handyman/${t.slug}`),
  ];
  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified,
    changeFrequency: "monthly",
    priority: route === "" ? 1 : 0.8,
  }));
}
