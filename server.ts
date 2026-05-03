import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import mammoth from "mammoth";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from "docx";
import cors from "cors";
import path from "path";
import fs from "fs";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // 1. CORS
  app.use(cors());

  // 2. Logging middleware
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    }
    next();
  });

  // 3. Body parsers
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 4. API Routes
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
  });

  const pdfParser = (() => {
    try {
      return require('pdf-parse');
    } catch (e: any) {
      console.error("Failed to load pdf-parse:", e.message);
      return null;
    }
  })();

  app.get("/api/health", (req, res) => {
    console.log("Health check hit");
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  app.post("/api/extract-text", upload.single("file"), async (req, res) => {
    console.log(`Processing extraction for: ${req.file?.originalname}`);
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      
      let extractedText = "";
      const fileExtension = path.extname(req.file.originalname).toLowerCase();

      if ([".png", ".jpg", ".jpeg"].includes(fileExtension)) {
        const base64Data = req.file.buffer.toString('base64');
        return res.json({ 
          image: { 
            mimeType: req.file.mimetype, 
            data: base64Data 
          } 
        });
      } else if (fileExtension === ".docx") {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        extractedText = result.value;
      } else if (fileExtension === ".pdf") {
        if (!pdfParser) throw new Error("PDF extraction unavailable");
        const data = await pdfParser(req.file.buffer);
        extractedText = data.text;
      } else {
        return res.status(400).json({ error: "Unsupported file format." });
      }

      res.json({ text: extractedText });
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: error.message || "Extraction failed" });
    }
  });

  app.post("/api/generate-docx", async (req, res) => {
    try {
      const { corrections, finalAdvice, name } = req.body;
      
      if (!Array.isArray(corrections)) {
        return res.status(400).json({ error: "Invalid corrections format" });
      }

      const children = [];

      // Title
      const titleText = name ? `코칭패스 서류 첨삭_${name}` : "코칭패스 서류 첨삭 결과";
      children.push(
        new Paragraph({
          text: titleText,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        })
      );

      // Introduction
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "본 서류는 코칭패스의 서류평가위원이자",
              bold: true,
              size: 24,
            }),
            new TextRun({
              text: "HR팀 출신 전문가들이 첨삭을 진행하였습니다.",
              bold: true,
              size: 24,
              break: 1,
            }),
          ],
          spacing: { after: 400 },
          alignment: AlignmentType.CENTER,
        })
      );

      for (const item of corrections) {
        const isSpecial = !!item.isSpecialRequestRelated;

        // Original Text (Highlighted)
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: isSpecial ? " [요청사항 관련 문항] " : " [원본 문항] ",
                bold: true,
                color: isSpecial ? "008000" : "FF0000", // Green for special, Red for normal
              }),
              new TextRun({
                text: item.original,
                shading: {
                  fill: isSpecial ? "CCFFCC" : "FFFF00", // Light green for special, Yellow for normal
                },
              }),
            ],
            spacing: { before: 200, after: 100 },
          })
        );

        // Corrected Text
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: " [수정 제안] ",
                bold: true,
                color: "0000FF",
              }),
              new TextRun({
                text: item.corrected,
              }),
            ],
            spacing: { after: 100 },
          })
        );

        // Reason
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: " [첨삭 이유] ",
                bold: true,
                color: isSpecial ? "0000FF" : "008000", // Blue for special, Green for normal
              }),
              new TextRun({
                text: item.reason,
                italics: true,
                color: isSpecial ? "0000FF" : undefined, // Blue text for special
              }),
            ],
            spacing: { after: 300 },
          })
        );
      }

      // Final Advice
      if (finalAdvice) {
        children.push(
          new Paragraph({
            text: "평가위원의 최종 조언",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
          })
        );
        
        // Split final advice into paragraphs for better readability in DOCX
        const adviceParagraphs = finalAdvice.split('\n').filter((p: string) => p.trim() !== '');
        for (const pText of adviceParagraphs) {
          // Remove color markers for DOCX as we won't implement complex parsing here for now, 
          // or just clean them up
          const cleanText = pText.replace(/\[\/?(BLUE|RED|YELLOW)\]/g, '');
          children.push(
            new Paragraph({
              text: cleanText,
              spacing: { after: 200 },
            })
          );
        }
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: children,
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      const filename = name ? `코칭패스 서류 첨삭_${name}.docx` : "corrected_document.docx";
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename=${encodeURIComponent(filename)}`);
      res.send(buffer);
    } catch (error) {
      console.error("Generation error:", error);
      res.status(500).json({ error: "Failed to generate document" });
    }
  });

  // 404 for API routes - ensure we return JSON, not HTML
  app.all("/api/*", (req, res) => {
    console.warn(`[${new Date().toISOString()}] API Route not found: ${req.method} ${path.join(req.baseUrl, req.url)}`);
    res.status(404).json({ 
      error: `API route not found: ${req.method} ${req.url}`,
      message: "Please ensure you are calling a valid API endpoint."
    });
  });

  // Global error handler to prevent HTML error pages
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[${new Date().toISOString()}] Unhandled error:`, err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
