import type { CSSProperties } from "react";
import { useCompanyName } from "../../theme/BrandingProvider";

/**
 * A small sample of the chosen colours. The two custom properties are set with the React style
 * prop (CSSOM, allowed by the CSP) on this element only, so the real app theme never changes
 * before saving.
 */
export function ThemePreview({ primary, accent }: { primary: string; accent: string }) {
  const name = useCompanyName();
  const vars = { "--jp-primary": primary, "--jp-accent": accent } as CSSProperties;
  return (
    <div
      className="preview"
      style={vars}
      role="img"
      aria-label="Preview of the header, a button, a link and a focused field in the chosen colours"
      data-testid="theme-preview"
      data-primary={primary}
      data-accent={accent}
    >
      <div className="preview-header">{name ?? "Your company"}</div>
      <div className="preview-body">
        <span className="btn btn-primary">Primary button</span>
        <span className="preview-link">A link</span>
        <span className="preview-input">Focused field</span>
      </div>
    </div>
  );
}
