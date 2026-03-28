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

if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
  console.log("❌ Missing ACCESS_TOKEN or PHONE_NUMBER_ID");
}

/* ================================
   📊 GLOBAL LOG STORAGE
================================ */
let messageLogs = {};

/* =====================================
   🔹 Health Check
===================================== */
app.get("/", (req, res) => {
  res.send("Webhook server is running 🚀");
});

/* =====================================
   🔹 Webhook Verification
===================================== */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

/* =====================================
   🔹 WEBHOOK (REAL STATUS TRACKING)
===================================== */
app.post("/webhook", (req, res) => {
  const body = req.body;

  console.log("📩 Webhook Event");

  if (body.object === "whatsapp_business_account") {
    body.entry.forEach(entry => {
      entry.changes.forEach(change => {
        const value = change.value;

        /* ===== STATUS ===== */
        if (value.statuses) {
          value.statuses.forEach(statusObj => {
            const number = statusObj.recipient_id;
            const status = statusObj.status;

            if (!messageLogs[number]) {
              messageLogs[number] = {};
            }

            messageLogs[number].status = status;
            messageLogs[number].updatedAt = new Date().toISOString();

            if (status === "failed" && statusObj.errors) {
              statusObj.errors.forEach(err => {
                messageLogs[number].error = err.message;

                if (err.code === 131026) {
                  messageLogs[number].status = "blocked";
                  console.log(`🚫 BLOCKED by ${number}`);
                }
              });
            }

            console.log(`📦 ${number} → ${messageLogs[number].status}`);
          });
        }

        /* ===== REPLIES ===== */
        if (value.messages) {
          value.messages.forEach(msg => {
            const from = msg.from;
            const text = msg.text?.body || "[non-text message]";

            if (!messageLogs[from]) {
              messageLogs[from] = {};
            }

            messageLogs[from].reply = text;
            messageLogs[from].replyTime = new Date().toISOString();

            console.log(`💬 ${from}: ${text}`);
          });
        }
      });
    });
  }

  res.sendStatus(200);
});

/* =====================================
   🔹 VIEW ALL LOGS
===================================== */
app.get("/logs", (req, res) => {
  res.json(messageLogs);
});

/* =====================================
   🔹 BULK SEND
===================================== */
app.post("/upload-excel-send", upload.single("file"), async (req, res) => {
  console.log("🔥 REQUEST RECEIVED");

  const templateName = req.body.templateName;

  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  if (!templateName) {
    return res.status(400).json({ error: "Template name required" });
  }

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  let results = [];

  for (let row of data) {
    let number = String(row.number || row.phone || "")
      .replace(/\D/g, "")
      .trim();

    if (!number || number.length < 10) continue;

    if (!number.startsWith("91")) {
      number = "91" + number;
    }

    try {
      // 🔹 Initial status
      messageLogs[number] = {
        status: "sent",
        createdAt: new Date().toISOString()
      };

      await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
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
                    image: {
                      id: IMAGE_MEDIA_ID
                    }
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

      console.log(`✅ Sent to ${number}`);
      results.push({ number, status: "sent" });

      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      console.log(`❌ Failed for ${number}`);

      messageLogs[number] = {
        status: "failed",
        error: error.response?.data || error.message,
        updatedAt: new Date().toISOString()
      };

      results.push({
        number,
        status: "failed",
        error: error.response?.data || error.message
      });
    }
  }

  res.json({
    message: "Bulk sending started",
    total: data.length,
    results
  });
});

/* =====================================
   🔹 START SERVER
===================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});