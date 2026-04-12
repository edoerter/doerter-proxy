// ═══════════════════════════════════════════════════════════════════════
// DOERTER — Background Function: PH-PDF rendern + Dossier-E-Mail senden
//
// Wird von pricehubble.js getriggert. Läuft im Hintergrund (bis 15 Min).
// 1. PriceHubble Dash PDF via Puppeteer rendern
// 2. In DOERTER-Broschüre einbetten (mit Bewertungsseite)
// 3. E-Mail mit Resend scheduledAt versenden (12 Min verzögert)
// ═══════════════════════════════════════════════════════════════════════

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { readFileSync } from "fs";
import { resolve } from "path";

// ═══════ CONFIG ═══════
const PH_BASE = "https://api.pricehubble.com";
const PH_USER = "homea-ph-api";
const PH_PASS = "PsgXvbTNKL";
const DELAY_MINUTES = 12;
const INSERT_AFTER_PAGE = 11;

const DOERTER_LOGO =
  "https://images.squarespace-cdn.com/content/v1/6966679256607617c3d13b73/de0d3c50-8cef-41f6-b3be-bbfd33b3fa96/Design+ohne+Titel+%2812%29.png?format=300w";
const CALENDLY_URL =
  "https://calendly.com/erten-doerter/kostenlose-erstberatung-30-minuten-klon";

// Farben
const COLOR_BEIGE = rgb(0.941, 0.922, 0.894);
const COLOR_GREEN = rgb(0.204, 0.322, 0.227);
const COLOR_DARK = rgb(0.165, 0.165, 0.165);
const COLOR_GRAY = rgb(0.529, 0.529, 0.529);
const COLOR_TAUPE = rgb(0.765, 0.741, 0.71);
const COLOR_WHITE = rgb(1, 1, 1);

const fmt = (n) => new Intl.NumberFormat("de-DE").format(Math.round(n));

// ═══════ PH Auth ═══════
async function getToken() {
  const res = await fetch(`${PH_BASE}/auth/login/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: PH_USER, password: PH_PASS }),
  });
  if (!res.ok) throw new Error("Auth failed: " + res.status);
  return (await res.json()).access_token;
}

// ═══════ PH Dossier PDF via Puppeteer rendern ═══════
async function renderPriceHubblePdf(dossierId, dealType, token) {
  let browser = null;
  try {
    console.log("Puppeteer: Starting browser...");
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1200, height: 1600 },
      executablePath: await chromium.executablePath(),
      headless: "new",
    });

    const page = await browser.newPage();

    // Dash PDF Report URL (funktioniert ohne templateId)
    const pdfReportUrl =
      `https://dash.pricehubble.com/pdf-report?access_token=${token}&data=` +
      encodeURIComponent(
        JSON.stringify({
          dossierId,
          dealType: dealType || "sale",
          language: "de_DE",
        })
      );

    console.log("Puppeteer: Loading PH PDF Report...");
    await page.goto(pdfReportUrl, { waitUntil: "networkidle2", timeout: 60000 });

    // Warten bis PriceHubble das PDF als "ready" markiert
    try {
      await page.waitForSelector("body.pdfIsReady", { timeout: 30000 });
      console.log("Puppeteer: pdfIsReady detected");
    } catch (_) {
      // Fallback: einfach etwas warten
      console.log("Puppeteer: pdfIsReady not found, waiting 10s...");
      await new Promise((r) => setTimeout(r, 10000));
    }

    // PDF rendern
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
    });

    console.log("Puppeteer: PDF rendered,", Math.round(pdfBuffer.length / 1024), "KB");
    return pdfBuffer;
  } catch (e) {
    console.log("Puppeteer error:", e.message);
    return null;
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

// ═══════ Bewertungsseite erstellen (wie in pricehubble.js) ═══════
async function createValuationPage(doc, data) {
  const { address, propType, dealType, area, year, rooms, valuation } = data;
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const refPage = doc.getPage(0);
  const { width, height } = refPage.getSize();
  const page = doc.insertPage(INSERT_AFTER_PAGE, [width, height]);
  const centerX = width / 2;
  const isRent = dealType === "rent" || dealType === "Vermietung";
  const unitLabel = isRent ? "EUR / Monat" : "EUR";

  // Hintergrund
  page.drawRectangle({ x: 0, y: 0, width, height, color: COLOR_BEIGE });

  // Grünes Quadrat oben rechts
  page.drawRectangle({ x: width - 85, y: height - 95, width: 42, height: 42, color: COLOR_GREEN });

  // Subtitle
  const subtitle = "Ihre individuelle Immobilienbewertung";
  const stW = helvetica.widthOfTextAtSize(subtitle, 12);
  page.drawText(subtitle, { x: width - stW - 55, y: height - 140, size: 12, font: helvetica, color: COLOR_DARK });
  page.drawLine({ start: { x: width - 150, y: height - 158 }, end: { x: width - 55, y: height - 158 }, thickness: 1, color: COLOR_DARK });

  // Adresse
  const addressText = address || "Adresse nicht verf\u00FCgbar";
  const addrW = helveticaBold.widthOfTextAtSize(addressText, 16);
  page.drawText(addressText, { x: centerX - addrW / 2, y: height - 260, size: 16, font: helveticaBold, color: COLOR_DARK });

  // Details
  const parts = [propType, area ? `${area} m\u00B2` : null, rooms ? `${rooms} Zimmer` : null, year ? `Baujahr ${year}` : null].filter(Boolean);
  const detailText = parts.join("  \u2022  ");
  const detW = helvetica.widthOfTextAtSize(detailText, 11);
  page.drawText(detailText, { x: centerX - detW / 2, y: height - 285, size: 11, font: helvetica, color: COLOR_GRAY });

  // Trennlinie
  page.drawLine({ start: { x: centerX - 80, y: height - 310 }, end: { x: centerX + 80, y: height - 310 }, thickness: 0.5, color: COLOR_TAUPE });

  if (valuation) {
    const label = isRent ? "Mietpreisindikation" : "Marktwertindikation";
    const labW = helvetica.widthOfTextAtSize(label, 13);
    page.drawText(label, { x: centerX - labW / 2, y: height - 350, size: 13, font: helvetica, color: COLOR_GRAY });

    // Preis-Box
    const pbW = 380, pbH = 100, pbX = centerX - pbW / 2, pbY = height - 480;
    page.drawRectangle({ x: pbX, y: pbY, width: pbW, height: pbH, color: COLOR_GREEN });
    const priceText = `${fmt(valuation.value)} ${unitLabel}`;
    const prW = helveticaBold.widthOfTextAtSize(priceText, 36);
    page.drawText(priceText, { x: centerX - prW / 2, y: pbY + 35, size: 36, font: helveticaBold, color: COLOR_WHITE });

    // Bandbreite
    const rl = "Realistische Bandbreite";
    page.drawText(rl, { x: centerX - helvetica.widthOfTextAtSize(rl, 12) / 2, y: height - 520, size: 12, font: helvetica, color: COLOR_GRAY });
    const rbW = 340, rbH = 60, rbX = centerX - rbW / 2, rbY = height - 600;
    page.drawRectangle({ x: rbX, y: rbY, width: rbW, height: rbH, color: COLOR_TAUPE });
    const rangeText = `${fmt(valuation.valueRange.lower)}  \u2013  ${fmt(valuation.valueRange.upper)} ${unitLabel}`;
    const rW = helveticaBold.widthOfTextAtSize(rangeText, 20);
    page.drawText(rangeText, { x: centerX - rW / 2, y: rbY + 20, size: 20, font: helveticaBold, color: COLOR_WHITE });

    const confMap = { good: "Hoch", medium: "Mittel", low: "Gering" };
    const conf = `Datenqualit\u00E4t: ${confMap[valuation.confidence] || valuation.confidence}`;
    page.drawText(conf, { x: centerX - helvetica.widthOfTextAtSize(conf, 10) / 2, y: height - 630, size: 10, font: helvetica, color: COLOR_GRAY });
  }

  // Footer
  const dateStr = valuation?.date
    ? new Date(valuation.date).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" })
    : new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  const dateText = `Stand: ${dateStr}`;
  page.drawText(dateText, { x: centerX - helvetica.widthOfTextAtSize(dateText, 10) / 2, y: 120, size: 10, font: helvetica, color: COLOR_GRAY });
  const disc = "Diese Indikation basiert auf Marktdaten und ersetzt keine professionelle Bewertung vor Ort.";
  page.drawText(disc, { x: centerX - helvetica.widthOfTextAtSize(disc, 9) / 2, y: 95, size: 9, font: helvetica, color: COLOR_GRAY });
  const src = "Datenquelle: PriceHubble \u00B7 DOERTER Immobilien";
  page.drawText(src, { x: centerX - helvetica.widthOfTextAtSize(src, 9) / 2, y: 75, size: 9, font: helvetica, color: COLOR_GRAY });
}

// ═══════ Alles zusammenfügen: Broschüre + Bewertung + PH-Dossier ═══════
async function buildFinalPdf(data, phPdfBuffer) {
  // 1. Template laden
  let templateBytes;
  try {
    templateBytes = readFileSync(resolve(process.cwd(), "assets/template.pdf"));
  } catch (_) {
    templateBytes = readFileSync(resolve(new URL(".", import.meta.url).pathname, "../../assets/template.pdf"));
  }

  const finalDoc = await PDFDocument.load(templateBytes);

  // 2. Bewertungsseite einfügen (nach Seite 11)
  await createValuationPage(finalDoc, data);
  console.log("Bewertungsseite eingefügt, jetzt", finalDoc.getPageCount(), "Seiten");

  // 3. PriceHubble-PDF einbetten (nach der Bewertungsseite)
  if (phPdfBuffer) {
    try {
      const phDoc = await PDFDocument.load(phPdfBuffer);
      const phPageCount = phDoc.getPageCount();
      console.log("PH-PDF geladen:", phPageCount, "Seiten");

      // Alle PH-Seiten kopieren und nach der Bewertungsseite einfügen
      const phPages = await finalDoc.copyPages(phDoc, Array.from({ length: phPageCount }, (_, i) => i));
      const insertAt = INSERT_AFTER_PAGE + 1; // Nach der Bewertungsseite
      for (let i = 0; i < phPages.length; i++) {
        finalDoc.insertPage(insertAt + i, phPages[i]);
      }
      console.log("PH-Seiten eingebettet, jetzt", finalDoc.getPageCount(), "Seiten");
    } catch (e) {
      console.log("PH-PDF Einbettung fehlgeschlagen:", e.message);
    }
  }

  // 4. Speichern
  const pdfBytes = await finalDoc.save();
  console.log("Finales PDF:", Math.round(pdfBytes.length / 1024), "KB");
  return Buffer.from(pdfBytes).toString("base64");
}

// ═══════ Dossier-E-Mail mit Verzögerung senden ═══════
async function sendScheduledDossierEmail(data, pdfBase64) {
  const {
    firstName, email, address, dealType,
    valuation, dossierShareLink,
  } = data;

  const isRent = dealType === "rent" || dealType === "Vermietung";
  const unitLabel = isRent ? "&euro; / Monat" : "&euro;";

  let valuationHtml = "";
  if (valuation) {
    valuationHtml = `
      <div style="background:#f5f0eb;border-radius:12px;padding:28px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#878787;margin:0 0 8px;">Ihre Marktwertindikation</p>
        <p style="font-size:36px;font-weight:700;color:#34523A;margin:0;">${fmt(valuation.value)} ${unitLabel}</p>
        <p style="font-size:14px;color:#878787;margin:8px 0 0;">Bandbreite: ${fmt(valuation.valueRange.lower)} &ndash; ${fmt(valuation.valueRange.upper)} ${unitLabel}</p>
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
      <h1 style="font-size:22px;font-weight:700;color:#2A2A2A;text-align:center;margin:0 0 8px;">
        Ihr Bewertungsdossier ist fertig.
      </h1>
      <p style="font-size:15px;color:#3D3833;text-align:center;line-height:1.6;margin:0 0 24px;">
        Wir haben Ihre Immobilie <strong>${address}</strong> im aktuellen Marktumfeld eingeordnet und eine ausf&uuml;hrliche Analyse erstellt.
      </p>
      ${valuationHtml}
      ${pdfBase64 ? `
      <div style="background:#e8f0ea;border-radius:12px;padding:16px 24px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#34523A;margin:0;">
          &#128196; Ihr <strong>pers&ouml;nliches Bewertungsdossier</strong> finden Sie im Anhang dieser E-Mail.
        </p>
      </div>` : ""}
      ${dossierShareLink ? `
      <div style="background:#f5f0eb;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center;">
        <p style="font-size:14px;color:#3D3833;margin:0 0 12px;">Ihr interaktives Online-Dossier:</p>
        <a href="${dossierShareLink}" style="font-size:15px;color:#34523A;font-weight:600;text-decoration:underline;">Dossier online &ouml;ffnen &rarr;</a>
      </div>` : ""}
      <h2 style="font-size:16px;font-weight:700;color:#2A2A2A;margin:32px 0 12px;">Wie geht es weiter?</h2>
      <p style="font-size:14px;color:#3D3833;line-height:1.8;margin:0 0 24px;">
        Die Bewertung zeigt Ihnen den realistischen Rahmen. In einer pers&ouml;nlichen Beratung analysieren wir gemeinsam, welche Preisstrategie f&uuml;r Ihre Immobilie optimal ist &ndash; und wie Sie den bestm&ouml;glichen Verkaufspreis erzielen.
      </p>
      <div style="text-align:center;margin:24px 0 0;">
        <a href="${CALENDLY_URL}"
           style="display:inline-block;padding:14px 32px;background:#34523A;color:#fff;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">
          Kostenlose Erstberatung buchen
        </a>
      </div>
      <div style="text-align:center;margin:16px 0 0;">
        <a href="https://doerter.com/privatverkauf-ousmexqg"
           style="display:inline-block;padding:14px 32px;background:#fff;color:#34523A;border:2px solid #34523A;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">
          Verkaufsanalyse starten
        </a>
      </div>
    </div>
    <p style="font-size:12px;color:#878787;text-align:center;margin:24px 0 0;line-height:1.5;">
      DOERTER Immobilien &middot; doerter.immobilien<br>Diese E-Mail wurde automatisch versendet.
    </p>
  </div>
</body></html>`.trim();

  // Versand in DELAY_MINUTES Minuten planen
  const scheduledAt = new Date(Date.now() + DELAY_MINUTES * 60 * 1000).toISOString();

  const emailPayload = {
    from: "Doerter Immobilien <bewertung@doerter.immobilien>",
    to: email,
    subject: `Ihr Bewertungsdossier: ${address}`,
    html,
    scheduledAt,
  };

  if (pdfBase64) {
    const safeAddr = address.replace(/[^a-zA-Z0-9\u00e4\u00f6\u00fc\u00c4\u00d6\u00dc\u00df\-]/g, "_");
    emailPayload.attachments = [
      {
        filename: `DOERTER_Bewertungsdossier_${safeAddr}.pdf`,
        content: pdfBase64,
      },
    ];
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (process.env.RESEND_API_KEY || ""),
    },
    body: JSON.stringify(emailPayload),
  });

  console.log("Dossier-E-Mail geplant:", res.status, "- Versand um:", scheduledAt);
  if (!res.ok) console.log("Resend error:", await res.text());
}

// ═══════ HANDLER (Background Function) ═══════
export const handler = async (event) => {
  console.log("Background Function gestartet");

  try {
    const data = JSON.parse(event.body);
    const { dossierId, dealType, dossierShareLink } = data;

    // 1. PH-Token holen
    const token = await getToken();

    // 2. PriceHubble-PDF rendern (via Puppeteer)
    console.log("Rendere PriceHubble-PDF...");
    const phPdfBuffer = await renderPriceHubblePdf(dossierId, dealType, token);

    // 3. Finales PDF zusammenbauen
    console.log("Baue finales PDF...");
    const pdfBase64 = await buildFinalPdf(data, phPdfBuffer);

    // 4. E-Mail planen (12 Min verzögert via Resend scheduledAt)
    console.log("Plane E-Mail-Versand...");
    await sendScheduledDossierEmail(data, pdfBase64);

    console.log("Background Function abgeschlossen");
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.log("Background Function error:", e.message, e.stack);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
