import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.WHATSAPP_API_URL;

  if (!apiUrl) {
    return NextResponse.json({
      linked: false,
      qr: null,
      message: "لم يتم تكوين WHATSAPP_API_URL",
    });
  }

  try {
    const res = await fetch(`${apiUrl}/instance/qr`, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_API_SECRET}`,
      },
    });
    const data = await res.json();
    return NextResponse.json({
      linked: data.status === "connected",
      qr: data.qr || data.base64,
    });
  } catch {
    return NextResponse.json({ linked: false, qr: null });
  }
}
