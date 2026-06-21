export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, inviterEmail } = req.body;
  if (!email) return res.status(400).json({ error: "No email provided" });

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="margin:0;padding:0;background:#FFF1E5;font-family:Georgia,serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #CCC1B7;">
        <div style="background:#990F3D;padding:20px 28px;">
          <div style="color:#FFF1E5;font-size:18px;letter-spacing:0.14em;">PROVENANCE</div>
          <div style="color:#FFF1E5;font-size:9px;letter-spacing:0.2em;margin-top:3px;opacity:0.8;">COLLECTION · VALUE · INTELLIGENCE</div>
        </div>
        <div style="padding:32px 28px;">
          <p style="color:#33302E;font-size:16px;margin:0 0 8px;">You've been invited</p>
          <p style="color:#66605C;font-size:14px;line-height:1.7;margin:0 0 24px;">
            <strong style="color:#33302E;">${inviterEmail}</strong> has invited you to collaborate on Provenance — a private portfolio dashboard for art and collectible advisors.
          </p>
          <a href="https://providence-chi.vercel.app" style="display:inline-block;background:#990F3D;color:#FFF1E5;padding:12px 24px;text-decoration:none;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">
            Sign In to Provenance →
          </a>
          <p style="color:#999189;font-size:11px;margin:28px 0 0;line-height:1.6;">
            Sign in using your Google account at the link above.<br>
            You have been granted access to this workspace.
          </p>
        </div>
        <div style="background:#990F3D;padding:12px 28px;text-align:center;">
          <div style="color:#FFF1E5;font-size:9px;letter-spacing:0.14em;">PROVENANCE · COLLECTION VALUE INTELLIGENCE</div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer re_8qwpPbzM_NZqPVDA6b7K78awjUJiMZ5iV`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Provenance <onboarding@resend.dev>",
        to: [email],
        subject: `You've been invited to Provenance`,
        html,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(400).json({ error: data });
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
