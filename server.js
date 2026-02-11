const express = require("express");
const app = express();

app.use(express.json());

const VERIFY_TOKEN = "lakme_verify_123"; // Must match Meta

// 🔹 Webhook verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// 🔹 Receive messages & delivery status (POST)
app.post("/webhook", (req, res) => {
  console.log("Webhook Event Received:");
  console.dir(req.body, { depth: null });

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
