const PH_BASE = "https://api.pricehubble.com";
const PH_USER = "homea-ph-api";
const PH_PASS = "PsgXvbTNKL";

// Token wird pro Funktionsinstanz gecacht (bis zu 10 Min. Laufzeit)
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${PH_BASE}/auth/login/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: PH_USER, password: PH_PASS }),
  });

  if (!res.ok) throw new Error("Auth fehlgeschlagen: " + res.status);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 11 * 60 * 60 * 1000; // 11h (Token läuft nach 12h ab)
  return cachedToken;
}

export const handler = async (event) => {
  // CORS-Header — erlaubt Anfragen von deiner Squarespace-Domain
  const headers = {
    "Access-Control-Allow-Origin": "*", // Später auf "https://www.doerter.immobilien" einschränken
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Preflight-Request des Browsers beantworten
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };
  }

  try {
    const { action, payload } = JSON.parse(event.body);
    const token = await getToken();

    let endpoint, method = "POST";

    if (action === "createDossier") {
      endpoint = "/api/v1/dossiers";
    } else if (action === "getValuation") {
      endpoint = "/api/v1/valuation/property_value";
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Unbekannte action: " + action }) };
    }

    const phRes = await fetch(`${PH_BASE}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });

    const data = await phRes.json();

    if (!phRes.ok) {
      return { statusCode: phRes.status, headers, body: JSON.stringify({ error: data }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
