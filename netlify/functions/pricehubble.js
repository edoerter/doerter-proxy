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
  console.log("Auth status:", res.status, "Body:", text);
  if (!res.ok) throw new Error("Auth fehlgeschlagen: " + res.status + " " + text);
  return JSON.parse(text).access_token;
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Nur POST erlaubt" }) };
  }

  try {
    const { action, payload } = JSON.parse(event.body);
    console.log("Action:", action);
    console.log("Payload:", JSON.stringify(payload));

    const token = await getToken();
    console.log("Token erhalten:", token ? "ja" : "nein");

    let endpoint;
    if (action === "createDossier") {
      endpoint = "/api/v1/dossiers";
    } else if (action === "getValuation") {
      endpoint = "/api/v1/valuation/property_value";
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Unbekannte action: " + action }) };
    }

    const phRes = await fetch(`${PH_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await phRes.text();
    console.log("PH Status:", phRes.status, "Response:", responseText);

    let data;
    try { data = JSON.parse(responseText); } catch(e) { data = { raw: responseText }; }

    if (!phRes.ok) {
      return { 
        statusCode: phRes.status, 
        headers, 
        body: JSON.stringify({ error: data, action, payloadSent: payload }) 
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.log("Exception:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
