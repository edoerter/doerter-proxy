const PH_BASE = "https://api.pricehubble.com";
const PH_USER = "homea-ph-api";
const PH_PASS = "PsgXvbTNKL";

const DOERTER_LOGO = "https://images.squarespace-cdn.com/content/v1/6966679256607617c3d13b73/de0d3c50-8cef-41f6-b3be-bbfd33b3fa96/Design+ohne+Titel+%2812%29.png?format=300w";
const CALENDLY_URL = "https://calendly.com/erten-doerter/kostenlose-erstberatung-30-minuten-klon";

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

// ═══════ DOSSIER SHARING LINK ═══════
async function getDossierShareLink(dossierId, token) {
  try {
    const res = await fetch(`${PH_BASE}/api/v1/dossiers/${dossierId}/sharing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        dossierId,
        daysToLive: 90,
        countryCode: "DE",
        locale: "de",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.url || data.shareUrl || data.link || null;
    }
    console.log("Dossier sharing failed (non-critical):", res.status);
    return null;
  } catch (e) {
    console.log("Dossier sharing error (non-critical):", e.message);
    return null;
  }
}

// ═══════ E-MAIL: Benachrichtigung an DOERTER (info@doerter.com) ═══════
async function sendNotificationEmail(data) {
  const { firstName, lastName, email, phone,
    address, propType, dealType, area, year, rooms, dossierId, valuation, dossierShareLink } = data;

  const subject = `Neue Bewertungsanfrage: ${firstName} ${lastName} — ${address}`;

  let valuationText = "Bewertung: noch nicht verfügbar";
  if (valuation && valuation.value) {
    const fmt = (n) => new Intl.NumberFormat("de-DE").format(Math.round(n));
    valuationText = `Bewertung: ${fmt(valuation.value)} EUR (Spanne: ${fmt(valuation.valueRange.lower)} – ${fmt(valuation.valueRange.upper)} EUR)`;
  }

  const body = `
Neue Immobilienbewertungsanfrage über doerter.immobilien

KONTAKT
-------
Name:     ${firstName} ${lastName}
E-Mail:   ${email}
Telefon:  ${phone || "—"}

IMMOBILIE
---------
Typ:        ${propType}
Transaktion: ${dealType}
Adresse:    ${address}
Wohnfläche: ${area} m²
Baujahr:    ${year}
Zimmer:     ${rooms}

BEWERTUNG
---------
${valuationText}

PRICEHUBBLE
-----------
Dossier-ID:  ${dossierId || "—"}
Dashboard:   https://dash.pricehubble.com
Dossier-Link: ${dossierShareLink || "—"}

---
Automatisch gesendet von doerter.immobilien
`.trim();

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (process.env.RESEND_API_KEY || ""),
      },
      body: JSON.stringify({
        from: "Doerter Immobilien <bewertung@doerter.immobilien>",
        to: "info@doerter.com",
        subject,
        text: body,
      }),
    });
    console.log("Notification email sent:", emailRes.status);
  } catch (e) {
    console.log("Notification email error (non-critical):", e.message);
  }
}

// ═══════ E-MAIL: Bestätigung an den Kunden ═══════
async function sendCustomerEmail(data) {
  const { firstName, lastName, email, address, dealType, valuation, dossierShareLink } = data;

  const dealLabel = dealType === "sale" ? "Verkauf" : "Vermietung";

  let valuationHtml = "";
  if (valuation && valuation.value) {
    const fmt = (n) => new Intl.NumberFormat("de-DE").format(Math.round(n));
    valuationHtml = `
      <div style="background:#f5f0eb;border-radius:12px;padding:28px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#878787;margin:0 0 8px;">Erste Preisindikation (${dealLabel})</p>
        <p style="font-size:36px;font-weight:700;color:#34523A;margin:0;">${fmt(valuation.value)} &euro;</p>
        <p style="font-size:14px;color:#878787;margin:8px 0 0;">Spanne: ${fmt(valuation.valueRange.lower)} &ndash; ${fmt(valuation.valueRange.upper)} &euro;</p>
      </div>
      <p style="font-size:13px;color:#878787;margin:0 0 24px;text-align:center;">
        Diese Indikation basiert auf Marktdaten und ersetzt keine professionelle Bewertung vor Ort.
      </p>`;
  }

  let dossierLinkHtml = "";
  if (dossierShareLink) {
    dossierLinkHtml = `
      <div style="background:#f5f0eb;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#3D3833;margin:0 0 12px;">Ihr pers&ouml;nliches Bewertungsdossier:</p>
        <a href="${dossierShareLink}" style="font-size:15px;color:#34523A;font-weight:600;text-decoration:underline;">Dossier &ouml;ffnen &rarr;</a>
      </div>`;
  }

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f5f0eb;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background:#ffffff;border-radius:16px;padding:48px 36px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

      <div style="text-align:center;margin-bottom:32px;">
        <img src="${DOERTER_LOGO}" alt="DOERTER Immobilien" style="height:40px;width:auto;" />
      </div>

      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;width:48px;height:48px;background:#34523A;border-radius:50%;line-height:48px;font-size:24px;color:#fff;">&#10003;</div>
      </div>

      <h1 style="font-size:22px;font-weight:700;color:#2A2A2A;text-align:center;margin:0 0 8px;">
        Vielen Dank, ${firstName}!
      </h1>
      <p style="font-size:15px;color:#3D3833;text-align:center;line-height:1.6;margin:0 0 24px;">
        Wir haben Ihre Bewertungsanfrage f&uuml;r <strong>${address}</strong> erhalten.
      </p>

      ${valuationHtml}

      ${dossierLinkHtml}

      <h2 style="font-size:16px;font-weight:700;color:#2A2A2A;margin:32px 0 12px;">N&auml;chste Schritte</h2>
      <ol style="font-size:14px;color:#3D3833;line-height:1.8;padding-left:20px;margin:0 0 32px;">
        <li>Wir pr&uuml;fen Ihre Angaben und erstellen eine detaillierte Analyse.</li>
        <li>Innerhalb von <strong>24 Stunden</strong> erhalten Sie Ihre pers&ouml;nliche Bewertung.</li>
        <li>Bei Fragen stehen wir Ihnen jederzeit zur Verf&uuml;gung.</li>
      </ol>

      <div style="text-align:center;margin:24px 0 0;">
        <a href="https://doerter.com/privatverkauf-ousmexqg"
           style="display:inline-block;padding:14px 32px;background:#34523A;color:#ffffff;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">
          Verkaufsanalyse starten
        </a>
      </div>

      <div style="text-align:center;margin:16px 0 0;">
        <a href="${CALENDLY_URL}"
           style="display:inline-block;padding:14px 32px;background:#ffffff;color:#34523A;border:2px solid #34523A;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">
          Kostenlose Erstberatung buchen
        </a>
      </div>

    </div>

    <p style="font-size:12px;color:#878787;text-align:center;margin:24px 0 0;line-height:1.5;">
      DOERTER Immobilien &middot; doerter.immobilien<br>
      Diese E-Mail wurde automatisch versendet.
    </p>
  </div>
</body>
</html>`.trim();

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (process.env.RESEND_API_KEY || ""),
      },
      body: JSON.stringify({
        from: "Doerter Immobilien <bewertung@doerter.immobilien>",
        to: email,
        subject: `Ihre Bewertungsanfrage – ${address}`,
        html,
      }),
    });
    console.log("Customer email sent:", emailRes.status);
  } catch (e) {
    console.log("Customer email error (non-critical):", e.message);
  }
}

// ═══════ HANDLER ═══════
export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS")
    return { statusCode: 204, headers, body: "" };

  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };

  try {
    const { action, payload, contactData } = JSON.parse(event.body);

    // Nur E-Mail senden, kein PH-Aufruf
    if (action === "sendNotification") {
      await sendNotificationEmail(payload);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    const token = await getToken();

    // ═══════ NEUER FLOW: Dossier + Valuation + Sharing + E-Mails ═══════
    if (action === "createDossier") {
      // Schritt 1: Dossier erstellen
      const dossierRes = await fetch(`${PH_BASE}/api/v1/dossiers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });

      const dossierText = await dossierRes.text();
      let dossierData;
      try { dossierData = JSON.parse(dossierText); } catch (e) { dossierData = { raw: dossierText }; }

      if (!dossierRes.ok) {
        return { statusCode: dossierRes.status, headers, body: JSON.stringify({ error: dossierData }) };
      }

      const dossierId = dossierData.id || dossierData.dossierId;

      // Schritt 2: Valuation abrufen (optional)
      let valuation = null;
      try {
        const valRes = await fetch(`${PH_BASE}/api/v1/valuation/property_value`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          body: JSON.stringify({
            dossierId,
            dealType: payload.dealType || "sale",
            countryCode: payload.countryCode || "DE",
            currency: payload.currency || "EUR",
            valuationInputs: [{ property: payload.property }],
          }),
        });

        if (valRes.ok) {
          const valData = await valRes.json();
          if (valData.valuations && valData.valuations[0] && valData.valuations[0][0]) {
            valuation = valData.valuations[0][0];
          }
        } else {
          console.log("Valuation failed (non-critical):", valRes.status);
        }
      } catch (e) {
        console.log("Valuation error (non-critical):", e.message);
      }

      // Schritt 3: Dossier-Sharing-Link generieren (optional)
      let dossierShareLink = null;
      try {
        dossierShareLink = await getDossierShareLink(dossierId, token);
      } catch (e) {
        console.log("Dossier share link error (non-critical):", e.message);
      }

      // Schritt 4: E-Mails senden
      if (contactData) {
        const emailData = { ...contactData, dossierId, valuation, dossierShareLink };

        // Parallel: Benachrichtigung an DOERTER + Bestätigung an Kunden
        await Promise.all([
          sendNotificationEmail(emailData),
          sendCustomerEmail(emailData),
        ]);
      }

      // Schritt 5: Alles zurückgeben
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...dossierData,
          valuation,
          dossierShareLink,
        }),
      };
    }

    // Standalone Valuation (falls separat aufgerufen)
    if (action === "getValuation") {
      const phRes = await fetch(`${PH_BASE}/api/v1/valuation/property_value`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(payload),
      });

      const responseText = await phRes.text();
      let data;
      try { data = JSON.parse(responseText); } catch (e) { data = { raw: responseText }; }

      return {
        statusCode: phRes.ok ? 200 : phRes.status,
        headers,
        body: JSON.stringify(data),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unbekannte action: " + action }) };
  } catch (err) {
    console.log("Exception:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
