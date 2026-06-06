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
import { GoogleGenAI, Type } from "@google/genai";

function getGeminiClient(customKey?: string): GoogleGenAI {
  const key = (customKey && customKey.trim()) ? customKey.trim() : process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY가 없습니다. 우측 상단의 API Key 인증 버튼을 클릭하여 본인의 API Key를 입력해주시거나, 로컬/클라우드 환경에 GEMINI_API_KEY 환경변수를 설정해주세요.");
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
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

      const parts: any[] = [];

      // Build prompt from inputs
      const promptText = `
        당신은 코칭패스의 '수석 서류평가위원'이자 대기업/공기업 채용 설계를 담당했던 HR 전문가입니다.
        제공된 서류 내용을 매우 날카롭고 세밀하게 분석하여, '합격할 수밖에 없는 서류'로 완벽하게 재탄생시키기 위한 독설적이면서도 건설적인 초정밀 첨삭 리포트를 작성하세요.
        전체적인 리포트의 분량은 평소보다 3배 이상, 최대한 방대하고 수준 높게 구성해야 합니다.

        전문 가이드라인:
        1. 양적/질적 극대화: 분석 리포트의 전체 분량은 최소 4,000자 이상을 목표로 매우 방대하고 디테일하게 작성해야 합니다.
        2. 압도적인 분량과 초정밀 분석: 문장 하나하나를 해부하듯 쪼개어 분석하세요. 단순히 오탈자나 문법 교정이 절대 아닙니다. 문맥의 흐름, 단어 선택이 채용 담당자에게 주는 매력도, 문장의 리듬과 호흡, 논리적 허점 등 전문가적 시각에서만 볼 수 있는 핵심 포인트들을 반드시 최저 "15개 이상" 찾아내어 Corrections 배열로 상세히 작성하세요.
        3. 역량과 숫자의 결합: 추상적인 설명("열심히 했다", "역량을 다해 노력했다")은 일절 차단하고, 참고 서류(이력서 등)의 상세 경력과 수치, 구체적인 성과, 비즈니스 액션을 문장 속에 정량화하여 삽입하고 신뢰도를 최고점까지 끌어올리세요.
        4. 비즈니스 ROI 관점: 이 경험을 지닌 지원자가 실무에 즉시 투입되었을 때 회사에 어떤 가치와 이익(ROI)을 안겨줄 수 있는지가 문장을 통해 직접적으로 느껴지도록 재정비해야 합니다.
        5. 시각적 가독성과 흐름:
           - 각 피드백 문단은 가독성을 극대화하기 위해 한 눈에 들어오도록 설계되어야 합니다.
           - 모든 소제목마다 문단을 구분하고 공백 라인을 두십시오.
        6. 철저한 호칭 맞춤형 규정 (보안 약속, 대단히 중요):
           - 분석의 해설 및 제안 이유를 담은 설명 문구(**corrections의 reason** 및 **finalAdvice** 전체)에서는 '지원자님', '귀하', '지원자', '본인' 등 일반적이고 상투적인 대명사를 단 한 번도 사용하지 마세요. 대신 사용자가 입력한 성함인 **"${name.trim()}님"**, **"${name.trim()}님은"**, **"${name.trim()}님의"** 등의 직관적인 호칭만을 정확하게 사용하여 깊은 신뢰 관계가 형성되는 프리미엄 맞춤 피드백을 전달하십시오.
           - **[절대 주의사항] 실제 첨삭 제안 문장인 'corrected' 필드 내부에는 복사하여 바로 이력서나 자기소개서에 제출할 수 있도록 어떠한 경우에도 지원자의 실명(이름)이나 '지원자님', '귀하', '본인' 등의 대명사를 절대 삽입해서는 안 됩니다. 반드시 본인이 작성하여 제출하는 형식의 순수한 1인칭 완성작이어야 합니다.**

        ${specialRequest ? `특히 다음 요청사항에 집중하여 평가위원의 시각에서 첨삭을 진행해주세요: "${specialRequest}"\n` : ''}
        
        분석 및 첨삭 가이드라인 (평가위원 관점):
        1. 채용공고 적합성: ${jobPostingData ? '제공된 채용공고의 직무 기술서(JD)와 자격 요건을 바탕으로, 지원자가 해당 직무에 얼마나 최적화된 인재인지 평가하고 부족한 키워드를 삽입하세요.' : '지원 직무의 일반적인 요구 역량과 비교하여 전문성이 드러나는지 확인하세요.'}
        ${jobMaterialData ? '1-1. 직무자료 반영: 제공된 직무자료를 바탕으로 해당 직무에 대한 깊은 이해도를 반영하여, 지원자의 경험이 실무에 어떻게 적용될 수 있는지 구체적으로 첨삭하세요.\n' : ''}
        ${experienceData ? '1-2. 경험정리 반영: 제공된 경험정리 자료를 바탕으로 지원자의 구체적인 경험과 성과를 자소서에 자연스럽게 녹여내고, 추상적인 표현을 구체적인 사례로 대체하세요.\n' : ''}
        ${referenceData ? '1-3. 참고자료 활용: 제공된 참고자료의 내용을 분석하여 첨삭 시 필요한 배경 지식이나 보충 정보로 적극 활용하세요.\n' : ''}
        
        응답 형식 (JSON):
        - corrections: 수정 사항들의 배열 (반드시 최소 15개 이상을 도출하고 각 항목을 세밀하고 극도로 정성껏 기술)
          - original: 수정이 필요한 원본 문장/문항
          - corrected: 평가위원이 합격시키고 싶을 정도로 압도적으로 개선된 완성형 제안 문항/문장 (실제 복사해서 바로 자소서 혹은 이력서에 제출할 수 있도록 100% 매끄럽고 완벽한 문장으로 고쳐 쓰십시오. 절대 지원자의 성함이나 '지원자님', '귀하' 등 부르는 호칭을 넣지 마십시오.)
          - reason: 이 문장이 수정되어야 하는 이유를 평가위원 관점, 부족한 수치적 증명, 채용 담당자가 기피하는 표현의 원인 분석, 개선방안의 비즈니스 임팩트를 포함하여 **최소 3문장 이상(한글 200자 이상)**의 대단히 깊이 있고 설득력 있는 분석으로 작성하십시오. 이 안에서 대상 호칭은 반드시 무조건 **"${name.trim()}님"**, **"${name.trim()}님의"** 등의 표현을 사용하십시오.
          - isSpecialRequestRelated: 해당 수정 사항이 사용자의 요청사항("${specialRequest || '없음'}")과 직접적으로 관련이 있는지 여부
        - finalAdvice: 서류 전체를 철저히 해부하고 검토한 후, 서류평가위원 입장에서 제시하는 프리미엄 조언 리포트입니다.
          - 다음 소제목들을 반드시 포함하여 작성해야 합니다: [총평], [핵심 역량 요약], [치명적 감점 요인], [전략적 제언], [향후 보완 전략 (예상 면접 질문 및 개발 필요 역량 포함)].
          - 각 소제목의 내용은 **한글 최소 400자 이상**으로 깊이 있게 조언을 전개해야 합니다. 추상적인 제안을 삼가고 행동 지침을 자세히 알려주세요.
          - 소제목은 반드시 대괄호([])로 감싸서 한 줄에 단독으로 작성하세요 (예: [총평]).
          - 각 항목 내부에서 내용이 달라질 때마다 반드시 실제 줄바꿈을 적용하여 가치를 더하십시오.
          - 설명하는 과정에서 호칭은 오직 **"${name.trim()}님"**, **"${name.trim()}님은"**, **"${name.trim()}님의"** 등 맞춤형 개인 호칭만을 철저하게 가동해 주십시오.
          - 주의: 텍스트 어디에도 별표 두 개(**)나 홑따옴표(')를 절대 사용하지 마세요. 모든 강조나 인용은 격식 있는 문단 서술 및 정중하고 고급스러운 전문적 표현으로 대체하십시오.
          - 주의사항: 직무 적합도나 서류 경쟁력 점수 등 어떠한 형태의 '점수'도 절대 포함하지 마세요.
          - 절대 '\\n\\n' 문자열을 그대로 출력하지 말고 실제 줄바꿈을 사용하세요.
      `;

      parts.push({ text: promptText });

      const addDocumentPart = (partName: string, data: any) => {
        if (!data) return;
        if (data.text) {
          parts.push({ text: `\n[${partName} 내용]\n${data.text.substring(0, 10000)}\n` });
        } else if (data.image) {
          parts.push({ text: `\n[${partName} 이미지]\n` });
          parts.push({
            inlineData: {
              mimeType: data.image.mimeType,
              data: data.image.data
            }
          });
        }
      };

      addDocumentPart('채용공고 (Target)', jobPostingData);
      addDocumentPart('참고용 이력서', resumeData);
      addDocumentPart('참고용 경력기술서', careerData);
      addDocumentPart('참고용 포트폴리오', portfolioData);
      addDocumentPart('참고용 직무자료', jobMaterialData);
      addDocumentPart('참고용 경험정리', experienceData);
      addDocumentPart('참고자료', referenceData);

      parts.push({ text: `\n[주요 서류 내용]:\n` });
      if (mainData.text) {
        parts.push({ text: mainData.text.substring(0, 15000) });
      } else if (mainData.image) {
        parts.push({
          inlineData: {
            mimeType: mainData.image.mimeType,
            data: mainData.image.data
          }
        });
      }

      const customKey = (req.headers['x-api-key'] as string) || (req.headers['authorization'] as string)?.replace('Bearer ', '');
      const ai = getGeminiClient(customKey);
      console.log(`Sending processDocument request to Gemini model for user: ${name}`);
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              corrections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    original: { type: Type.STRING },
                    corrected: { type: Type.STRING },
                    reason: { type: Type.STRING },
                    isSpecialRequestRelated: { type: Type.BOOLEAN },
                  },
                  required: ["original", "corrected", "reason", "isSpecialRequestRelated"],
                },
              },
              finalAdvice: { type: Type.STRING },
            },
            required: ["corrections", "finalAdvice"],
          },
        },
      });

      const resultText = response.text;
      if (!resultText) {
        return res.status(500).json({ error: "AI 분석 결과가 비어있습니다." });
      }

      res.json({ resultText });
    } catch (error: any) {
      console.error("AI Analysis error on server:", error);
      res.status(500).json({ error: error.message || "AI Analysis failed" });
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
          // Clean up any residual markdown symbols, stars, and single quotes
          const cleanText = pText
            .replace(/\[\/?(BLUE|RED|YELLOW)\]/g, '')
            .replace(/\*\*/g, '')
            .replace(/'/g, '');
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
