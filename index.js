const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdf = require("pdf-poppler");
const Groq = require("groq-sdk");
require("dotenv").config();

const app = express();
const PORT = 3000;

/* =========================
   MIDDLEWARE
========================= */

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* =========================
   GROQ CLIENT
========================= */

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

/* =========================
   MULTER SETUP
========================= */

const upload = multer({
  dest: path.join(__dirname, "uploads")
});

/* =========================
   UPLOAD ROUTE
========================= */

app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.send("No PDF uploaded");

    const sampleJson = req.body.sampleJson;
    const instruction = req.body.instruction;

    if (!sampleJson) return res.send("Schema is required");

    const pdfPath = req.file.path;

    /* =========================
       GET TOTAL PAGES
    ========================= */

    const info = await pdf.info(pdfPath);
    const totalPages = info.pages;

    /* =========================
       CONVERT ALL PAGES
    ========================= */

    const options = {
      format: "png",
      out_dir: path.join(__dirname, "images"),
      out_prefix: "page",
      page: null
    };

    await pdf.convert(pdfPath, options);

    let results = [];

    /* =========================
       PROCESS EACH PAGE
    ========================= */

    for (let i = 1; i <= totalPages; i++) {

      const imagePath = path.join(__dirname, "images", `page-${i}.png`);

      if (!fs.existsSync(imagePath)) continue;

      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString("base64");

      const prompt = `
You are a strict JSON generator.

${instruction || ""}

Return ONLY valid JSON matching this schema exactly:
${sampleJson}

No explanation.
No extra text.
Only JSON.
`;

      const response = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        temperature: 0
      });

      const aiText = response.choices[0].message.content.trim();

      try {
        const parsed = JSON.parse(aiText);
        results.push(parsed);
      } catch (err) {
        console.log(`JSON parse failed on page ${i}`);
      }
    }

    /* =========================
       RETURN RESULTS
    ========================= */

    res.json(results);

  } catch (error) {
    console.log("Server error:", error);
    res.send("Error processing file");
  }
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});