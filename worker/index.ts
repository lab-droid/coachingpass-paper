/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cloudflare Worker 백엔드 (Hono).
 * 기존 Express(server.ts)의 /api/* 를 Workers 런타임으로 포팅한 것.
 * - 정적 자산(React SPA)은 ASSETS 바인딩이 처리하고, 비-API 경로는 SPA 폴백.
 * - 비밀키는 env.ANTHROPIC_API_KEY (Workers secret)에서 읽는다.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
} from "docx";
import {
  buildAnalysisPrompt,
  buildVerifyPrompt,
  buildDocParts,
  runTwoPassAnalysis,
} from "../src/shared/analysis";

type Bindings = {
  ANTHROPIC_API_KEY: string;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors());

// --- 유틸 ---
function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// --- 헬스체크 ---
app.get("/api/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

// --- 파일 텍스트/이미지 추출 (클라이언트 추출 실패 시 폴백) ---
app.post("/api/extract-text", async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "No file uploaded" }, 400);
    }

    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (/\.(png|jpe?g)$/.test(name)) {
      return c.json({
        image: { mimeType: file.type || "image/png", data: base64FromBytes(bytes) },
      });
    }
    if (name.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return c.json({ text: result.value });
    }
    if (name.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractPdfText(pdf, { mergePages: true });
      return c.json({ text });
    }
    if (name.endsWith(".txt")) {
      return c.json({ text: new TextDecoder().decode(bytes) });
    }
    return c.json({ error: "Unsupported file format." }, 400);
  } catch (error: any) {
    console.error("Extraction error:", error);
    return c.json({ error: error?.message || "Extraction failed" }, 500);
  }
});

// --- AI 첨삭 분석 (2패스) ---
app.post("/api/analyze", async (c) => {
  try {
    const body = await c.req.json<any>();
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
      referenceData,
    } = body;

    if (!name || !name.trim()) {
      return c.json({ error: "지원자 성함을 입력해주세요." }, 400);
    }
    if (!mainData) {
      return c.json({ error: "주요 서류 데이터가 누락되었습니다." }, 400);
    }

    const customKey =
      c.req.header("x-api-key") ||
      c.req.header("authorization")?.replace("Bearer ", "");
    const apiKey =
      customKey && customKey.trim() ? customKey.trim() : c.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return c.json(
        {
          error:
            "ANTHROPIC_API_KEY가 없습니다. 우측 상단의 API Key 인증 버튼으로 본인의 Anthropic API Key를 입력하시거나, Worker secret(ANTHROPIC_API_KEY)을 설정해주세요.",
        },
        500
      );
    }

    const client = new Anthropic({ apiKey });
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

    const resultText = await runTwoPassAnalysis(client, {
      model: "claude-opus-4-8",
      promptText,
      verifyPrompt,
      docParts,
    });

    if (!resultText) {
      return c.json({ error: "AI 분석 결과가 비어있습니다." }, 500);
    }
    return c.json({ resultText });
  } catch (error: any) {
    console.error("AI Analysis error on worker:", error);
    return c.json({ error: error?.message || "AI Analysis failed" }, 500);
  }
});

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

// --- 첨삭 결과 DOCX 생성 ---
app.post("/api/generate-docx", async (c) => {
  try {
    const { corrections, finalAdvice, name } = await c.req.json<any>();
    if (!Array.isArray(corrections)) {
      return c.json({ error: "Invalid corrections format" }, 400);
    }

    const children: Paragraph[] = [];
    const titleText = name ? `코칭패스 서류 첨삭_${name}` : "코칭패스 서류 첨삭 결과";
    children.push(
      new Paragraph({
        text: titleText,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: "본 서류는 코칭패스의 서류평가위원이자", bold: true, size: 24 }),
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

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: ` [중요도: ${severity}] `, bold: true, color: severityColor(severity) }),
            new TextRun({
              text: isSpecial ? " [요청사항 관련 문항] " : " [원본 문항] ",
              bold: true,
              color: isSpecial ? "008000" : "FF0000",
            }),
            new TextRun({
              text: item.original,
              shading: { fill: isSpecial ? "CCFFCC" : "FFFF00" },
            }),
          ],
          spacing: { before: 200, after: 100 },
        })
      );

      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: " [수정 제안] ", bold: true, color: "0000FF" }),
            new TextRun({ text: item.corrected }),
          ],
          spacing: { after: 100 },
        })
      );

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: " [첨삭 이유] ",
              bold: true,
              color: isSpecial ? "0000FF" : "008000",
            }),
            ...richRuns(item.reason, {
              italics: true,
              color: isSpecial ? "0000FF" : undefined,
            }),
          ],
          spacing: { after: item.sourceBasis ? 80 : 300 },
        })
      );

      if (item.sourceBasis) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `근거 자료: ${item.sourceBasis}`, size: 18, color: "808080" })],
            spacing: { after: 300 },
          })
        );
      }
    }

    if (finalAdvice) {
      children.push(
        new Paragraph({
          text: "평가위원의 최종 조언",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );
      const adviceParagraphs = String(finalAdvice)
        .split("\n")
        .filter((p: string) => p.trim() !== "");
      for (const pText of adviceParagraphs) {
        const cleanText = pText
          .replace(/\[\/?(BLUE|RED|YELLOW)\]/g, "")
          .replace(/'/g, "");
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

    const doc = new Document({ sections: [{ properties: {}, children }] });
    const blob = await Packer.toBlob(doc);
    const filename = name ? `코칭패스 서류 첨삭_${name}.docx` : "corrected_document.docx";

    return new Response(blob, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename=${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    console.error("Generation error:", error);
    return c.json({ error: "Failed to generate document" }, 500);
  }
});

// --- API 404 (JSON) ---
app.all("/api/*", (c) =>
  c.json({ error: `API route not found: ${c.req.method} ${new URL(c.req.url).pathname}` }, 404)
);

// --- 그 외 모든 요청은 정적 자산(SPA)으로 ---
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
