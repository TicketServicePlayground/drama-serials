import manifest from "./images.json";

/** Everything an <img> needs to load the right CDN variant. Serializable, so it can go to client components. */
export interface ImageRef {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  /** Tiny inline webp shown until the real image arrives. */
  blur: string;
}

interface ManifestEntry {
  src: string;
  widths: number[];
  aspect: number;
  blur: string;
}

const entries = manifest as Record<string, ManifestEntry>;

/** `id` is the path in assets/ without extension, e.g. `covers/contract-bride`. */
export function imageRef(id: string): ImageRef | null {
  const entry = entries[id];
  if (!entry) return null;
  const url = (width: number) => entry.src.replace("{w}", String(width));
  const largest = entry.widths.at(-1)!;
  return {
    src: url(largest),
    srcSet: entry.widths.map((width) => `${url(width)} ${width}w`).join(", "),
    width: largest,
    height: Math.round(largest / entry.aspect),
    blur: entry.blur,
  };
}

export const CDN_ORIGIN = "https://cdn.affinet.link";
