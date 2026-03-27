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
const VIDEO_MEDIA_ID = process.env.VIDEO_MEDIA_ID;

if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
  console.log("❌ Missing ACCESS_TOKEN or PHONE_NUMBER_ID");
}

let messageLogs = [];

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
   🔹 Webhook Receiver (STATUS + REPLIES)
===================================== */
app.post("/webhook", (req, res) => {
  const body = req.body;

  console.log("📩 Webhook Event Received");

  if (body.object === "whatsapp_business_account") {
    body.entry.forEach(entry => {
      entry.changes.forEach(change => {
        const value = change.value;

        /* =========================
           🔹 STATUS TRACKING
        ========================== */
        if (value.statuses) {
          value.statuses.forEach(statusObj => {
            const number = statusObj.recipient_id;
            const status = statusObj.status;

            let errorCode = "";
            let errorMessage = "";

            if (status === "failed" && statusObj.errors) {
              statusObj.errors.forEach(err => {
                errorCode = err.code;
                errorMessage = err.message;

                if (err.code === 131026) {
                  console.log(`🚫 BLOCKED by ${number}`);
                }
              });
            }

            console.log(`📦 ${number} → ${status}`);

            messageLogs.push({
              type: "status",
              number,
              status,
              errorCode,
              errorMessage,
              time: new Date().toISOString()
            });
          });
        }

        /* =========================
           🔹 INCOMING REPLIES (ONLY LOG)
        ========================== */
        if (value.messages) {
          value.messages.forEach(msg => {
            const from = msg.from;
            const text = msg.text?.body || "[non-text message]";

            console.log(`💬 Reply from ${from}: ${text}`);

            messageLogs.push({
              type: "reply",
              number: from,
              message: text,
              time: new Date().toISOString()
            });
          });
        }
      });
    });
  }

  res.sendStatus(200);
});

/* =====================================
   🔹 Download Excel Logs
===================================== */
app.get("/download-excel", (req, res) => {
  if (messageLogs.length === 0) {
    return res.send("No logs available yet.");
  }

  const worksheet = XLSX.utils.json_to_sheet(messageLogs);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Logs");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx"
  });

  res.setHeader(
    "Content-Disposition",
    "attachment; filename=whatsapp_logs.xlsx"
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  res.send(buffer);
});

/* =====================================
   🔹 Upload Excel & Send Bulk Template
===================================== */
app.post("/upload-excel-send", upload.single("file"), async (req, res) => {
  console.log("🔥 UPLOAD ROUTE HIT");

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
      const response = await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: number,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en_US" },

            // 🔥 Header (if video template)
            components: VIDEO_MEDIA_ID
              ? [
                  {
                    type: "header",
                    parameters: [
                      {
                        type: "video",
                        video: { id: VIDEO_MEDIA_ID }
                      }
                    ]
                  }
                ]
              : []
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
      console.log("RESPONSE:", response.data);

      results.push({ number, status: "sent" });

      // ⏳ delay to avoid rate limit
      await new Promise(r => setTimeout(r, 1000));

    } catch (error) {
      console.log(`❌ Failed for ${number}`);
      console.log(
        "ERROR:",
        JSON.stringify(error.response?.data, null, 2)
      );

      results.push({
        number,
        status: "failed",
        error: error.response?.data || error.message
      });
    }
  }

  res.json({
    message: "Bulk sending completed",
    total: data.length,
    results
  });
});

/* =====================================
   🔹 Start Server
===================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});