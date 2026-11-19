import type { ImageRef } from "@/lib/images";

/**
 * Responsive CDN image: the browser picks the variant from `sizes`, a blurred
 * 16px placeholder fills the box until it loads, and the box keeps its size.
 */
export function CdnImage({ image, sizes, priority = false, className = "" }: {
  image: ImageRef | null;
  sizes: string;
  /** Above-the-fold images: load eagerly with high fetch priority. */
  priority?: boolean;
  className?: string;
}) {
  if (!image) return <span aria-hidden className={`block bg-surface-secondary ${className}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- variants are pre-built on the CDN
    <img
      src={image.src}
      srcSet={image.srcSet}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt=""
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      style={{ backgroundImage: `url(${image.blur})`, backgroundSize: "cover", backgroundPosition: "center" }}
      className={className}
    />
  );
}
