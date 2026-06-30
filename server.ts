import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import mammoth from "mammoth";
import { createRequire } from 'module';
const nodeRequire = typeof require !== 'undefined' ? require : createRequire(import.meta.url);

import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from "docx";
import cors from "cors";
import path from "path";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildAnalysisPrompt,
  buildVerifyPrompt,
  buildDocParts,
  runTwoPassAnalysis,
} from "./src/shared/analysis";

function getAnthropicClient(customKey?: string): Anthropic {
  const key = (customKey && customKey.trim()) ? customKey.trim() : process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY가 없습니다. 우측 상단의 API Key 인증 버튼을 클릭하여 본인의 Anthropic API Key를 입력해주시거나, 로컬/클라우드 환경에 ANTHROPIC_API_KEY 환경변수를 설정해주세요.");
  }
  return new Anthropic({ apiKey: key });
}

// "**굵게**" 마크다운을 TextRun 배열로 변환한다(소제목 강조 유지).
function richRuns(text: string, base: Record<string, any> = {}): TextRun[] {
  return String(text || "")
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((s) => s !== "")
    .map((seg) =>
      seg.startsWith("**") && seg.endsWith("**")
        ? new TextRun({ ...base, text: seg.slice(2, -2), bold: true })
        : new TextRun({ ...base, text: seg })
    );
}

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
      return nodeRequire('pdf-parse');
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

  app.post("/api/analyze", async (req, res) => {
    try {
      const { 
        name, 
        specialRequest, 
        mainData, 
        jobPostingData, 
        resumeData, 
        careerData, 
        portfolioData, 
        jobMaterialData, 
        experienceData, 
        referenceData 
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ error: "지원자 성함을 입력해주세요." });
      }

      if (!mainData) {
        return res.status(400).json({ error: "주요 서류 데이터가 누락되었습니다." });
      }

      const trimmedName = name.trim();

      const promptText = buildAnalysisPrompt({
        name: trimmedName,
        specialRequest,
        has: {
          jobPosting: !!jobPostingData,
          jobMaterial: !!jobMaterialData,
          experience: !!experienceData,
          reference: !!referenceData,
        },
      });
      const verifyPrompt = buildVerifyPrompt({ name: trimmedName, specialRequest });
      const docParts = buildDocParts({
        mainData,
        jobPostingData,
        resumeData,
        careerData,
        portfolioData,
        jobMaterialData,
        experienceData,
        referenceData,
      });

      const customKey = (req.headers['x-api-key'] as string) || (req.headers['authorization'] as string)?.replace('Bearer ', '');
      const client = getAnthropicClient(customKey);
      console.log(`Sending two-pass processDocument request to Claude for user: ${name}`);

      // 2패스 분석은 수 분이 걸릴 수 있어 NDJSON 스트림으로 응답한다(ping/result/error).
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      const send = (obj: any) => {
        try {
          res.write(JSON.stringify(obj) + "\n");
        } catch {}
      };
      const ping = setInterval(() => send({ type: "ping" }), 10000);
      try {
        const resultText = await runTwoPassAnalysis(client, {
          model: "claude-sonnet-4-6",
          promptText,
          verifyPrompt,
          docParts,
        });
        if (!resultText) send({ type: "error", error: "AI 분석 결과가 비어있습니다." });
        else send({ type: "result", resultText });
      } catch (error: any) {
        console.error("AI Analysis error on server:", error);
        send({ type: "error", error: error.message || "AI Analysis failed" });
      } finally {
        clearInterval(ping);
        res.end();
      }
    } catch (error: any) {
      console.error("AI Analysis error on server:", error);
      // 스트림 응답을 이미 시작했다면 헤더를 다시 쓸 수 없으므로 안전하게 종료한다.
      if (res.headersSent) {
        try { res.write(JSON.stringify({ type: "error", error: error.message || "AI Analysis failed" }) + "\n"); } catch {}
        res.end();
      } else {
        res.status(500).json({ error: error.message || "AI Analysis failed" });
      }
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

      const severityColor = (s: string) =>
        s === "치명적" ? "C00000" : s === "보완" ? "808000" : "B36B00";

      for (const item of corrections) {
        const isSpecial = !!item.isSpecialRequestRelated;
        const severity = item.severity || "중요";

        // Original Text (Highlighted)
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: ` [중요도: ${severity}] `,
                bold: true,
                color: severityColor(severity),
              }),
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
              ...richRuns(item.reason, {
                italics: true,
                color: isSpecial ? "0000FF" : undefined, // Blue text for special
              }),
            ],
            spacing: { after: item.sourceBasis ? 80 : 300 },
          })
        );

        // Source basis (근거 서류)
        if (item.sourceBasis) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `근거 자료: ${item.sourceBasis}`,
                  size: 18,
                  color: "808080",
                }),
              ],
              spacing: { after: 300 },
            })
          );
        }
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
          // 색상 태그/홑따옴표만 정리하고 **굵게** 강조는 살린다.
          const cleanText = pText
            .replace(/\[\/?(BLUE|RED|YELLOW)\]/g, '')
            .replace(/'/g, '');
          // [총평] 같은 소제목 줄은 굵게, 나머지는 인라인 **굵게**를 살려 렌더링한다.
          const isTitle = /^(\d+\.\s*)?\[.*\]$/.test(cleanText.trim());
          children.push(
            new Paragraph({
              children: isTitle
                ? [new TextRun({ text: cleanText, bold: true })]
                : richRuns(cleanText),
              spacing: { before: isTitle ? 200 : 0, after: 200 },
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
