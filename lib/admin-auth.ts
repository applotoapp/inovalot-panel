import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function equal(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function adminAuthorized(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return false;

  try {
    const credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const expected = `${process.env.ADMIN_USERNAME || "admin"}:${process.env.ADMIN_PASSWORD || ""}`;
    return equal(credentials, expected);
  } catch {
    return false;
  }
}
