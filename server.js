const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    message: "UZCOIN server ishlayapti!"
  });
});

app.listen(PORT, () => {
  console.log(`UZCOIN server ${PORT}-portda ishlayapti`);
});
