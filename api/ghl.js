const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function postToFormsWithRetry(FORM_URL, options, retries = 3) {
  let lastStatus = null;
  let lastBody = "";
  let lastErr = null;

  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetchWithTimeout(FORM_URL, options, 8000);
      lastStatus = resp.status;

      const text = await resp.text();
      lastBody = text;

      // Éxito típico en Forms: 200 o 302
      if (resp.status === 200 || resp.status === 302) {
        return { resp, text };
      }

      console.error(`⚠️ Forms intento ${i + 1}/${retries} status=${resp.status} body(200)=`, text.slice(0, 200));
    } catch (e) {
      lastErr = e;
      console.error(`❌ Forms intento ${i + 1}/${retries} error:`, e?.message || e);
    }

    // backoff corto: 250ms, 750ms, 1750ms
    const wait = 250 + i * i * 500;
    await sleep(wait);
  }

  const err = new Error(
    lastErr
      ? `Forms failed after retries: ${lastErr.message || lastErr}`
      : `Forms bad status after retries: ${lastStatus}`
  );
  err.lastStatus = lastStatus;
  err.lastBody = lastBody;
  throw err;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const FORM_URL =
    "https://docs.google.com/forms/d/e/1FAIpQLSdAQvry3-pKeDZMg6h54TpVQ6IK373NAuBOcJACt5W4jY2XSg/formResponse";

  const data = req.body || {};
  const parsed =
    typeof data === "string"
      ? (() => { try { return JSON.parse(data); } catch { return {}; } })()
      : data;

  const fechaHora = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });

  const contactId = parsed.contact_id || parsed.contactId || "";
  const nombreCompleto =
    parsed.full_name || [parsed.first_name, parsed.last_name].filter(Boolean).join(" ") || "";
  const email = parsed.email || "";
  const telefono = (parsed.phone || "").toString().replace(/^\+/, "").replace(/\s/g, "");
  const origenFuente = parsed.contact_source || "";
  const pais = parsed.country || (parsed.location && parsed.location.country) || "";
  const timezone = parsed.timezone || "";

  const urlDelFormulario =
    (parsed.contact && parsed.contact.attributionSource && parsed.contact.attributionSource.url) ||
    (parsed.contact && parsed.contact.lastAttributionSource && parsed.contact.lastAttributionSource.url) ||
    "";

  const referrer =
    (parsed.contact && parsed.contact.attributionSource && parsed.contact.attributionSource.referrer) ||
    (parsed.contact && parsed.contact.lastAttributionSource && parsed.contact.lastAttributionSource.referrer) ||
    "";

  const formParams = new URLSearchParams();
  formParams.append("entry.99773689", fechaHora);
  formParams.append("entry.2098041704", contactId);
  formParams.append("entry.379244977", nombreCompleto);
  formParams.append("entry.662128694", email);
  formParams.append("entry.2026790237", telefono);
  formParams.append("entry.942838195", origenFuente);
  formParams.append("entry.782980798", pais);
  formParams.append("entry.798218329", timezone);
  formParams.append("entry.778186638", urlDelFormulario);
  formParams.append("entry.363421330", referrer);

  try {
    console.log("✅ Webhook recibido. Keys:", Object.keys(parsed || {}));
    console.log("🧾 Payload mapeado:", {
      fechaHora, contactId, nombreCompleto, email, telefono, origenFuente,
      pais, timezone, urlDelFormulario, referrer
    });

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0"
      },
      body: formParams.toString(),
      redirect: "manual"
    };

    const { resp, text } = await postToFormsWithRetry(FORM_URL, options, 3);

    console.log("📩 Forms status final:", resp.status);
    console.log("📩 Forms body (primeros 200):", text.slice(0, 200));

    return res.status(200).json({ ok: true, formStatus: resp.status });
  } catch (err) {
    console.error("❌ Falló envío a Forms tras reintentos:", err?.message || err);
    if (err?.lastStatus) console.error("❌ lastStatus:", err.lastStatus);
    if (err?.lastBody) console.error("❌ lastBody(200):", (err.lastBody || "").slice(0, 200));

    // Estrategia: responder 200 para que Digital1 no reintente agresivo.
    // Si prefieres que Digital1 reintente, cambia a res.status(500)
    return res.status(200).json({ ok: false, error: err?.message || String(err) });
  }
};
