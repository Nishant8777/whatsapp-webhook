require("dotenv").config();
const express = require("express");
const XLSX = require("xlsx");
const multer = require("multer");
const axios = require("axios");

const app = express();
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IMAGE_MEDIA_ID = process.env.IMAGE_MEDIA_ID;
const LOGS_API_KEY = process.env.LOGS_API_KEY || "salonox-logs-secret";
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v19.0";

/* ================================
   ✅ ENV VALIDATION ON STARTUP
================================ */
const requiredEnvs = { VERIFY_TOKEN, ACCESS_TOKEN, PHONE_NUMBER_ID, IMAGE_MEDIA_ID };
let missingEnvs = Object.entries(requiredEnvs)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missingEnvs.length > 0) {
  console.error(`❌ Missing env vars: ${missingEnvs.join(", ")}`);
  process.exit(1);
}

console.log("✅ All env vars loaded");
console.log(`📡 Using Graph API: ${GRAPH_API_VERSION}`);

/* ================================
   📊 IN-MEMORY LOG STORAGE
================================ */
let messageLogs = {};

/* =====================================
   🔹 Health Check
===================================== */
app.get("/", (req, res) => {
  res.json({
    status: "running",
    totalLogged: Object.keys(messageLogs).length,
    uptime: Math.floor(process.uptime()) + "s"
  });
});

/* =====================================
   🔹 Webhook Verification (GET)
   Meta hits: GET /api/v1/webhooks/whatsapp
===================================== */
app.get("/api/v1/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    return res.status(200).send(challenge);
  }

  console.warn("⚠️ Webhook verification failed — token mismatch");
  return res.sendStatus(403);
});

/* =====================================
   🔹 Webhook Events (POST)
   Meta hits: POST /api/v1/webhooks/whatsapp
===================================== */
app.post("/api/v1/webhooks/whatsapp", (req, res) => {
  const body = req.body;

  if (body.object !== "whatsapp_business_account") {
    return res.sendStatus(404);
  }

  try {
    body.entry?.forEach(entry => {
      entry.changes?.forEach(change => {
        const value = change.value;

        /* ===== DELIVERY STATUSES ===== */
        if (value.statuses) {
          value.statuses.forEach(statusObj => {
            const number = statusObj.recipient_id;
            const status = statusObj.status;

            if (!messageLogs[number]) messageLogs[number] = {};

            messageLogs[number].status = status;
            messageLogs[number].updatedAt = new Date().toISOString();

            if (status === "failed" && statusObj.errors?.length) {
              const err = statusObj.errors[0];
              messageLogs[number].errorCode = err.code;
              messageLogs[number].errorMessage = err.message;

              if (err.code === 131026) {
                messageLogs[number].status = "blocked";
                console.warn(`🚫 BLOCKED: ${number}`);
              } else {
                console.warn(`❌ FAILED [${err.code}]: ${number} — ${err.message}`);
              }
            } else {
              console.log(`📦 ${number} → ${status}`);
            }
          });
        }

        /* ===== INCOMING REPLIES ===== */
        if (value.messages) {
          value.messages.forEach(msg => {
            const from = msg.from;
            const text = msg.text?.body || "[non-text]";

            if (!messageLogs[from]) messageLogs[from] = {};

            messageLogs[from].reply = text;
            messageLogs[from].replyTime = new Date().toISOString();

            console.log(`💬 Reply from ${from}: ${text}`);
          });
        }
      });
    });
  } catch (err) {
    console.error("🔴 Webhook processing error:", err.message);
  }

  res.sendStatus(200);
});

/* =====================================
   🔹 VIEW LOGS (protected)
===================================== */
app.get("/api/v1/logs", (req, res) => {
  const key = req.headers["x-api-key"];
  if (key !== LOGS_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const logs = Object.entries(messageLogs).map(([number, data]) => ({
    number,
    ...data
  }));

  const statusFilter = req.query.status;
  const filtered = statusFilter
    ? logs.filter(l => l.status === statusFilter)
    : logs;

  res.json({
    total: filtered.length,
    logs: filtered
  });
});

/* =====================================
   🔹 LOG STATS
===================================== */
app.get("/api/v1/logs/stats", (req, res) => {
  const key = req.headers["x-api-key"];
  if (key !== LOGS_API_KEY) return res.status(401).json({ error: "Unauthorized" });

  const stats = { sent: 0, delivered: 0, read: 0, failed: 0, blocked: 0, replied: 0 };

  Object.values(messageLogs).forEach(log => {
    if (log.status && stats[log.status] !== undefined) stats[log.status]++;
    if (log.reply) stats.replied++;
  });

  res.json(stats);
});

/* =====================================
   🔹 BULK SEND via Excel
===================================== */
app.post("/api/v1/send/bulk", upload.single("file"), async (req, res) => {
  console.log("🔥 Bulk send request received");

  const templateName = req.body.templateName;

  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (!templateName) return res.status(400).json({ error: "templateName is required" });

  let data;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    data = XLSX.utils.sheet_to_json(sheet);
  } catch (err) {
    return res.status(400).json({ error: "Invalid Excel file", detail: err.message });
  }

  if (!data.length) return res.status(400).json({ error: "Excel file is empty" });

  console.log(`📋 Total rows in Excel: ${data.length}`);

  let results = [];
  let successCount = 0;
  let failCount = 0;

  for (let row of data) {
    let number = String(row.number || row.phone || row.Phone || row.Number || "")
      .replace(/\D/g, "")
      .trim();

    if (!number || number.length < 10) {
      console.warn(`⚠️ Skipping invalid number: "${number}"`);
      results.push({ number: number || "EMPTY", status: "skipped", reason: "invalid number" });
      continue;
    }

    if (!number.startsWith("91")) number = "91" + number;

    try {
      await axios.post(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: number,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en_US" },
            components: [
              {
                type: "header",
                parameters: [
                  {
                    type: "image",
                    image: { id: IMAGE_MEDIA_ID }
                  }
                ]
              }
            ]
          }
        },
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      messageLogs[number] = {
        status: "sent",
        template: templateName,
        sentAt: new Date().toISOString()
      };

      console.log(`✅ Sent → ${number}`);
      results.push({ number, status: "sent" });
      successCount++;

    } catch (error) {
      const errData = error.response?.data || error.message;

      messageLogs[number] = {
        status: "failed",
        template: templateName,
        error: errData,
        failedAt: new Date().toISOString()
      };

      console.error(`❌ Failed → ${number}`, JSON.stringify(errData));
      results.push({ number, status: "failed", error: errData });
      failCount++;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`🏁 Done — ✅ ${successCount} sent, ❌ ${failCount} failed`);

  res.json({
    message: "Bulk send complete",
    total: data.length,
    successCount,
    failCount,
    results
  });
});

/* =====================================
   🔹 START SERVER
===================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 SalonOx Webhook Server running on port ${PORT}`);
});