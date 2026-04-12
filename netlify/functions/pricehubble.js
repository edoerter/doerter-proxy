// ═══════════════════════════════════════════════════════════════════════
// DOERTER Immobilienbewertung — Netlify Function v4
//
// Ablauf:
//   Schritt 1 (sofort): Dossier + Valuation + Sofort-E-Mail + Pipedrive
//   Schritt 2 (Background): send-dossier-background.js rendert PH-PDF,
//             baut Broschüre + Bewertungsseite, sendet E-Mail (12 Min delay)
//
// Architektur:
//   - Diese Funktion: leichtgewichtig, antwortet sofort
//   - Background Function: schwer (Puppeteer + PDF-Merge), bis 15 Min
// ═══════════════════════════════════════════════════════════════════════

// ═══════ CONFIG ═══════
const PH_BASE = "https://api.pricehubble.com";
const PH_USER = "homea-ph-api";
const PH_PASS = "PsgXvbTNKL";

const DOERTER_LOGO =
  "https://images.squarespace-cdn.com/content/v1/6966679256607617c3d13b73/de0d3c50-8cef-41f6-b3be-bbfd33b3fa96/Design+ohne+Titel+%2812%29.png?format=300w";
const CALENDLY_URL =
  "https://calendly.com/erten-doerter/kostenlose-erstberatung-30-minuten-klon";

// ═══════ HELPERS ═══════
const fmt = (n) => new Intl.NumberFormat("de-DE").format(Math.round(n));

// ═══════ PRICEHUBBLE AUTH ═══════
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
    const res = await fetch(`${PH_BASE}/api/v1/dossiers/links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        dossierId,
        daysToLive: 90,
        countryCode: "DE",
        locale: "de_DE",
        canGeneratePdf: true,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.url || null;
    }
    console.log("Sharing failed:", res.status, await res.text());
    return null;
  } catch (e) {
    console.log("Sharing error:", e.message);
    return null;
  }
}

// ═══════ DOSSIER VALUATION ═══════
async function getDossierValuation(dossierId, dealType, token) {
  try {
    const res = await fetch(`${PH_BASE}/api/v1/dossiers/${dossierId}/valuation`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) {
      console.log("Valuation failed:", res.status);
      return null;
    }
    const data = await res.json();
    const isRent = dealType === "rent" || dealType === "Vermietung";
    const raw = isRent
      ? data.valuationRentGross || data.valuationRentNet
      : data.valuationSale;
    if (raw && raw.value) {
      return {
        value: raw.value,
        valueRange: raw.valueRange || { lower: raw.value * 0.9, upper: raw.value * 1.1 },
        confidence: raw.valuationConfidence || "unknown",
        date: raw.valuationDate || new Date().toISOString().split("T")[0],
      };
    }
    return null;
  } catch (e) {
    console.log("Valuation error:", e.message);
    return null;
  }
}

// ═══════ PIPEDRIVE: Person + Lead anlegen ═══════
async function createPipedriveLead(data) {
  const apiKey = process.env.PIPEDRIVE_API_KEY;
  if (!apiKey) {
    console.log("Pipedrive: Kein API-Key, überspringe");
    return null;
  }

  const {
    firstName, lastName, email, phone,
    address, propType, dealType, area, year, rooms,
    dossierId, valuation, dossierShareLink,
  } = data;

  const pipBase = "https://api.pipedrive.com/v1";
  const headers = { "Content-Type": "application/json" };
  const qs = `?api_token=${apiKey}`;

  try {
    // 1. Person anlegen
    const personRes = await fetch(`${pipBase}/persons${qs}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: `${firstName} ${lastName}`,
        email: [{ value: email, primary: true }],
        phone: phone ? [{ value: phone, primary: true }] : undefined,
      }),
    });
    const personText = await personRes.text();
    if (!personRes.ok) {
      console.log("Pipedrive Person FEHLER:", personRes.status, personText);
      return null;
    }
    const personData = JSON.parse(personText);
    const personId = personData?.data?.id;
    console.log("Pipedrive Person:", personId);

    // 2. Lead-Label "Bewertung" holen oder anlegen
    let labelId = null;
    try {
      const labelsRes = await fetch(`${pipBase}/leadLabels${qs}`);
      const labelsData = await labelsRes.json().catch(() => ({}));
      const existing = (labelsData?.data || []).find(l => l.name === "Bewertung");
      if (existing) {
        labelId = existing.id;
      } else {
        const createLabelRes = await fetch(`${pipBase}/leadLabels${qs}`, {
          method: "POST", headers,
          body: JSON.stringify({ name: "Bewertung", color: "green" }),
        });
        const newLabel = await createLabelRes.json().catch(() => ({}));
        labelId = newLabel?.data?.id || null;
      }
      console.log("Pipedrive Label:", labelId ? labelId : "nicht verfügbar");
    } catch (labelErr) {
      console.log("Pipedrive Label error:", labelErr.message);
    }

    // 3. Lead anlegen (Leads landen im Leads-Inbox)
    let valuationNote = "Bewertung: nicht verfügbar";
    if (valuation) {
      const suffix = dealType === "rent" || dealType === "Vermietung" ? " EUR/Monat" : " EUR";
      valuationNote = `Bewertung: ${fmt(valuation.value)}${suffix} (${fmt(valuation.valueRange.lower)} – ${fmt(valuation.valueRange.upper)}${suffix})`;
    }

    const noteContent = [
      `Immobilienbewertung via privatverkaufen.de`,
      ``,
      `Immobilie:`,
      `Adresse: ${address}`,
      `Typ: ${propType} | Transaktion: ${dealType}`,
      `Fläche: ${area} m² | Baujahr: ${year} | Zimmer: ${rooms}`,
      ``,
      `${valuationNote}`,
      `Confidence: ${valuation?.confidence || "—"}`,
      ``,
      `PriceHubble:`,
      `Dossier-ID: ${dossierId || "—"}`,
      `Dossier-Link: ${dossierShareLink || "—"}`,
    ].join("\n");

    const leadBody = {
      title: `Bewertung: ${address}`,
      person_id: personId,
    };
    if (labelId) {
      leadBody.label_ids = [labelId];
    }
    if (valuation) {
      leadBody.value = { amount: valuation.value, currency: "EUR" };
    }

    const leadRes = await fetch(`${pipBase}/leads${qs}`, {
      method: "POST",
      headers,
      body: JSON.stringify(leadBody),
    });
    const leadText = await leadRes.text();
    if (!leadRes.ok) {
      console.log("Pipedrive Lead FEHLER:", leadRes.status, leadText);
      return null;
    }
    const leadData = JSON.parse(leadText);
    const leadId = leadData?.data?.id;
    console.log("Pipedrive Lead:", leadId);

    // 4. Note zum Lead hinzufügen (Leads API hat kein note-Feld)
    try {
      await fetch(`${pipBase}/notes${qs}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          lead_id: leadId,
          content: noteContent,
        }),
      });
      console.log("Pipedrive Note: erstellt");
    } catch (noteErr) {
      console.log("Pipedrive Note error:", noteErr.message);
    }

    return { personId, leadId };
  } catch (e) {
    console.log("Pipedrive error (non-critical):", e.message);
    return null;
  }
}

// ═══════ BACKGROUND FUNCTION TRIGGER ═══════
async function triggerDossierBackground(data) {
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || "https://doerter-bewertung.netlify.app";
  const bgUrl = `${siteUrl}/.netlify/functions/send-dossier-background`;

  try {
    const res = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    console.log("Background Function getriggert:", res.status);
    return res.status === 202 || res.ok;
  } catch (e) {
    console.log("Background Function trigger error:", e.message);
    return false;
  }
}

// ═══════ E-MAIL 1: Sofortige Bestätigung (kurz, mit Preis) ═══════
async function sendImmediateEmail(data) {
  const { firstName, email, address, dealType, valuation } = data;

  const isRent = dealType === "rent" || dealType === "Vermietung";
  const unitLabel = isRent ? "&euro; / Monat" : "&euro;";

  let valuationHtml = "";
  if (valuation) {
    valuationHtml = `
      <div style="background:#f5f0eb;border-radius:12px;padding:28px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#878787;margin:0 0 8px;">Erste Preisindikation</p>
        <p style="font-size:36px;font-weight:700;color:#34523A;margin:0;">${fmt(valuation.value)} ${unitLabel}</p>
        <p style="font-size:14px;color:#878787;margin:8px 0 0;">Spanne: ${fmt(valuation.valueRange.lower)} &ndash; ${fmt(valuation.valueRange.upper)} ${unitLabel}</p>
      </div>`;
  }

  const html = `
<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f5f0eb;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background:#fff;border-radius:16px;padding:48px 36px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <div style="text-align:center;margin-bottom:32px;">
        <img src="${DOERTER_LOGO}" alt="DOERTER" style="height:40px;width:auto;" />
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
      <p style="font-size:13px;color:#878787;text-align:center;margin:0 0 24px;">
        In K&uuml;rze erhalten Sie Ihr ausf&uuml;hrliches Bewertungsdossier per E-Mail.
      </p>
    </div>
    <p style="font-size:12px;color:#878787;text-align:center;margin:24px 0 0;">
      DOERTER &middot; privatverkaufen.de
    </p>
  </div>
</body></html>`.trim();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (process.env.RESEND_API_KEY || ""),
      },
      body: JSON.stringify({
        from: "DOERTER <bewertung@doerter.immobilien>",
        to: email,
        subject: `Ihre Bewertung: ${address} – ${valuation ? fmt(valuation.value) + " EUR" : "wird erstellt"}`,
        html,
      }),
    });
    console.log("Sofort-E-Mail gesendet:", res.status);
  } catch (e) {
    console.log("Sofort-E-Mail error:", e.message);
  }
}

// ═══════ E-MAIL: Interne Benachrichtigung an DOERTER ═══════
async function sendNotificationEmail(data) {
  const {
    firstName, lastName, email, phone,
    address, propType, dealType, area, year, rooms,
    dossierId, valuation, dossierShareLink,
  } = data;

  const subject = `Neue Bewertungsanfrage: ${firstName} ${lastName} \u2014 ${address}`;

  let valuationText = "Bewertung: noch nicht verf\u00FCgbar";
  if (valuation) {
    const suffix = dealType === "Vermietung" || dealType === "rent" ? " EUR/Monat" : " EUR";
    valuationText = `Bewertung: ${fmt(valuation.value)}${suffix} (${fmt(valuation.valueRange.lower)} \u2013 ${fmt(valuation.valueRange.upper)}${suffix})`;
  }

  const body = `
Neue Immobilienbewertungsanfrage \u00FCber privatverkaufen.de

KONTAKT: ${firstName} ${lastName} | ${email} | ${phone || "\u2014"}
IMMOBILIE: ${propType} | ${dealType} | ${address} | ${area} m\u00B2 | Bj. ${year} | ${rooms} Zi.
${valuationText}
Dossier-ID: ${dossierId || "\u2014"}
Dossier-Link: ${dossierShareLink || "\u2014"}
Dashboard: https://dash.pricehubble.com`.trim();

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (process.env.RESEND_API_KEY || ""),
      },
      body: JSON.stringify({
        from: "DOERTER <bewertung@doerter.immobilien>",
        to: "info@doerter.com",
        subject,
        text: body,
      }),
    });
  } catch (e) {
    console.log("Notification error:", e.message);
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

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };

  try {
    const { action, payload, contactData } = JSON.parse(event.body);

    if (action === "sendNotification") {
      await sendNotificationEmail(payload);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    const token = await getToken();

    // ═══════ HAUPTFLOW: Zwei-Stufen-Prozess ═══════
    if (action === "createDossier") {
      const { dealType: _dt, currency: _c, ...dossierPayload } = payload;

      // ── SCHRITT 1: Dossier + Valuation + Sofort-E-Mail + Pipedrive ──

      // 1a. Dossier erstellen
      const dossierRes = await fetch(`${PH_BASE}/api/v1/dossiers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify(dossierPayload),
      });
      const dossierText = await dossierRes.text();
      let dossierData;
      try { dossierData = JSON.parse(dossierText); } catch (e) { dossierData = { raw: dossierText }; }
      if (!dossierRes.ok) {
        return { statusCode: dossierRes.status, headers, body: JSON.stringify({ error: dossierData }) };
      }
      const dossierId = dossierData.id || dossierData.dossierId;
      console.log("Dossier:", dossierId);

      // 1b. Valuation
      const valuation = await getDossierValuation(dossierId, payload.dealType || "sale", token);
      console.log("Valuation:", valuation ? `${fmt(valuation.value)} EUR` : "n/a");

      // 1c. Sharing-Link
      const dossierShareLink = await getDossierShareLink(dossierId, token);
      console.log("Share-Link:", dossierShareLink ? "OK" : "n/a");

      // 1d. Sofort-E-Mail an Kunden + Benachrichtigung an DOERTER
      if (contactData) {
        const emailData = { ...contactData, dossierId, valuation, dossierShareLink };
        await Promise.all([
          sendImmediateEmail(emailData),
          sendNotificationEmail(emailData),
        ]);

        // 1e. Pipedrive (muss awaited werden, sonst terminiert Netlify die Funktion vorher)
        try {
          await createPipedriveLead(emailData);
        } catch (e) {
          console.log("Pipedrive error (non-critical):", e.message);
        }
      }

      // ── SCHRITT 2: Background Function triggern ──
      if (contactData) {
        const bgData = { ...contactData, dossierId, valuation, dossierShareLink };
        const bgTriggered = await triggerDossierBackground(bgData);
        console.log("Background Function:", bgTriggered ? "gestartet" : "fehlgeschlagen");
      }

      // Response
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...dossierData,
          valuation,
          dossierShareLink,
          dossierEmailScheduled: true,
        }),
      };
    }

    // Standalone Valuation (Legacy/Fallback)
    if (action === "getValuation") {
      const phRes = await fetch(`${PH_BASE}/api/v1/valuation/property_value`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(payload),
      });
      const responseText = await phRes.text();
      let data;
      try { data = JSON.parse(responseText); } catch (e) { data = { raw: responseText }; }
      return { statusCode: phRes.ok ? 200 : phRes.status, headers, body: JSON.stringify(data) };
    }
return { statusCode: 400, headers, body: JSON.stringify({ error: "Unbekannte action: " + action }) };
  } catch (err) {
    console.log("Exception:", err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
