const PH_BASE = "https://api.pricehubble.com";
const PH_USER = "homea-ph-api";
const PH_PASS = "PsgXvbTNKL";

async function getToken() {
  const res = await fetch(`${PH_BASE}/auth/login/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: PH_USER, password: PH_PASS }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Auth fehlgeschlagen: " + res.status + " " + text);
  return JSON.parse(text).access_token;
}

async function sendNotificationEmail(data) {
  const { firstName, lastName, email, phone, address, propType, dealType, area, year, rooms, dossierId } = data;
  
  // Nutze Netlify's eingebauten Email-Service via fetch an eine mailto-kompatible API
  // Wir bauen eine einfache HTML-Email zusammen
  const subject = `Neue Bewertungsanfrage: ${firstName} ${lastName} — ${address}`;
  const body = `
Neue Immobilienbewertungsanfrage über doerter.immobilien

KONTAKT
-------
Name: ${firstName} ${lastName}
E-Mail: ${email}
Telefon: ${phone || '—'}

IMMOBILIE
---------
Typ: ${propType}
Transaktion: ${dealType}
Adresse: ${address}
Wohnfläche: ${area} m²
Baujahr: ${year}
Zimmer: ${rooms}

PRICEHUBBLE
-----------
Dossier-ID: ${dossierId || '—'}
Dashboard: https://dash.pricehubble.com

---
Automatisch gesendet von doerter.immobilien
  `.trim();

  // Sende über Netlify Forms Email (via fetch zu einem einfachen mailto-Endpunkt)
  // Wir nutzen hier den kostenlosen Resend.com API (oder falls nicht verfügbar: loggen wir nur)
  console.log("EMAIL NOTIFICATION:", subject);
  console.log(body);
  
  // Versuche Resend API (kostenlos bis 3000/Monat)
  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (process.env.RESEND_API_KEY || ""),
      },
      body: JSON.stringify({
        from: "bewertung@doerter.immobilien",
        to: "info@doerter.com",
        subject,
        text: body,
      }),
    });
    console.log("Email sent:", emailRes.status);
  } catch(e) {
    console.log("Email error (non-critical):", e.message);
  }
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };

  try {
    const { action, payload, contactData } = JSON.parse(event.body);

    // Nur E-Mail senden, kein PH-Aufruf
    if (action === "sendNotification") {
      await sendNotificationEmail(payload);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    const token = await getToken();

    let endpoint;
    if (action === "createDossier") endpoint = "/api/v1/dossiers";
    else if (action === "getValuation") endpoint = "/api/v1/valuation/property_value";
    else return { statusCode: 400, headers, body: JSON.stringify({ error: "Unbekannte action: " + action }) };

    const phRes = await fetch(`${PH_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(payload),
    });

    const responseText = await phRes.text();
    let data;
    try { data = JSON.parse(responseText); } catch(e) { data = { raw: responseText }; }

    // Bei erfolgreichem Dossier: E-Mail senden
    if (phRes.ok && action === "createDossier" && contactData) {
      await sendNotificationEmail({ ...contactData, dossierId: data.id || data.dossierId });
    }

    if (!phRes.ok) {
      return { statusCode: phRes.status, headers, body: JSON.stringify({ error: data }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.log("Exception:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
