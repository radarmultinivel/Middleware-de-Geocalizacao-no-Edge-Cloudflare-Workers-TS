// Desenvolvido por L. A. Leandro - São José dos Campos - SP - 25/05/2026

async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signGeoPayload(
  payload: string,
  secret: string | undefined,
): Promise<string> {
  if (!secret) return "unsigned";
  return hmacSha256(secret, payload);
}
