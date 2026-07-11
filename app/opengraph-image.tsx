import { ImageResponse } from "next/og";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export const alt = "ArcPass verified stablecoin checkout preview";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#f7f8fc",
          color: "#080b1a",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          justifyContent: "space-between",
          padding: "58px 66px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background:
              "radial-gradient(circle at 20% 15%, rgba(0,82,255,0.25), transparent 30%), radial-gradient(circle at 78% 20%, rgba(111,196,255,0.28), transparent 34%), radial-gradient(circle at 86% 78%, rgba(255,198,222,0.3), transparent 30%)",
            bottom: "-120px",
            filter: "blur(6px)",
            left: "-120px",
            position: "absolute",
            right: "-120px",
            top: "-120px",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div
              style={{
                color: "#0052ff",
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: 0,
              }}
            >
              {SITE_NAME}
            </div>
            <div style={{ color: "#3e4659", fontSize: 22 }}>Verified stablecoin checkout</div>
          </div>
          <div
            style={{
              background: "#080b1a",
              borderRadius: 999,
              color: "#ffffff",
              fontSize: 22,
              fontWeight: 800,
              padding: "14px 22px",
            }}
          >
            Arc Testnet
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px", position: "relative" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: 82,
              fontWeight: 900,
              letterSpacing: 0,
              lineHeight: 0.95,
              maxWidth: 900,
            }}
          >
            Trust-first payment links on Arc.
          </div>
          <div
            style={{
              color: "#3e4659",
              display: "flex",
              fontSize: 28,
              lineHeight: 1.35,
              maxWidth: 760,
            }}
          >
            {SITE_DESCRIPTION}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "14px",
            position: "relative",
          }}
        >
          {["Passport", "Domain", "Invoice hash", "Receipt"].map((item) => (
            <div
              key={item}
              style={{
                background: "rgba(255,255,255,0.72)",
                border: "1px solid #dbe2ef",
                borderRadius: 12,
                color: "#080b1a",
                fontSize: 22,
                fontWeight: 800,
                padding: "16px 20px",
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
