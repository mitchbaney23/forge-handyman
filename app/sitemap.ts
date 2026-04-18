import type { MetadataRoute } from "next";
import { BUSINESS } from "@/lib/constants";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = BUSINESS.siteUrl.replace(/\/$/, "");
  const lastModified = new Date();
  const routes = ["", "/services", "/about", "/service-area", "/contact"];
  return routes.map((route) => ({
    url: `${base}${route}`,
    lastModified,
    changeFrequency: "monthly",
    priority: route === "" ? 1 : 0.8,
  }));
}
