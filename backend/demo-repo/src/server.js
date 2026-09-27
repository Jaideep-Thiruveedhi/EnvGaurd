import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-fallback";

app.get("/", (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`demo app on ${PORT} (jwt: ${JWT_SECRET ? "set" : "missing"})`);
});
