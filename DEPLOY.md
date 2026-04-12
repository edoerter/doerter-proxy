# DOERTER Bewertungs-API v4 — Deployment

## Architektur: Zwei-Funktionen-System

### 1. `pricehubble.js` (Hauptfunktion — sofort)
- Dossier bei PriceHubble erstellen
- Valuation abrufen
- Sharing-Link generieren
- **Sofort-E-Mail** an Kunden (Preis + Bestätigung)
- **Pipedrive** Person + Deal + Notiz anlegen
- **Background Function triggern** für PDF + Dossier-E-Mail

### 2. `send-dossier-background.js` (Background Function — bis 15 Min)
- PriceHubble Dash PDF via **Puppeteer** rendern
- DOERTER-Broschüre + Bewertungsseite + PH-Dossier-PDF zusammenfügen (**pdf-lib**)
- **Dossier-E-Mail** mit PDF-Anhang + Sharing-Link senden (12 Min verzögert via Resend `scheduledAt`)

### E-Mail-Flow
1. **Sofort** (Sekunden nach Formular): Preis + kurze Bestätigung
2. **~12 Minuten später**: Ausführliches Dossier mit PDF-Anhang + Online-Link

### PDF-Aufbau
- Seiten 1–11: DOERTER-Broschüre (template.pdf)
- Seite 12: Individuelle Bewertungsseite (generiert)
- Seiten 13+: PriceHubble-Dossier (via Puppeteer gerendert)
- Restliche Seiten: DOERTER-Broschüre (Seiten 12–20 vom Template)

### Pipedrive-Integration
- Person + Deal werden automatisch angelegt
- Notiz mit allen Bewertungsdaten am Deal angeheftet

---

## Dateien

\`\`\`
bewertung-api/
├── netlify.toml
├── package.json
├── DEPLOY.md
├── assets/
│   └── template.pdf              ← 20-seitige Broschüren-Vorlage
└── netlify/
    └── functions/
        ├── pricehubble.js        ← Hauptfunktion (Schritt 1)
        └── send-dossier-background.js  ← Background Function (Schritt 2)
\`\`\`

---

## Deployment

### 1. Netlify-Site verknüpfen
\`\`\`bash
cd 03_Funnel/bewertung-api
netlify link --id <SITE-ID>
\`\`\`

### 2. Environment Variables setzen
Im Netlify Dashboard → Site Settings → Environment Variables:
- `RESEND_API_KEY` — Bereits vorhanden
- `PIPEDRIVE_API_KEY` — Pipedrive API-Token (Settings → Personal Preferences → API)

### 3. Deploy
\`\`\`bash
npm install
netlify deploy --prod
\`\`\`

### 4. Testen
1. Bewertungsformular ausfüllen
2. **Sofort-E-Mail** prüfen: Kommt innerhalb von Sekunden, zeigt Preis
3. **Pipedrive** prüfen: Neuer Kontakt + Deal mit Bewertungsdaten
4. **Dossier-E-Mail** prüfen: Kommt ~12 Min später, hat PDF-Anhang + Sharing-Link
5. **PDF öffnen**: Broschüre + Bewertungsseite (Seite 12) + PriceHubble-Dossier-Seiten

---

## Troubleshooting
- **Background Function startet nicht?** Prüfe in Netlify Functions-Logs ob der Aufruf ankommt.
- **Puppeteer-Fehler?** `@sparticuz/chromium` muss in `external_node_modules` stehen (netlify.toml).
- **E-Mail kommt nicht nach 12 Min?** Resend `scheduledAt` prüfen — Resend erlaubt Scheduling bis zu 72h.
- **PH-PDF leer/fehlerhaft?** PriceHubble Dash braucht manchmal länger. Die Function wartet auf `body.pdfIsReady` oder 10s Fallback.
