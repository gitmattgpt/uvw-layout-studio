import { createFileRoute } from "@tanstack/react-router";
import { UVWEditor } from "../components/uvw/UVWEditor";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [
    { title: "UVW Mapping Tool — Browser UV Editor" },
    { name: "description", content: "Import OBJ and GLB models, generate UV coordinates, preview textures, and export your work." },
    { property: "og:title", content: "UVW Mapping Tool — Browser UV Editor" },
    { property: "og:description", content: "A focused browser workspace for model import, UV mapping, texture preview, and export." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: UVWEditor,
});
