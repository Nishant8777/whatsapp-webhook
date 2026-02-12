const express = require("express");
const app = express();
app.use(express.json());

// 🔹 Webhook Event Receiver (POST)
app.post("/webhook", (req, res) => {
  const body = req.body;

  console.log("📩 Webhook Event Received:");

  if (body.object === "whatsapp_business_account") {
    console.log("🔔 Event Type: WhatsApp Business Account");
    body.entry.forEach(entry => {
      entry.changes.forEach(change => {
        const value = change.value;

        // 🔵 MESSAGE STATUS EVENTS (Your outgoing messages)
        if (value.statuses) {
          value.statuses.forEach(statusObj => {
            const recipient = statusObj.recipient_id;
            const status = statusObj.status;

            console.log(`📦 Status for ${recipient}: ${status}`);

            if (status === "delivered") {
              console.log("✅ Message delivered");
            }

            if (status === "read") {
              console.log("👀 Message read");
            }

            if (status === "failed") {
              console.log("❌ Message failed");

              if (statusObj.errors) {
                statusObj.errors.forEach(err => {
                  console.log("Error Code:", err.code);
                  console.log("Error Message:", err.message);

                  // 🚨 Block detection
                  if (err.code === 131026) {
                    console.log("🚫 User has BLOCKED your number");
                  }

                  // 🚨 Ecosystem restriction
                  if (err.code === 131049) {
                    console.log("⚠️ Marketing blocked due to engagement restriction");
                  }

                  // 🚨 Experiment restriction
                  if (err.code === 130472) {
                    console.log("🧪 User part of WhatsApp experiment");
                  }
                });
                
              }
            }
          });
        }

        // 🟢 INCOMING USER MESSAGES
        if (value.messages) {
          value.messages.forEach(msg => {
            const from = msg.from;
            const text = msg.text?.body;

            console.log(`📨 Incoming message from ${from}: ${text}`);
          });
        }
      });
    });
  }


  res.sendStatus(200);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
