import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#f7f8fc",
    description: SITE_DESCRIPTION,
    display: "standalone",
    icons: [
      {
        sizes: "any",
        src: "/brand/arcpass-favicon.svg",
        type: "image/svg+xml",
      },
    ],
    name: SITE_NAME,
    short_name: SITE_NAME,
    start_url: "/",
    theme_color: "#0052ff",
  };
}
