require("dotenv").config();
const express = require("express");
const XLSX = require("xlsx");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// 📦 Store logs in memory
let messageLogs = [];

/* =====================================
   🔹 Health Check
===================================== */
app.get("/", (req, res) => {
  res.send("Webhook server is running 🚀");
});

/* =====================================
   🔹 Webhook Verification (GET)
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
   🔹 Webhook Receiver (POST)
===================================== */
app.post("/webhook", (req, res) => {
  const body = req.body;

  console.log("📩 Webhook Event Received");

  if (body.object === "whatsapp_business_account") {
    body.entry.forEach(entry => {
      entry.changes.forEach(change => {
        const value = change.value;

        // 🔵 MESSAGE STATUS EVENTS
        if (value.statuses) {
          value.statuses.forEach(statusObj => {
            const number = statusObj.recipient_id;
            const status = statusObj.status;
            let errorCode = "";
            let errorMessage = "";

            console.log(`📦 Status for ${number}: ${status}`);

            if (status === "failed" && statusObj.errors) {
              statusObj.errors.forEach(err => {
                errorCode = err.code;
                errorMessage = err.message;

                console.log("❌ Error Code:", err.code);
                console.log("❌ Error Message:", err.message);

                if (err.code === 131026) {
                  console.log("🚫 USER HAS BLOCKED YOU");
                }

                if (err.code === 131049) {
                  console.log("⚠️ Marketing blocked (low engagement)");
                }

                if (err.code === 130472) {
                  console.log("🧪 User part of experiment");
                }
              });
            }

            // 📊 Save status log
            messageLogs.push({
              number,
              status,
              errorCode,
              errorMessage,
              time: new Date().toISOString()
            });
          });
        }

        // 🟢 INCOMING USER MESSAGES
        if (value.messages) {
          value.messages.forEach(msg => {
            const from = msg.from;
            const text = msg.text?.body || "";

            console.log(`📨 Incoming message from ${from}: ${text}`);

            messageLogs.push({
              number: from,
              status: "incoming",
              errorCode: "",
              errorMessage: "",
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
   🔹 Download Excel
===================================== */
app.get("/download-excel", (req, res) => {
  if (messageLogs.length === 0) {
    return res.send("No logs available yet.");
  }

  const worksheet = XLSX.utils.json_to_sheet(messageLogs);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "WhatsApp Logs");

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
   🔹 Start Server
===================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
