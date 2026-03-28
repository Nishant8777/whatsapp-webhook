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

let messageLogs = [];

/* =====================================
   🔹 Health Check
===================================== */
app.get("/", (req, res) => {
  console.log("✅ Health check hit");
  res.send("Webhook server is running 🚀");
});

/* =====================================
   🔹 Webhook Verification
===================================== */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔐 Webhook verify hit");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

/* =====================================
   🔹 Webhook Receiver
===================================== */
app.post("/webhook", (req, res) => {
  console.log("📩 Webhook Event Received");

  const body = req.body;

  if (body.object === "whatsapp_business_account") {
    body.entry.forEach(entry => {
      entry.changes.forEach(change => {
        const value = change.value;

        // STATUS
        if (value.statuses) {
          value.statuses.forEach(statusObj => {
            console.log(`📦 ${statusObj.recipient_id} → ${statusObj.status}`);
          });
        }

        // REPLIES
        if (value.messages) {
          value.messages.forEach(msg => {
            console.log(`💬 ${msg.from}: ${msg.text?.body}`);
          });
        }
      });
    });
  }

  res.sendStatus(200);
});

/* =====================================
   🔹 Upload Excel & Send Bulk
===================================== */
app.post("/upload-excel-send", upload.single("file"), async (req, res) => {
  console.log("🔥🔥 REQUEST RECEIVED 🔥🔥");

  try {
    // Debug logs
    console.log("📂 File:", req.file ? "Received" : "Not received");
    console.log("🧾 Template:", req.body.templateName);

    if (!req.file) {
      console.log("❌ No file uploaded");
      return res.status(400).json({ error: "No file uploaded" });
    }

    const templateName = req.body.templateName;

    if (!templateName) {
      console.log("❌ Template missing");
      return res.status(400).json({ error: "Template name required" });
    }

    // Read Excel
    console.log("📊 Reading Excel...");
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log(`📄 Total rows: ${data.length}`);

    let results = [];

    for (let row of data) {
      let number = String(row.number || row.phone || "")
        .replace(/\D/g, "")
        .trim();

      if (!number || number.length < 10) {
        console.log("⚠️ Skipping invalid number");
        continue;
      }

      if (!number.startsWith("91")) {
        number = "91" + number;
      }

      console.log(`📤 Sending to ${number}`);

      try {
        const response = await axios.post(
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
        console.log("ERROR:", error.response?.data || error.message);

        results.push({
          number,
          status: "failed",
          error: error.response?.data || error.message
        });
      }
    }

    console.log("🎯 Bulk completed");

    res.json({
      message: "Bulk sending completed",
      total: data.length,
      results
    });

  } catch (err) {
    console.log("💥 SERVER ERROR:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* =====================================
   🔹 Start Server
===================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});