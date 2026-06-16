/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 서류 첨삭 분석의 공통 로직.
 * Claude(Anthropic) API를 사용하며, 모든 호출은 server.ts의 /api/analyze를 경유한다.
 */

// 입력 잘림 한도. Claude Opus 4.8의 큰 컨텍스트(최대 1M 토큰)를 활용해 넉넉히 둔다.
export const INPUT_LIMITS = {
  main: 60000,
  reference: 30000,
};

export type Severity = "치명적" | "중요" | "보완";

export interface DocData {
  text?: string;
  image?: { mimeType: string; data: string };
}

export interface Correction {
  original: string;
  corrected: string;
  reason: string;
  severity?: Severity;
  sourceBasis?: string;
  isSpecialRequestRelated?: boolean;
}

export interface AnalysisDocs {
  mainData: DocData;
  jobPostingData?: DocData;
  resumeData?: DocData;
  careerData?: DocData;
  portfolioData?: DocData;
  jobMaterialData?: DocData;
  experienceData?: DocData;
  referenceData?: DocData;
}

// Anthropic 구조화 출력(output_config.format)용 JSON Schema.
// 모든 object에 additionalProperties:false가 필요하고, required에 전체 필드를 명시한다.
export const ANALYSIS_SCHEMA: any = {
  type: "object",
  properties: {
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          corrected: { type: "string" },
          reason: { type: "string" },
          severity: { type: "string", enum: ["치명적", "중요", "보완"] },
          sourceBasis: { type: "string" },
          isSpecialRequestRelated: { type: "boolean" },
        },
        required: ["original", "corrected", "reason", "severity", "sourceBasis", "isSpecialRequestRelated"],
        additionalProperties: false,
      },
    },
    finalAdvice: { type: "string" },
  },
  required: ["corrections", "finalAdvice"],
  additionalProperties: false,
};

export function buildAnalysisPrompt(opts: {
  name: string;
  specialRequest?: string;
  has: {
    jobPosting?: boolean;
    jobMaterial?: boolean;
    experience?: boolean;
    reference?: boolean;
  };
}): string {
  const name = opts.name.trim();
  const sr = (opts.specialRequest || "").trim();
  const has = opts.has;

  return `
당신은 코칭패스의 '수석 서류평가위원'으로, 대기업·공기업 채용 설계를 담당했던 HR 전문가입니다.
제공된 서류를 채용 담당자의 냉정한 시선으로 정밀 분석하여, 합격 가능성을 실질적으로 끌어올리는 첨삭 리포트를 작성하십시오.

[최우선 원칙 — 반드시 준수]
1. 진실성(환각 절대 금지): 성과·수치·경력·사실은 제공된 서류에 실제로 존재하는 내용만 사용합니다. 근거 없는 숫자나 사실을 절대 지어내지 마십시오. 정량화가 필요하지만 자료에 수치가 없다면, 문장 안에 「[ 정량 수치 기입 필요: 예) 매출 OO% 개선 ]」 형태의 플레이스홀더를 남겨 ${name}님이 직접 채우도록 안내하십시오.
2. 임팩트 우선(분량보다 가치): 정해진 개수를 채우려 억지 지적을 만들지 마십시오. 합격 당락에 실제로 영향을 주는 지점만, 영향이 큰 순서로 다룹니다. 사소한 오탈자보다 논리 구조·직무 적합성·차별화 포인트처럼 결정적인 요소에 집중하십시오. 진짜 중요한 지적이 6개면 6개, 14개면 14개로 충분합니다. 같은 취지의 지적은 하나로 통합하십시오.
3. 근거 기반(추적 가능성): 각 지적이 어떤 입력 서류(주요 서류/채용공고/이력서/경력기술서/포트폴리오/직무자료/경험정리/참고자료)에 근거했는지 sourceBasis에 명시하십시오.

[첨삭 관점]
- 채용공고 적합성: ${has.jobPosting ? "제공된 채용공고의 직무기술서(JD)·자격요건 대비 적합도를 평가하고, 누락된 핵심 키워드를 문맥에 맞게 자연스럽게 보강하십시오." : "지원 직무의 일반적 요구 역량 대비 전문성이 충분히 드러나는지 점검하십시오."}
- 추상 표현 제거: "열심히 했다", "최선을 다했다" 류의 추상어를 구체적 행동·결과로 치환하십시오(단, 자료에 근거가 있는 사실만 사용).
- 비즈니스 가치: 이 경험을 지닌 사람이 입사 후 회사에 줄 가치가 문장에서 자연스럽게 드러나도록 재구성하십시오.
${has.experience ? "- 경험정리 자료의 구체적 경험·성과를 본문에 자연스럽게 녹여내고, 추상적 표현을 실제 사례로 대체하십시오.\n" : ""}${has.jobMaterial ? "- 직무자료를 반영해 실무 적용 가능성과 직무 이해도를 구체화하십시오.\n" : ""}${has.reference ? "- 참고자료의 내용을 배경지식·보충 정보로 활용하십시오.\n" : ""}${sr ? `\n[사용자 특별 요청] 다음을 우선적으로 반영하여 첨삭하십시오: "${sr}"\n` : ""}
[호칭 규칙 — 매우 중요]
- 해설(reason)과 finalAdvice에서는 '지원자님/귀하/지원자/본인' 같은 상투적 대명사를 단 한 번도 쓰지 말고, 오직 "${name}님", "${name}님은", "${name}님의" 형태의 실명 호칭만 사용해 1:1 맞춤 피드백의 신뢰감을 주십시오.
- 반대로 corrected(실제 제출용 문장)에는 어떤 경우에도 이름·호칭·대명사("${name}", "${name}님", "지원자님", "귀하", "본인")를 넣지 마십시오. ${name}님이 그대로 복사해 제출할 수 있는 순수 1인칭 완성문이어야 합니다.

[출력 형식 (JSON)]
- corrections: 수정 항목 배열
  - original: 수정이 필요한 원본 문장(원문에서 그대로 발췌)
  - corrected: 그대로 제출 가능한 완성형 문장 (호칭/이름 금지, 100% 매끄럽게)
  - reason: 왜 고쳐야 하는지 — 평가위원 관점, 채용 담당자가 기피하는 표현의 원인, 개선의 비즈니스 효과를 "${name}님" 호칭으로 설득력 있게 서술하십시오. (필요한 깊이만큼 충실히 쓰되, 형식적인 분량 채우기는 금지)
  - severity: 합격 영향도 — "치명적" | "중요" | "보완" 중 하나
  - sourceBasis: 이 지적의 근거가 된 입력 서류명
  - isSpecialRequestRelated: 특별 요청("${sr || "없음"}")과 직접 관련되는지 여부
- finalAdvice: 다음 소제목을 각각 대괄호로 감싸 한 줄에 단독 표기하고, 그 아래에 내용을 서술하십시오.
  소제목: [총평] [핵심 역량 요약] [치명적 감점 요인] [전략적 제언] [향후 보완 전략]
  - [향후 보완 전략]에는 예상 면접 질문과 개발이 필요한 역량을 포함하십시오.
  - 호칭은 오직 "${name}님" 형태만 사용하십시오.
  - 별표 두 개(**)나 홑따옴표(')를 절대 쓰지 말고, 점수·등급 등 어떤 형태의 평가 점수도 포함하지 마십시오.
  - '\\n\\n' 같은 이스케이프 문자를 그대로 출력하지 말고 실제 줄바꿈을 사용하십시오.
`;
}

export function buildVerifyPrompt(opts: { name: string }): string {
  const name = opts.name.trim();
  return `
당신은 코칭패스 수석 서류평가위원의 '검수 책임자'입니다.
아래에는 원본 서류와, 1차로 작성된 첨삭 초안(JSON)이 함께 제공됩니다.
초안을 검수하여 품질을 끌어올린 '최종본'을 동일한 JSON 스키마로 반환하십시오.

[검수 기준]
1. 환각 제거: 원본 서류에 근거가 없는 수치·사실·성과가 corrected나 reason에 있으면 삭제하거나 「[ 정량 수치 기입 필요 ]」 플레이스홀더로 교체하십시오.
2. 중복 통합: 같은 취지의 지적은 하나로 병합하십시오.
3. 임팩트 정렬: corrections를 합격 영향이 큰 순서(치명적 → 중요 → 보완)로 정렬하고, 임팩트가 사실상 없는 항목은 제거하십시오.
4. 호칭 점검: corrected에 이름·호칭·대명사("${name}", "${name}님", "지원자님", "귀하", "본인")가 섞였으면 제거하십시오. reason과 finalAdvice는 "${name}님" 호칭만 사용해야 합니다.
5. 완성도: corrected가 그대로 제출 가능한 자연스러운 문장인지 확인해 다듬고, severity·sourceBasis가 비어 있으면 채우십시오.

기존 규칙(진실성, 점수 미표기, 별표/홑따옴표 금지, 실제 줄바꿈)은 그대로 유지하며, 내용의 품질만 향상시킨 최종본을 반환하십시오.
`;
}

// 프롬프트를 제외한 '문서 content block' 배열만 생성한다(1차/2차 호출에서 재사용).
// Anthropic content block 형식: 텍스트는 {type:"text"}, 이미지는 {type:"image", source:{...}}.
export function buildDocParts(docs: AnalysisDocs): any[] {
  const parts: any[] = [];

  const add = (label: string, data: DocData | undefined, limit: number) => {
    if (!data) return;
    if (data.text) {
      parts.push({ type: "text", text: `\n[${label} 내용]\n${data.text.substring(0, limit)}\n` });
    } else if (data.image) {
      parts.push({ type: "text", text: `\n[${label} 이미지]\n` });
      parts.push({ type: "image", source: { type: "base64", media_type: data.image.mimeType, data: data.image.data } });
    }
  };

  add("채용공고 (Target)", docs.jobPostingData, INPUT_LIMITS.reference);
  add("참고용 이력서", docs.resumeData, INPUT_LIMITS.reference);
  add("참고용 경력기술서", docs.careerData, INPUT_LIMITS.reference);
  add("참고용 포트폴리오", docs.portfolioData, INPUT_LIMITS.reference);
  add("참고용 직무자료", docs.jobMaterialData, INPUT_LIMITS.reference);
  add("참고용 경험정리", docs.experienceData, INPUT_LIMITS.reference);
  add("참고자료", docs.referenceData, INPUT_LIMITS.reference);

  parts.push({ type: "text", text: `\n[주요 서류 내용]:\n` });
  if (docs.mainData?.text) {
    parts.push({ type: "text", text: docs.mainData.text.substring(0, INPUT_LIMITS.main) });
  } else if (docs.mainData?.image) {
    parts.push({ type: "image", source: { type: "base64", media_type: docs.mainData.image.mimeType, data: docs.mainData.image.data } });
  }

  return parts;
}

// Claude 한 번 호출 → 구조화 JSON 문자열을 반환한다.
// 리포트가 길어 timeout 위험이 있으므로 스트리밍 후 최종 메시지를 모은다.
// client 는 Anthropic SDK 인스턴스이므로 any 로 받는다.
async function generateStructured(client: any, model: string, content: any[]): Promise<string> {
  const stream = client.messages.stream({
    model,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
    messages: [{ role: "user", content }],
  });

  const message = await stream.finalMessage();
  const textBlock = (message.content || []).find((b: any) => b.type === "text");
  return textBlock ? (textBlock.text || "") : "";
}

/**
 * 2패스 분석: 1차 초안 생성 → 검수/정제 호출.
 * 검수 단계가 실패하면 1차 초안을 그대로 반환한다(graceful degradation).
 */
export async function runTwoPassAnalysis(
  client: any,
  args: { model: string; promptText: string; verifyPrompt: string; docParts: any[] }
): Promise<string> {
  const { model, promptText, verifyPrompt, docParts } = args;

  const draftText = await generateStructured(client, model, [
    { type: "text", text: promptText },
    ...docParts,
  ]);

  if (!draftText) {
    throw new Error("AI 분석 결과가 비어있습니다.");
  }

  try {
    const refinedText = await generateStructured(client, model, [
      { type: "text", text: verifyPrompt },
      ...docParts,
      { type: "text", text: `\n[검수할 1차 초안 JSON]\n${draftText}\n` },
    ]);
    return refinedText || draftText;
  } catch (e) {
    // 검수 단계 실패 시 1차 초안이라도 살린다.
    console.error("Verify pass failed, returning draft:", e);
    return draftText;
  }
}

const SEVERITY_ORDER: Record<string, number> = { 치명적: 0, 중요: 1, 보완: 2 };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// corrected 문장에 혹시 새어든 이름/호칭을 제거하는 안전망(2패스의 보조 장치).
export function sanitizeCorrected(text: string, name: string): string {
  if (!text) return text;
  let out = text;
  const n = (name || "").trim();
  if (n) {
    out = out.replace(new RegExp(`${escapeRegExp(n)}\\s*님(은|는|의|이|가|을|를|께서|께)?`, "g"), "");
    out = out.replace(new RegExp(escapeRegExp(n), "g"), "");
  }
  out = out.replace(/(지원자님|지원자|귀하)(은|는|의|이|가|을|를|께서|께)?/g, "");
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

// 임팩트(severity)순 정렬 + corrected 살균을 한 번에 적용한다.
export function sortAndSanitizeCorrections<T extends Correction>(corrections: T[], name: string): T[] {
  if (!Array.isArray(corrections)) return corrections;
  const cleaned = corrections.map((c) => ({
    ...c,
    corrected: sanitizeCorrected(c.corrected, name),
  }));
  return cleaned
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const sa = SEVERITY_ORDER[a.c.severity ?? "중요"] ?? 1;
      const sb = SEVERITY_ORDER[b.c.severity ?? "중요"] ?? 1;
      return sa === sb ? a.i - b.i : sa - sb;
    })
    .map((x) => x.c);
}
