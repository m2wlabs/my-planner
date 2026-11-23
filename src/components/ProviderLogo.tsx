import type { AiProviderKind } from "../lib/api";
import { findCatalogEntry } from "../lib/providerCatalog";
import { Icon } from "./ui";

export function ProviderLogo({
  catalogId,
  kind,
  size = 18,
  framed = true,
}: {
  catalogId?: string;
  kind?: AiProviderKind;
  size?: number;
  framed?: boolean;
}) {
  const entry = findCatalogEntry(catalogId, kind);
  const logo = entry?.logo ?? null;
  const accent = entry?.accent ?? "#5749f4";

  const glyph = logo ? (
    <span
      className="provider-logo-svg"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url(${logo})`,
        maskImage: `url(${logo})`,
      }}
      aria-hidden="true"
    />
  ) : (
    <Icon name="sliders" size={Math.max(13, size - 2)} />
  );

  if (!framed) return glyph;

  return (
    <span
      className="provider-logo-badge"
      style={{
        width: size + 14,
        height: size + 14,
        ["--provider-accent" as string]: accent,
      }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}
