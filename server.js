const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("🪙 UZCOIN server ishlayapti!");
});

app.listen(PORT, () => {
  console.log(`UZCOIN server ${PORT}-portda ishlayapti`);
});
