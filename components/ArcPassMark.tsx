import Image from "next/image";

type ArcPassMarkProps = {
  className?: string;
  compact?: boolean;
  tone?: "dark" | "light";
};

export function ArcPassMark({ className = "", compact = false, tone = "light" }: ArcPassMarkProps) {
  const src = compact
    ? "/brand/arcpass-favicon.svg"
    : tone === "dark"
      ? "/brand/arcpass-logo-dark.svg"
      : "/brand/arcpass-logo-light.svg";

  return (
    <span className={`arcpass-mark ${compact ? "arcpass-mark-compact" : ""} ${className}`} aria-label="ArcPass">
      <Image
        alt="ArcPass"
        className="arcpass-mark-image"
        height={compact ? 44 : 92}
        priority={!compact}
        src={src}
        unoptimized
        width={compact ? 44 : 92}
      />
    </span>
  );
}
