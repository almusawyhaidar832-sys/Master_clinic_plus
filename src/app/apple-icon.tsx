import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)",
          borderRadius: 36,
          color: "white",
          fontSize: 72,
          fontWeight: 700,
        }}
      >
        M+
      </div>
    ),
    { ...size }
  );
}
