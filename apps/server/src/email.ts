/**
 * Magic-link delivery via Resend free tier.
 * Without RESEND_API_KEY: no network call — caller surfaces devMagicUrl.
 */

export interface SendMagicLinkResult {
  emailed: boolean;
  provider?: "resend";
  error?: string;
}

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function resendFrom(): string {
  return (
    process.env.RESEND_FROM?.trim() ||
    "Starhold <onboarding@resend.dev>"
  );
}

export async function sendMagicLinkEmail(opts: {
  to: string;
  magicUrl: string;
}): Promise<SendMagicLinkResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { emailed: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom(),
        to: [opts.to],
        subject: "Your Starhold sign-in link",
        text: [
          "Sign in to Starhold (link expires in 15 minutes):",
          "",
          opts.magicUrl,
          "",
          "If you did not request this, ignore this email.",
        ].join("\n"),
        html: `<p>Sign in to <strong>Starhold</strong> (expires in 15 minutes):</p><p><a href="${opts.magicUrl}">${opts.magicUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[starhold-auth] Resend error", res.status, body);
      return {
        emailed: false,
        provider: "resend",
        error: `Resend ${res.status}`,
      };
    }
    return { emailed: true, provider: "resend" };
  } catch (err) {
    console.error("[starhold-auth] Resend fetch failed", err);
    return {
      emailed: false,
      provider: "resend",
      error: err instanceof Error ? err.message : "send failed",
    };
  }
}
