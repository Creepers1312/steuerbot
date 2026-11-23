import { NextResponse } from "next/server";
import { SITZUNGS_COOKIE } from "@/lib/sicherheit/sitzung";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SITZUNGS_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
