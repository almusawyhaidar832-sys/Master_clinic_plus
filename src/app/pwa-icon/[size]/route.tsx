import { ImageResponse } from "next/og";

export const runtime = "edge";

const ALLOWED = new Set(["192", "512"]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ size: string }> }
) {
  const { size: sizeParam } = await context.params;
  const px = ALLOWED.has(sizeParam) ? Number(sizeParam) : 192;
  const fontSize = Math.round(px * 0.28);
  const radius = Math.round(px * 0.2);

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
          borderRadius: radius,
          color: "white",
          fontSize,
          fontWeight: 700,
        }}
      >
        M+
      </div>
    ),
    { width: px, height: px }
  );
}
