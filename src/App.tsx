/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  FileText, 
  Upload, 
  Download, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ArrowRight,
  FileUp,
  MessageSquareQuote,
  ShieldCheck,
  RotateCcw,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  sortAndSanitizeCorrections,
  type Severity,
} from './shared/analysis';

interface Correction {
  original: string;
  corrected: string;
  reason: string;
  severity?: Severity;
  sourceBasis?: string;
  isSpecialRequestRelated?: boolean;
}

interface AnalysisResult {
  corrections: Correction[];
  finalAdvice: string;
}

// 인라인 **굵게** 마크다운을 <strong>으로 렌더링한다(소제목 강조용).
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

// 빈 줄 기준으로 문단을 나눈다(가독성을 위한 문단 분리).
function splitParagraphs(text: string): string[] {
  return String(text || '')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ── 리포트 HTML 생성 (PDF 인쇄 + Docs 복사 공용) ──
// 인라인 스타일만 사용해 Google Docs 붙여넣기에서도 서식이 유지되도록 한다.
function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// HTML 이스케이프 후 **굵게** 를 <strong>으로 변환한다.
function inlineHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function paragraphsHtml(text: string, pStyle: string): string {
  return splitParagraphs(text)
    .map((p) => `<p style="${pStyle}">${inlineHtml(p)}</p>`)
    .join('');
}

const SEV_COLOR: Record<string, string> = {
  치명적: '#c0392b',
  중요: '#c87f0a',
  보완: '#b7791f',
};

interface ReportItem {
  original: string;
  corrected: string;
  reason: string;
  severity?: Severity;
  sourceBasis?: string;
  isSpecialRequestRelated?: boolean;
}

// 첨삭 결과 전체를 매력적인 서식의 HTML 문자열로 만든다.
// 디자인 콘셉트: 블랙 + 골드 + 화이트를 섞은 프리미엄 리포트.
// 인라인 스타일만 사용하고, 검은 배경/골드가 PDF 인쇄에서도 그대로 나오도록
// 색 면(面)이 들어가는 요소마다 print-color-adjust:exact 를 부여한다.
function buildReportHtml(opts: {
  name: string;
  specialRequest?: string;
  corrections: ReportItem[];
  finalAdvice: string;
}): string {
  const name = (opts.name || '').trim();
  const sr = (opts.specialRequest || '').trim();
  const items = opts.corrections || [];
  const counts: Record<string, number> = { 치명적: 0, 중요: 0, 보완: 0 };
  items.forEach((c) => {
    const k = c.severity || '중요';
    counts[k] = (counts[k] || 0) + 1;
  });

  // 색 면이 인쇄에서 사라지지 않도록 강제하는 스니펫.
  const ce = '-webkit-print-color-adjust:exact;print-color-adjust:exact;';
  const GOLD = '#C5A028';
  const GOLD_SOFT = '#E4C76B';
  const INK = '#0E0E0E';

  // 바깥 래퍼는 전체 폭(표지 풀블리드용), 본문은 별도 컨테이너에서 폭·여백을 준다.
  const outer =
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Apple SD Gothic Neo",sans-serif;color:#1a1a1a;line-height:1.8;background:#ffffff;';
  // @page margin:0 이므로 본문 여백은 여기서 준다.
  const content = 'max-width:780px;margin:0 auto;padding:18mm 22px 22mm;';

  // ── 표지(첫 페이지 전체를 채우는 풀페이지 커버) ──
  // A4 한 장을 가득 채우고(min-height:297mm) 다음 내용을 다음 페이지로 넘긴다.
  const cover = `
    <div style="${ce}background:${INK};color:#ffffff;min-height:297mm;box-sizing:border-box;padding:118mm 50px 0;page-break-after:always;break-after:page;">
      <div style="font-size:13px;letter-spacing:7px;color:${GOLD};font-weight:800;">C O A C H I N G&nbsp;&nbsp;P A S S</div>
      <div style="${ce}width:60px;height:3px;background:${GOLD};margin:22px 0 26px;border-radius:3px;"></div>
      <h1 style="font-size:46px;font-weight:800;margin:0;letter-spacing:-1px;line-height:1.2;color:#ffffff;">서류 첨삭 솔루션</h1>
      ${name ? `<div style="font-size:22px;font-weight:700;color:${GOLD_SOFT};margin:18px 0 0;">${escapeHtml(name)}님</div>` : ''}
      <p style="font-size:15px;color:#b8b8b8;margin:30px 0 0;line-height:1.8;">채용 담당자의 냉정한 시선으로 정밀 진단한 1:1 맞춤 첨삭 솔루션입니다.<br>합격 가능성을 실질적으로 끌어올릴 핵심 포인트만 담았습니다.</p>
    </div>`;

  // ── 진단 요약: 다크 스트립 + 골드 라벨 ──
  const summary = `
    <div style="${ce}background:#161616;border:1px solid #2c2c2c;border-radius:14px;padding:15px 22px;margin:0 0 18px;font-size:13px;color:#eaeaea;">
      <span style="font-weight:800;letter-spacing:1.5px;color:${GOLD};">진단 요약</span>
      <span style="color:#555;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>
      <span>총 <strong style="color:#ffffff;">${items.length}</strong>개 첨삭 포인트</span>
      <span style="color:#e8705f;font-weight:700;">&nbsp;&nbsp;· 치명적 ${counts['치명적']}</span>
      <span style="color:#e6a945;font-weight:700;">&nbsp;&nbsp;· 중요 ${counts['중요']}</span>
      <span style="color:#d8b86e;font-weight:700;">&nbsp;&nbsp;· 보완 ${counts['보완']}</span>
    </div>`;

  const requestBox = sr
    ? `<div style="${ce}border-left:4px solid ${GOLD};background:#fbf6e9;border-radius:10px;padding:13px 17px;margin:0 0 22px;font-size:13px;color:#5a4a16;"><strong style="color:#8a6d12;letter-spacing:0.5px;">✦ 반영한 특별 요청&nbsp;&nbsp;</strong>${escapeHtml(sr)}</div>`
    : '';

  // 섹션 제목 바(블랙 + 골드 액센트).
  const sectionBar = (label: string, suffix = '') => `
    <div style="${ce}background:${INK};border-left:4px solid ${GOLD};border-radius:10px;padding:13px 20px;margin:26px 0 18px;">
      <span style="font-size:15px;font-weight:800;color:#ffffff;letter-spacing:0.4px;">${label}</span>${suffix ? `<span style="color:${GOLD};font-weight:800;font-size:15px;">&nbsp;&nbsp;${suffix}</span>` : ''}
    </div>`;

  const correctionsHtml = items
    .map((item, idx) => {
      const color = SEV_COLOR[item.severity || '중요'] || '#c87f0a';
      const badge = `<span style="${ce}display:inline-block;font-size:11px;font-weight:800;color:#fff;background:${color};border-radius:20px;padding:3px 11px;">${escapeHtml(item.severity || '중요')}</span>`;
      const special = item.isSpecialRequestRelated
        ? `<span style="${ce}display:inline-block;font-size:11px;font-weight:700;color:#16803a;background:#e7f6ec;border-radius:20px;padding:3px 10px;">· 요청사항 반영</span>`
        : '';
      return `
      <div style="${ce}margin:0 0 20px;border:1px solid #e8e8e8;border-radius:18px;overflow:hidden;background:#ffffff;break-inside:avoid;page-break-inside:avoid;">
        <div style="${ce}background:#fafafa;border-bottom:1px solid #efefef;padding:13px 22px;">
          <span style="${ce}display:inline-block;font-size:12px;font-weight:800;color:#fff;background:${INK};border-radius:8px;padding:3px 11px;vertical-align:middle;">#${idx + 1}</span>
          &nbsp;&nbsp;${badge}&nbsp;${special}
        </div>
        <div style="padding:20px 22px;">
          <div style="margin:0 0 16px;">
            <div style="font-size:10px;font-weight:800;letter-spacing:1.8px;color:#9a9a9a;margin:0 0 8px;">기존 내용</div>
            <p style="${ce}font-size:13px;color:#6f6f6f;font-style:italic;margin:0;padding:12px 15px;background:#f5f5f5;border-left:3px solid #dcdcdc;border-radius:9px;line-height:1.8;">${inlineHtml(item.original)}</p>
          </div>
          <div style="${ce}background:${INK};border:1px solid #2a2a2a;border-radius:14px;padding:17px 19px;margin:0 0 16px;">
            <div style="font-size:10px;font-weight:800;letter-spacing:1.8px;color:${GOLD};margin:0 0 9px;">✦ 서류평가위원 첨삭안</div>
            <p style="font-size:14.5px;font-weight:600;color:#ffffff;margin:0;line-height:1.9;">${inlineHtml(item.corrected)}</p>
          </div>
          <div style="border-top:1px solid #eee;padding-top:14px;">
            <div style="font-size:10px;font-weight:800;letter-spacing:1.8px;color:${GOLD};margin:0 0 4px;">평가위원 심층 분석</div>
            ${paragraphsHtml(item.reason, `font-size:13px;color:#3a3a3a;margin:10px 0 0;line-height:1.9;`)}
          </div>
          ${item.sourceBasis ? `<p style="font-size:11px;color:#a8a8a8;margin:13px 0 0;padding-top:10px;border-top:1px dashed #ececec;">근거 자료 · ${escapeHtml(item.sourceBasis)}</p>` : ''}
        </div>
      </div>`;
    })
    .join('');

  // ── 최종 조언: [소제목] 단위로 카드를 나눠 가독성과 분량감을 높인다 ──
  let adviceHtml = '';
  if (opts.finalAdvice) {
    interface AdvSec { title: string; paras: string[]; }
    const secs: AdvSec[] = [];
    let cur: AdvSec | null = null;
    splitParagraphs(opts.finalAdvice).forEach((p) => {
      const m = p.trim().match(/^(\d+\.\s*)?\[(.*?)\]$/);
      if (m) {
        cur = { title: m[2].trim(), paras: [] };
        secs.push(cur);
      } else {
        if (!cur) {
          cur = { title: '종합 총평', paras: [] };
          secs.push(cur);
        }
        cur.paras.push(p);
      }
    });
    const cards = secs
      .map(
        (s) => `
      <div style="${ce}border:1px solid #e8e8e8;border-radius:16px;overflow:hidden;margin:0 0 14px;break-inside:avoid;page-break-inside:avoid;">
        <div style="${ce}background:${INK};border-left:4px solid ${GOLD};padding:12px 19px;">
          <span style="font-size:13.5px;font-weight:800;color:${GOLD_SOFT};letter-spacing:0.4px;">${escapeHtml(s.title)}</span>
        </div>
        <div style="padding:16px 19px;background:#ffffff;">
          ${s.paras.map((p) => `<p style="font-size:13px;color:#333;margin:0 0 11px;line-height:1.9;">${inlineHtml(p)}</p>`).join('')}
        </div>
      </div>`
      )
      .join('');
    adviceHtml = `${sectionBar('평가위원의 최종 조언')}${cards}`;
  }

  const footer = `
    <div style="${ce}background:${INK};border-radius:16px;padding:20px;margin-top:28px;text-align:center;">
      <div style="font-size:11px;letter-spacing:4px;color:${GOLD};font-weight:800;">COACHING&nbsp;PASS</div>
      <div style="font-size:11px;color:#888;margin-top:7px;letter-spacing:0.5px;">합격을 설계하는 프리미엄 서류 첨삭</div>
    </div>`;

  return `<div style="${outer}">${cover}<div style="${content}">${summary}${requestBox}${sectionBar('정밀 첨삭 포인트', String(items.length))}${correctionsHtml}${adviceHtml}${footer}</div></div>`;
}

// HTML을 단순 텍스트로 환원한다(Docs 미지원 환경의 폴백 + text/plain).
function htmlToPlain(html: string): string {
  return html
    .replace(/<\/(p|h1|h2|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// 서버/Anthropic 원본 오류 문자열을 사용자 친화적 안내로 변환한다.
// 키 관련 오류(401/권한/결제)는 "API Key 설정"으로 유도한다.
function friendlyAnalyzeError(raw: string): string {
  const r = (raw || '').toLowerCase();
  if (r.includes('invalid x-api-key') || r.includes('authentication_error') || /\b401\b/.test(r)) {
    return '입력하신 API 키가 유효하지 않습니다. 우측 상단 "API Key" → "키 삭제"로 지우고 다시 시도하시거나, Anthropic Console에서 올바른 키를 복사해 입력해주세요.';
  }
  if (r.includes('permission_error') || r.includes('billing') || /\b403\b/.test(r) || r.includes('forbidden')) {
    return 'API 키에 모델 접근 권한이 없거나 결제 문제로 요청이 거부되었습니다. "API Key"에 권한 있는 키를 입력하거나 Anthropic Console에서 결제·권한을 확인해주세요.';
  }
  if (r.includes('rate_limit') || /\b429\b/.test(r)) {
    return '요청이 일시적으로 너무 많습니다(rate limit). 잠시 후 다시 시도해주세요.';
  }
  return `AI 분석 중 오류가 발생했습니다: ${raw}`;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [careerFile, setCareerFile] = useState<File | null>(null);
  const [portfolioFile, setPortfolioFile] = useState<File | null>(null);
  const [jobPostingFile, setJobPostingFile] = useState<File | null>(null);
  const [jobMaterialFile, setJobMaterialFile] = useState<File | null>(null);
  const [experienceFile, setExperienceFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [name, setName] = useState<string>('');
  const [specialRequest, setSpecialRequest] = useState<string>('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  // 사용자가 직접 입력한 Anthropic API Key. localStorage에 보관해 새로고침에도 유지된다.
  // 입력되면 /api/analyze 요청에 x-api-key 헤더로 실려 서버의 기본 키 대신 사용된다.
  // HTTP 헤더 값은 ISO-8859-1만 허용되므로, 복붙 시 섞이는 제로폭 공백·스마트따옴표·전각문자
  // 등(출력 가능한 ASCII가 아닌 모든 문자)을 제거해야 fetch가 헤더를 만들 수 있다.
  const sanitizeApiKey = (key: string) => (key || '').replace(/[^\x21-\x7E]/g, '');
  const [apiKey, setApiKey] = useState<string>(() => {
    try { return sanitizeApiKey(localStorage.getItem('anthropic_api_key') || ''); } catch { return ''; }
  });
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const saveApiKey = (key: string) => {
    const k = sanitizeApiKey(key);
    setApiKey(k);
    try {
      if (k) localStorage.setItem('anthropic_api_key', k);
      else localStorage.removeItem('anthropic_api_key');
    } catch { /* localStorage 비활성 환경은 무시 */ }
    setShowApiKeyModal(false);
  };
  // ── 관리자 모드 ──
  // API Key 입력은 관리자 암호 입력 후에만 노출한다(일반 사용자에겐 숨김).
  // 암호 검증은 서버(/api/admin-auth)에서 수행한다 → 암호가 클라이언트 번들·devtools에
  // 노출되지 않는다. (단, 관리자 진입 '상태' 자체는 클라이언트 측이므로 강한 보안은 아님)
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try { return localStorage.getItem('cp_admin') === '1'; } catch { return false; }
  });
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPwDraft, setAdminPwDraft] = useState('');
  const [adminPwError, setAdminPwError] = useState<string | null>(null);
  const [adminChecking, setAdminChecking] = useState(false);
  const openAdminModal = () => { setAdminPwDraft(''); setAdminPwError(null); setShowAdminModal(true); };
  const submitAdminPw = async () => {
    if (adminChecking) return;
    setAdminChecking(true);
    setAdminPwError(null);
    try {
      const res = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPwDraft }),
      });
      if (res.ok) {
        setIsAdmin(true);
        try { localStorage.setItem('cp_admin', '1'); } catch { /* 무시 */ }
        setShowAdminModal(false);
        setAdminPwDraft('');
        // 진입 직후 바로 API Key 입력 모달을 연다.
        setApiKeyDraft(apiKey);
        setShowApiKeyModal(true);
      } else {
        setAdminPwError('관리자 암호가 올바르지 않습니다.');
      }
    } catch {
      setAdminPwError('인증 요청에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setAdminChecking(false);
    }
  };
  const exitAdmin = () => {
    setIsAdmin(false);
    try { localStorage.removeItem('cp_admin'); } catch { /* 무시 */ }
  };
  const [finalAdvice, setFinalAdvice] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const fileName = selectedFile.name.toLowerCase();
      if (fileName.endsWith('.docx') || fileName.endsWith('.pdf') || fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        setFile(selectedFile);
        setError(null);
      } else {
        setError('현재는 .docx, .pdf, .png, .jpg 파일만 지원합니다.');
        setFile(null);
      }
    }
  };

  const processDocument = async () => {
    if (!file) return;

    if (!name.trim()) {
      setError('지원자 성함을 입력해주세요.');
      return;
    }

    let progressInterval: NodeJS.Timeout | null = null;

    try {
      setIsExtracting(true);
      setError(null);
      setCorrections([]);
      setProgress(0);
      setProgressMessage('파일 추출 준비 중...');

      // Helper to extract text from a file
      const extractText = async (targetFile: File) => {
        const fileExtension = targetFile.name.substring(targetFile.name.lastIndexOf('.')).toLowerCase();
        
        try {
          if (['.png', '.jpg', '.jpeg'].includes(fileExtension)) {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                const commaIndex = result.indexOf(',');
                resolve(commaIndex !== -1 ? result.substring(commaIndex + 1) : result);
              };
              reader.onerror = reject;
              reader.readAsDataURL(targetFile);
            });
            return {
              image: {
                mimeType: targetFile.type || `image/${fileExtension.substring(1)}`,
                data: base64
              }
            };
          } else if (fileExtension === '.txt') {
            const text = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsText(targetFile, 'utf-8');
            });
            return { text };
          } else if (fileExtension === '.docx') {
            const arrayBuffer = await targetFile.arrayBuffer();
            // @ts-ignore
            if (window.mammoth) {
              // @ts-ignore
              const result = await window.mammoth.extractRawText({ arrayBuffer });
              return { text: result.value };
            } else {
              throw new Error('Mammoth.js가 아직 로드되지 않았습니다.');
            }
          } else if (fileExtension === '.pdf') {
            const arrayBuffer = await targetFile.arrayBuffer();
            // @ts-ignore
            const pdfjsLib = window.pdfjsLib;
            if (pdfjsLib) {
              pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js';
              const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
              let text = '';
              for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str || '').join(' ');
                text += pageText + '\n';
              }
              return { text: text.trim() };
            } else {
              throw new Error('PDF.js가 아직 로드되지 않았습니다.');
            }
          }
        } catch (clientErr: any) {
          console.warn('전 브라우저 내 추출 실패, 서버 Fallback 실행:', clientErr);
        }

        // Fallback to Server
        const formData = new FormData();
        formData.append('file', targetFile);
        
        try {
          const res = await fetch('/api/extract-text', {
            method: 'POST',
            body: formData,
          });
          
          if (!res.ok) {
            let errMsg = '';
            try {
              const errData = await res.json();
              errMsg = errData.details || errData.error || '알 수 없는 오류';
            } catch {
              errMsg = res.statusText;
            }
            throw new Error(`${targetFile.name} 추출 실패: ${errMsg}`);
          }
          
          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            throw new Error(`서버에서 올바르지 않은 응답 형식을 반환했습니다. (API 서버가 작동하지 않거나 HTML이 반환됨)`);
          }
          
          return await res.json();
        } catch (fetchErr: any) {
          console.error('Fetch error during extraction:', fetchErr);
          throw new Error(`파일 추출 중 네트워크 오류가 발생했습니다: ${fetchErr.message}`);
        }
      };

      // 1. Extract text/image from all provided files
      let mainData: any = null;
      let resumeData: any = null;
      let careerData: any = null;
      let portfolioData: any = null;
      let jobPostingData: any = null;
      let jobMaterialData: any = null;
      let experienceData: any = null;
      let referenceData: any = null;

      const filesToExtract = [
        { file: file, name: '주요 서류', setter: (d: any) => mainData = d },
        { file: jobPostingFile, name: '채용공고', setter: (d: any) => jobPostingData = d },
        { file: resumeFile, name: '이력서', setter: (d: any) => resumeData = d },
        { file: careerFile, name: '경력기술서', setter: (d: any) => careerData = d },
        { file: portfolioFile, name: '포트폴리오', setter: (d: any) => portfolioData = d },
        { file: jobMaterialFile, name: '직무자료', setter: (d: any) => jobMaterialData = d },
        { file: experienceFile, name: '경험정리', setter: (d: any) => experienceData = d },
        { file: referenceFile, name: '참고자료', setter: (d: any) => referenceData = d },
      ].filter(f => f.file !== null);

      setProgressMessage('서류 데이터 추출 중...');
      try {
        // Parallel extraction to save time and avoid individual timeouts
        await Promise.all(filesToExtract.map(async (item) => {
          try {
            const data = await extractText(item.file!);
            item.setter(data);
          } catch (e: any) {
            console.warn(`${item.name} extraction failed`, e);
            if (item.name === '주요 서류') {
              throw e;
            }
          }
        }));
      } catch (err: any) {
        throw err;
      }
      
      setProgress(30);

      if (!mainData || (!mainData.text && !mainData.image)) {
        throw new Error('주요 서류에서 데이터를 찾을 수 없습니다.');
      }

      setIsExtracting(false);
      setIsAnalyzing(true);
      setProgressMessage('AI 분석 및 첨삭 진행 중...');
      setProgress(40);

      progressInterval = setInterval(() => {
        setProgress(p => p < 95 ? p + 1 : p);
      }, 600);

      // 2. Claude로 분석 (서버 /api/analyze 경유, 서버의 ANTHROPIC_API_KEY 사용)
      // 분석은 수 분이 걸릴 수 있어 서버가 NDJSON 스트림(ping/result/error)으로 응답한다.
      // ping이 끊기면(서버 중단) idle 타임아웃으로 무한 대기를 방지한다.
      let resultText = '';
      {
        const controller = new AbortController();
        const IDLE_MS = 45000; // 마지막 수신 후 이 시간 동안 무응답이면 중단
        let idleTimer: ReturnType<typeof setTimeout>;
        const resetIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => controller.abort(), IDLE_MS);
        };
        const abortMsg = 'AI 분석 응답이 지연되어 중단되었습니다. 잠시 후 다시 시도해주세요.';
        resetIdle();

        let response: Response;
        try {
          response = await fetch('/api/analyze', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // 사용자가 본인 키를 입력했으면 그 키로 호출한다(서버 기본 키 대신).
              // 헤더는 ISO-8859-1만 허용되므로 전송 직전에도 한 번 더 정제한다.
              ...(sanitizeApiKey(apiKey) ? { 'x-api-key': sanitizeApiKey(apiKey) } : {}),
            },
            signal: controller.signal,
            body: JSON.stringify({
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
            })
          });
        } catch (e: any) {
          clearTimeout(idleTimer);
          throw e?.name === 'AbortError' ? new Error(abortMsg) : e;
        }

        if (!response.ok) {
          clearTimeout(idleTimer);
          let errMsg = '';
          try {
            const errData = await response.json();
            errMsg = errData.error || '알 수 없는 오류';
          } catch {
            errMsg = `HTTP error ${response.status}`;
          }
          throw new Error(friendlyAnalyzeError(errMsg));
        }
        if (!response.body) {
          clearTimeout(idleTimer);
          throw new Error('AI 분석 응답 본문이 비어있습니다.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamErr: string | null = null;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            resetIdle();
            buffer += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line) continue;
              let msg: any;
              try { msg = JSON.parse(line); } catch { continue; }
              if (msg.type === 'result') resultText = msg.resultText || '';
              else if (msg.type === 'error') streamErr = msg.error || 'AI 분석 실패';
              // msg.type === 'ping' 은 연결 유지용이므로 무시
            }
          }
        } catch (e: any) {
          clearTimeout(idleTimer);
          throw e?.name === 'AbortError' ? new Error(abortMsg) : e;
        }
        clearTimeout(idleTimer);

        if (streamErr) throw new Error(friendlyAnalyzeError(streamErr));
        if (!resultText) throw new Error('AI 분석 결과가 비어있습니다.');
      }

      let parsedResult: AnalysisResult;
      try {
        // Clean markdown if present
        const cleanedText = resultText.replace(/```json\n?|```/g, '').trim();
        parsedResult = JSON.parse(cleanedText);
      } catch (parseErr) {
        console.error('JSON parse error. Raw text:', resultText);
        throw new Error('AI 응답 형식이 올바르지 않습니다. 다시 시도해주세요.');
      }

      // 임팩트(severity)순 정렬 + corrected에 새어든 이름/호칭 제거(안전망)
      const processedCorrections = sortAndSanitizeCorrections(parsedResult.corrections, name);

      setCorrections(processedCorrections);
      setFinalAdvice(parsedResult.finalAdvice);

      if (progressInterval) clearInterval(progressInterval);
      setProgress(100);
      setProgressMessage('첨삭 완료! "PDF로 저장" 또는 "Docs로 복사"로 결과를 가져가세요.');

    } catch (err: any) {
      if (progressInterval) clearInterval(progressInterval);
      console.error('Analysis error details:', err);
      let errorMessage = '처리 중 오류가 발생했습니다.';

      
      if (err.message?.includes('INTERNAL')) {
        errorMessage = 'AI 서비스 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (텍스트 양이 너무 많을 수 있습니다)';
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setIsExtracting(false);
      setIsAnalyzing(false);
    }
  };

  const downloadCorrectedDoc = async (passedCorrections?: Correction[], passedAdvice?: string, passedName?: string) => {
    const currentCorrections = passedCorrections || corrections;
    const currentAdvice = passedAdvice || finalAdvice;
    const currentName = passedName || name;

    if (currentCorrections.length === 0) return;

    try {
      setIsGenerating(true);
      const res = await fetch('/api/generate-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          corrections: currentCorrections, 
          finalAdvice: currentAdvice, 
          name: currentName 
        }),
      });

      if (!res.ok) throw new Error('문서 생성에 실패했습니다.');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const downloadName = name ? `코칭패스 서류 첨삭_${name}.docx` : `첨삭결과_${file?.name || 'document.docx'}`;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError('문서 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResumeFile(null);
    setCareerFile(null);
    setPortfolioFile(null);
    setJobPostingFile(null);
    setJobMaterialFile(null);
    setExperienceFile(null);
    setReferenceFile(null);
    setName('');
    setSpecialRequest('');
    setError(null);
    setCorrections([]);
    setFinalAdvice('');
    setProgress(0);
    setProgressMessage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 브라우저 인쇄 대화상자를 띄워 'PDF로 저장'을 유도한다(한글 벡터 텍스트, 고품질).
  const printReport = () => {
    window.print();
  };

  // 서식·레이아웃이 보존된 HTML을 클립보드에 담아 Google Docs에 그대로 붙여넣게 한다.
  const copyToDocs = async () => {
    const html = buildReportHtml({ name, specialRequest, corrections, finalAdvice });
    const plain = htmlToPlain(html);
    try {
      const Clip = (window as any).ClipboardItem;
      if (navigator.clipboard && Clip) {
        const item = new Clip({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(plain);
      } else {
        throw new Error('clipboard unsupported');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch (e) {
      setError('복사에 실패했습니다. 브라우저 권한(클립보드)을 확인하거나 PDF로 저장을 이용해주세요.');
    }
  };

  return (
    <>
    <div className="screen-only min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-metallic-gold selection:text-black">
      {/* Header */}
      <header className="bg-black/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-metallic-gold/15 border border-metallic-gold/30">
              <img
                id="header-logo-image"
                src="/logo.svg"
                alt="CoachingPass Logo"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <h1 className="text-xl font-black tracking-tighter text-white">
              코칭패스 <span className="text-metallic-gold">서류 첨삭 AI</span>
            </h1>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="hidden sm:block text-[10px] font-bold tracking-widest text-metallic-gold border border-metallic-gold/30 px-3 py-1.5 rounded-full uppercase">
              전문 평가위원 AI
            </div>
            {isAdmin ? (
              <>
                <button
                  type="button"
                  onClick={() => { setApiKeyDraft(apiKey); setShowApiKeyModal(true); }}
                  className={`text-[11px] font-bold tracking-wide px-3 py-1.5 rounded-full border transition-colors ${
                    apiKey
                      ? 'border-metallic-gold/60 text-metallic-gold bg-metallic-gold/10'
                      : 'border-white/20 text-gray-300 hover:border-white/40 hover:text-white'
                  }`}
                  title="Anthropic API Key 설정"
                >
                  {apiKey ? '● API Key' : 'API Key'}
                </button>
                <button
                  type="button"
                  onClick={exitAdmin}
                  className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded-full border border-white/15 text-gray-400 hover:text-white hover:border-white/30 transition-colors"
                  title="관리자 모드 해제"
                >
                  관리자 해제
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={openAdminModal}
                className="text-[11px] font-bold tracking-wide px-3 py-1.5 rounded-full border border-white/20 text-gray-300 hover:border-white/40 hover:text-white transition-colors"
                title="관리자 모드"
              >
                관리자 모드
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── 관리자 암호 모달 ── */}
      {showAdminModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          onClick={() => setShowAdminModal(false)}
        >
          <div
            className="w-full max-w-sm bg-[#141414] border border-white/10 rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-white">관리자 모드</h3>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              관리자 암호를 입력하면 API Key를 설정할 수 있습니다.
            </p>
            <input
              type="password"
              value={adminPwDraft}
              onChange={(e) => { setAdminPwDraft(e.target.value); setAdminPwError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitAdminPw(); }}
              placeholder="관리자 암호"
              autoFocus
              disabled={adminChecking}
              className="w-full mt-4 bg-black/50 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-metallic-gold/60 focus:outline-none disabled:opacity-60"
            />
            {adminPwError && (
              <p className="text-xs text-red-400 mt-2">{adminPwError}</p>
            )}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowAdminModal(false)}
                className="text-sm font-bold text-gray-300 hover:text-white px-4 py-2"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitAdminPw}
                disabled={adminChecking}
                className="text-sm font-black text-black bg-metallic-gold hover:bg-metallic-gold/90 rounded-xl px-5 py-2 disabled:opacity-60"
              >
                {adminChecking ? '확인 중…' : '확인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── API Key 설정 모달 ── */}
      {showApiKeyModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          onClick={() => setShowApiKeyModal(false)}
        >
          <div
            className="w-full max-w-md bg-[#141414] border border-white/10 rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-white">Anthropic API Key</h3>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              본인의 Anthropic API Key를 입력하면 서버 기본 키 대신 이 키로 첨삭이 실행됩니다.
              키는 이 브라우저(localStorage)에만 저장되며 서버에 보관되지 않습니다.
            </p>
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder="sk-ant-..."
              autoFocus
              spellCheck={false}
              className="w-full mt-4 bg-black/50 border border-white/15 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:border-metallic-gold/60 focus:outline-none"
            />
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="inline-block text-[11px] text-metallic-gold/80 hover:text-metallic-gold mt-2"
            >
              API Key 발급받기 →
            </a>
            <div className="flex items-center justify-between gap-2 mt-5">
              <button
                type="button"
                onClick={() => saveApiKey('')}
                className="text-xs font-bold text-gray-400 hover:text-red-400 px-2 py-2"
                disabled={!apiKey}
              >
                키 삭제
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowApiKeyModal(false)}
                  className="text-sm font-bold text-gray-300 hover:text-white px-4 py-2"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => saveApiKey(apiKeyDraft)}
                  className="text-sm font-black text-black bg-metallic-gold hover:bg-metallic-gold/90 rounded-xl px-5 py-2"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          
          {/* Left: Upload & Controls */}
          <div className="lg:col-span-5 space-y-10">
            <section className="space-y-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <h2 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.1]">
                  최고의 서류는<br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-metallic-gold via-white to-metallic-gold">디테일에서 결정됩니다.</span>
                </h2>
                <p className="text-gray-400 text-lg mt-6 leading-relaxed font-light">
                  HR 전문가의 시각으로 당신의 가능성을 증명하세요.<br />
                  블랙라벨 AI 첨삭이 당신의 서류를 완성합니다.
                </p>
              </motion.div>
            </section>

            <div className="bg-[#141414] p-8 rounded-[32px] shadow-2xl border border-white/5 space-y-8 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-metallic-gold to-transparent opacity-50" />
              
              <div className="space-y-3">
                <label className="text-xs font-bold text-metallic-gold uppercase tracking-widest ml-1">지원자 이름</label>
                <input 
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="지원자 성함을 입력하세요"
                  className="w-full bg-black/50 text-white px-5 py-4 rounded-2xl border border-white/10 focus:border-metallic-gold focus:ring-1 focus:ring-metallic-gold/50 outline-none transition-all placeholder:text-gray-600 font-medium"
                />
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold text-metallic-gold uppercase tracking-widest ml-1">특별 요청사항</label>
                <textarea 
                  value={specialRequest}
                  onChange={(e) => setSpecialRequest(e.target.value)}
                  placeholder="첨삭 시 집중적으로 확인받고 싶은 내용을 입력하세요 (예: 지원동기 강조, 직무 역량 부각 등)"
                  className="w-full bg-black/50 text-white px-5 py-4 rounded-2xl border border-white/10 focus:border-metallic-gold focus:ring-1 focus:ring-metallic-gold/50 outline-none transition-all placeholder:text-gray-600 font-medium min-h-[120px] resize-none"
                />
              </div>

              {/* Reference Documents */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">채용공고 (선택)</label>
                  <label className={`
                    flex flex-col items-center justify-center p-3 border border-dashed rounded-2xl cursor-pointer transition-all h-[80px]
                    ${jobPostingFile ? 'border-metallic-gold/50 bg-metallic-gold/5' : 'border-white/10 hover:border-white/20 bg-white/5'}
                  `}>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".docx,.pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setJobPostingFile(e.target.files?.[0] || null)}
                    />
                    <FileUp className={`w-4 h-4 mb-1 ${jobPostingFile ? 'text-metallic-gold' : 'text-gray-600'}`} />
                    <span className="text-[9px] font-medium text-gray-500 truncate max-w-full px-1">
                      {jobPostingFile ? jobPostingFile.name : '파일 첨부'}
                    </span>
                  </label>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">이력서 (선택)</label>
                  <label className={`
                    flex flex-col items-center justify-center p-3 border border-dashed rounded-2xl cursor-pointer transition-all h-[80px]
                    ${resumeFile ? 'border-metallic-gold/50 bg-metallic-gold/5' : 'border-white/10 hover:border-white/20 bg-white/5'}
                  `}>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".docx,.pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                    />
                    <FileUp className={`w-4 h-4 mb-1 ${resumeFile ? 'text-metallic-gold' : 'text-gray-600'}`} />
                    <span className="text-[9px] font-medium text-gray-500 truncate max-w-full px-1">
                      {resumeFile ? resumeFile.name : '파일 첨부'}
                    </span>
                  </label>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">경력기술서 (선택)</label>
                  <label className={`
                    flex flex-col items-center justify-center p-3 border border-dashed rounded-2xl cursor-pointer transition-all h-[80px]
                    ${careerFile ? 'border-metallic-gold/50 bg-metallic-gold/5' : 'border-white/10 hover:border-white/20 bg-white/5'}
                  `}>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".docx,.pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setCareerFile(e.target.files?.[0] || null)}
                    />
                    <FileUp className={`w-4 h-4 mb-1 ${careerFile ? 'text-metallic-gold' : 'text-gray-600'}`} />
                    <span className="text-[9px] font-medium text-gray-500 truncate max-w-full px-1">
                      {careerFile ? careerFile.name : '파일 첨부'}
                    </span>
                  </label>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">포트폴리오 (선택)</label>
                  <label className={`
                    flex flex-col items-center justify-center p-3 border border-dashed rounded-2xl cursor-pointer transition-all h-[80px]
                    ${portfolioFile ? 'border-metallic-gold/50 bg-metallic-gold/5' : 'border-white/10 hover:border-white/20 bg-white/5'}
                  `}>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".docx,.pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setPortfolioFile(e.target.files?.[0] || null)}
                    />
                    <FileUp className={`w-4 h-4 mb-1 ${portfolioFile ? 'text-metallic-gold' : 'text-gray-600'}`} />
                    <span className="text-[9px] font-medium text-gray-500 truncate max-w-full px-1">
                      {portfolioFile ? portfolioFile.name : '파일 첨부'}
                    </span>
                  </label>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">직무자료 (선택)</label>
                  <label className={`
                    flex flex-col items-center justify-center p-3 border border-dashed rounded-2xl cursor-pointer transition-all h-[80px]
                    ${jobMaterialFile ? 'border-metallic-gold/50 bg-metallic-gold/5' : 'border-white/10 hover:border-white/20 bg-white/5'}
                  `}>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".docx,.pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setJobMaterialFile(e.target.files?.[0] || null)}
                    />
                    <FileUp className={`w-4 h-4 mb-1 ${jobMaterialFile ? 'text-metallic-gold' : 'text-gray-600'}`} />
                    <span className="text-[9px] font-medium text-gray-500 truncate max-w-full px-1">
                      {jobMaterialFile ? jobMaterialFile.name : '파일 첨부'}
                    </span>
                  </label>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">경험정리 (선택)</label>
                  <label className={`
                    flex flex-col items-center justify-center p-3 border border-dashed rounded-2xl cursor-pointer transition-all h-[80px]
                    ${experienceFile ? 'border-metallic-gold/50 bg-metallic-gold/5' : 'border-white/10 hover:border-white/20 bg-white/5'}
                  `}>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".docx,.pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setExperienceFile(e.target.files?.[0] || null)}
                    />
                    <FileUp className={`w-4 h-4 mb-1 ${experienceFile ? 'text-metallic-gold' : 'text-gray-600'}`} />
                    <span className="text-[9px] font-medium text-gray-500 truncate max-w-full px-1">
                      {experienceFile ? experienceFile.name : '파일 첨부'}
                    </span>
                  </label>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">참고자료 (선택)</label>
                  <label className={`
                    flex flex-col items-center justify-center p-3 border border-dashed rounded-2xl cursor-pointer transition-all h-[80px]
                    ${referenceFile ? 'border-metallic-gold/50 bg-metallic-gold/5' : 'border-white/10 hover:border-white/20 bg-white/5'}
                  `}>
                    <input 
                      type="file" 
                      className="hidden" 
                      accept=".docx,.pdf,.png,.jpg,.jpeg"
                      onChange={(e) => setReferenceFile(e.target.files?.[0] || null)}
                    />
                    <FileUp className={`w-4 h-4 mb-1 ${referenceFile ? 'text-metallic-gold' : 'text-gray-600'}`} />
                    <span className="text-[9px] font-medium text-gray-500 truncate max-w-full px-1">
                      {referenceFile ? referenceFile.name : '파일 첨부'}
                    </span>
                  </label>
                </div>
              </div>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative border-2 border-dashed rounded-[24px] p-12 transition-all cursor-pointer
                  flex flex-col items-center justify-center gap-5 group/upload
                  ${file ? 'border-metallic-gold/50 bg-metallic-gold/5' : 'border-white/10 hover:border-metallic-gold/30 hover:bg-white/5'}
                `}
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden" 
                  accept=".docx,.pdf,.png,.jpg,.jpeg"
                />
                <div className={`p-5 rounded-full transition-transform duration-500 group-hover/upload:scale-110 ${file ? 'bg-metallic-gold text-black' : 'bg-white/5 text-gray-500'}`}>
                  {file ? <FileText className="w-10 h-10" /> : <Upload className="w-10 h-10" />}
                </div>
                <div className="text-center">
                  <p className={`font-bold text-lg ${file ? 'text-white' : 'text-gray-400'}`}>
                    {file ? file.name : '서류 파일을 업로드하세요'}
                  </p>
                  <p className="text-xs text-gray-600 mt-2 tracking-wide">.DOCX / .PDF / .PNG / .JPG 파일만 지원</p>
                </div>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-3 text-red-400 bg-red-400/10 p-4 rounded-2xl text-sm font-medium border border-red-400/20"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </motion.div>
              )}

              {(isExtracting || isAnalyzing) ? (
                <div className="w-full space-y-3 bg-white/5 p-5 rounded-[20px] border border-white/10">
                  <div className="flex justify-between items-center text-sm font-bold text-metallic-gold">
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {progressMessage}
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full h-2 bg-black rounded-full overflow-hidden border border-white/5">
                    <motion.div
                      className="h-full bg-gradient-to-r from-metallic-gold to-deep-gold"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  disabled={!file}
                  onClick={processDocument}
                  className={`
                    w-full py-5 rounded-[20px] font-black text-lg transition-all flex items-center justify-center gap-3
                    ${!file 
                      ? 'bg-white/5 text-gray-600 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-metallic-gold to-deep-gold text-black hover:brightness-110 shadow-[0_10px_30px_-10px_rgba(212,175,55,0.4)] active:scale-[0.97]'}
                  `}
                >
                  <FileUp className="w-6 h-6" />
                  프리미엄 첨삭 시작
                </button>
              )}
            </div>

            {/* Features */}
            <div className="grid grid-cols-1 gap-5">
              {[
                { icon: CheckCircle2, title: "골드 하이라이트", desc: "핵심 개선 포인트를 시각적으로 완벽하게 분리합니다.", color: "text-metallic-gold" },
                { icon: MessageSquareQuote, title: "인사담당자 인사이트", desc: "실제 채용 담당자의 시각에서 논리적 근거를 제시합니다.", color: "text-white" }
              ].map((f, i) => (
                <div key={i} className="flex gap-5 p-6 bg-white/5 rounded-[24px] border border-white/5 hover:bg-white/[0.08] transition-colors">
                  <div className={`p-3 rounded-xl bg-black border border-white/10 ${f.color}`}>
                    <f.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm tracking-widest uppercase">{f.title}</h4>
                    <p className="text-xs text-gray-500 mt-2 leading-relaxed font-light">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Results */}
          <div className="lg:col-span-7">
            <AnimatePresence mode="wait">
              {corrections.length > 0 ? (
                <motion.div 
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -30 }}
                  className="space-y-8"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-[#141414] p-6 rounded-[24px] border border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-metallic-gold flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-black" />
                      </div>
                      <div>
                        <h3 className="text-xl font-black tracking-tight">분석 리포트</h3>
                        <p className="text-xs text-gray-500 uppercase tracking-widest">총 {corrections.length}개의 정밀 진단 및 첨삭 포인트</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleReset}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-white/5 text-white rounded-xl font-black text-sm hover:bg-white/10 border border-white/10 transition-all active:scale-95"
                      >
                        <RotateCcw className="w-4 h-4" />
                        처음부터 다시
                      </button>
                      <button
                        onClick={copyToDocs}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-white/5 text-white rounded-xl font-black text-sm hover:bg-white/10 border border-white/10 transition-all active:scale-95"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                        {copied ? '복사 완료' : 'Docs로 복사'}
                      </button>
                      <button
                        onClick={printReport}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-white text-black rounded-xl font-black text-sm hover:bg-metallic-gold transition-all active:scale-95"
                      >
                        <Download className="w-4 h-4" />
                        PDF로 저장
                      </button>
                    </div>
                  </div>

                  {/* Document Introduction Header */}
                  <div className="bg-[#141414] p-8 rounded-[32px] border border-white/5 text-center shadow-xl">
                    <p className="text-xl font-bold leading-relaxed text-transparent bg-clip-text bg-gradient-to-r from-metallic-gold via-white to-metallic-gold">
                      본 서류는 코칭패스의 서류평가위원이자 <br />
                      HR팀 출신 전문가들이 첨삭을 진행하였습니다.
                    </p>
                  </div>

                  <div className="space-y-8">
                    {corrections.map((item, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="bg-[#141414] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl group"
                      >
                        <div className="p-8 space-y-6">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${item.isSpecialRequestRelated ? 'bg-green-500' : 'bg-red-500'}`} />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">기존 자기소개서 내용</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {item.severity && (
                                  <span className={`text-[10px] font-black tracking-[0.1em] px-2 py-0.5 rounded border ${
                                    item.severity === '치명적'
                                      ? 'text-rose-400 bg-rose-500/10 border-rose-500/25'
                                      : item.severity === '보완'
                                      ? 'text-amber-300 bg-amber-500/10 border-amber-500/25'
                                      : 'text-orange-300 bg-orange-500/10 border-orange-500/25'
                                  }`}>
                                    중요도 · {item.severity}
                                  </span>
                                )}
                                {item.isSpecialRequestRelated && (
                                  <span className="text-[10px] font-black uppercase tracking-[0.1em] text-green-500 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                                    요청사항 반영됨
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="relative">
                              <div className={`absolute -left-4 top-0 bottom-0 w-1 rounded-full ${item.isSpecialRequestRelated ? 'bg-green-500/40' : 'bg-red-500/20'}`} />
                              <p className={`text-gray-400 p-5 rounded-2xl border leading-relaxed italic font-light text-lg ${item.isSpecialRequestRelated ? 'bg-green-500/5 border-green-500/20' : 'bg-white/[0.02] border-white/5'}`}>
                                "{item.original}"
                              </p>
                            </div>
                          </div>

                          <div className="flex justify-center py-2">
                            <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-metallic-gold/50 transition-colors">
                              <ArrowRight className="w-5 h-5 text-metallic-gold" />
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full bg-metallic-gold" />
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-metallic-gold">서류평가위원 명품 첨삭안</span>
                            </div>
                            <p className="text-white font-bold p-6 bg-metallic-gold/5 rounded-2xl border border-metallic-gold/20 leading-[2] text-lg shadow-inner">
                              {item.corrected}
                            </p>
                          </div>
                        </div>
                        <div className="bg-black/40 p-8 border-t border-white/5">
                          <div className="flex gap-5">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${item.isSpecialRequestRelated ? 'bg-blue-500/10 border-blue-500/20' : 'bg-white/5 border-white/10'}`}>
                              <MessageSquareQuote className={`w-6 h-6 ${item.isSpecialRequestRelated ? 'text-blue-400' : 'text-gray-400'}`} />
                            </div>
                            <div className="space-y-2">
                              <p className={`text-[10px] font-black uppercase tracking-[0.3em] ${item.isSpecialRequestRelated ? 'text-blue-400' : 'text-metallic-gold'}`}>평가위원 심층 분석</p>
                              <div className={`space-y-3 text-sm leading-[2] font-light ${item.isSpecialRequestRelated ? 'text-blue-300' : 'text-gray-400'}`}>
                                {splitParagraphs(item.reason).map((para, pIdx) => (
                                  <p key={pIdx}>{renderInline(para)}</p>
                                ))}
                              </div>
                              {item.sourceBasis && (
                                <p className="text-[10px] text-gray-600 font-medium tracking-wide pt-1">
                                  근거 자료 · {item.sourceBasis}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}

                    {finalAdvice && (() => {
                      interface AdviceSection {
                        title: string;
                        paragraphs: string[];
                      }

                      const parseAdvice = (text: string): AdviceSection[] => {
                        // 홑따옴표만 정리하고, **굵게** 마크다운은 살려서 소제목 강조에 사용한다.
                        const cleaned = text.replace(/'/g, '');
                        const lines = cleaned.split('\n');
                        const sections: AdviceSection[] = [];
                        let currentSection: AdviceSection | null = null;

                        for (const line of lines) {
                          const trimmed = line.trim();
                          if (!trimmed) continue;

                          // Matches bracketed title, with optional leading numbering like "1. [총평]"
                          const titleMatch = trimmed.match(/^(\d+\.\s*)?\[(.*?)\]$/);
                          if (titleMatch) {
                            const sectionTitle = titleMatch[2].trim();
                            currentSection = {
                              title: sectionTitle,
                              paragraphs: []
                            };
                            sections.push(currentSection);
                          } else {
                            if (currentSection) {
                              currentSection.paragraphs.push(trimmed);
                            } else {
                              currentSection = {
                                title: "종합 총평",
                                paragraphs: [trimmed]
                              };
                              sections.push(currentSection);
                            }
                          }
                        }
                        return sections;
                      };

                      const getSectionStyle = (title: string) => {
                        const lowerTitle = title.toLowerCase();
                        if (lowerTitle.includes('총평') || lowerTitle.includes('평가')) {
                          return {
                            bg: 'bg-slate-900/60 border border-slate-700/40 shadow-xl',
                            textColor: 'text-slate-100',
                            badge: 'bg-slate-500/10 text-slate-300 border border-slate-500/25',
                            accent: 'border-l-4 border-l-slate-400',
                            description: '평가위원 종합 총평'
                          };
                        }
                        if (lowerTitle.includes('핵심 역량') || lowerTitle.includes('역량 요약') || lowerTitle.includes('역량')) {
                          return {
                            bg: 'bg-emerald-950/35 border border-emerald-800/40 shadow-xl',
                            textColor: 'text-emerald-100/90',
                            badge: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25',
                            accent: 'border-l-4 border-l-emerald-400',
                            description: '핵심 역량 요약 및 분석'
                          };
                        }
                        if (lowerTitle.includes('감점') || lowerTitle.includes('위험') || lowerTitle.includes('요인') || lowerTitle.includes('취약')) {
                          return {
                            bg: 'bg-rose-950/35 border border-rose-800/40 shadow-xl',
                            textColor: 'text-rose-100/90',
                            badge: 'bg-rose-500/10 text-rose-300 border border-rose-500/25',
                            accent: 'border-l-4 border-l-rose-400',
                            description: '치명적 감점 요인 진단'
                          };
                        }
                        if (lowerTitle.includes('제언') || lowerTitle.includes('전략적')) {
                          return {
                            bg: 'bg-blue-950/35 border border-blue-800/40 shadow-xl',
                            textColor: 'text-blue-100/90',
                            badge: 'bg-blue-500/10 text-blue-300 border border-blue-500/25',
                            accent: 'border-l-4 border-l-blue-400',
                            description: '합격 확률을 높이는 전략적 제언'
                          };
                        }
                        // Default (e.g., 향후 보완 전략)
                        return {
                          bg: 'bg-amber-950/35 border border-amber-800/40 shadow-xl',
                          textColor: 'text-amber-100/90',
                          badge: 'bg-amber-500/10 text-amber-300 border border-amber-500/25',
                          accent: 'border-l-4 border-l-amber-400',
                          description: '향후 보완 전략 및 예상 질문'
                        };
                      };

                      return (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.98 }}
                          whileInView={{ opacity: 1, scale: 1 }}
                          viewport={{ once: true }}
                          className="bg-[#141414] border border-white/5 rounded-[40px] p-8 md:p-12 shadow-2xl space-y-10 relative overflow-hidden"
                        >
                          <div className="absolute top-0 right-0 w-64 h-64 bg-metallic-gold/5 rounded-full -mr-32 -mt-32 blur-3xl pointer-events-none" />
                          
                          <div className="relative z-10 flex items-center gap-4 border-b border-white/5 pb-6">
                            <div className="bg-gradient-to-br from-metallic-gold to-deep-gold p-3 rounded-2xl shadow-lg shadow-metallic-gold/10">
                              <ShieldCheck className="w-8 h-8 text-black" />
                            </div>
                            <div>
                              <h4 className="text-2xl font-black tracking-tight text-white mb-1">평가위원의 최종 조언</h4>
                              <p className="text-xs text-metallic-gold font-bold tracking-widest uppercase">서류 평가위원 총평 및 심층 피드백</p>
                            </div>
                          </div>

                          <div className="relative z-10 space-y-6">
                            {parseAdvice(finalAdvice).map((section, idx) => {
                              const style = getSectionStyle(section.title);
                              return (
                                <div
                                  key={idx}
                                  className={`rounded-3xl p-6 md:p-8 transition-all hover:translate-x-1 duration-300 ${style.bg} ${style.accent}`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                                    <span className={`inline-block px-4 py-1.5 rounded-xl font-bold text-sm tracking-tight ${style.badge}`}>
                                      {section.title}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">
                                      {style.description}
                                    </span>
                                  </div>
                                  
                                  <div className={`space-y-4 text-base leading-[1.8] font-normal break-keep text-justify ${style.textColor}`}>
                                    {section.paragraphs.map((para, pIdx) => (
                                      <p key={pIdx}>
                                        {renderInline(para)}
                                      </p>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      );
                    })()}
                  </div>
                </motion.div>
              ) : (
                <div className="h-full min-h-[600px] flex flex-col items-center justify-center text-center p-16 bg-[#141414] rounded-[48px] border border-white/5 border-dashed group">
                  <motion.div 
                    animate={{ y: [0, -10, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="bg-white/5 p-8 rounded-full mb-8 border border-white/10 group-hover:border-metallic-gold/30 transition-colors"
                  >
                    <FileText className="w-16 h-16 text-gray-700 group-hover:text-metallic-gold transition-colors" />
                  </motion.div>
                  <h3 className="text-2xl font-black text-white mb-4 tracking-tight">분석 준비 완료</h3>
                  <p className="text-gray-500 max-w-sm mx-auto leading-relaxed font-light">
                    서류를 업로드하시면 HR 전문가의 시각으로<br />
                    당신의 가치를 극대화할 수 있는 리포트를 생성합니다.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-20 border-t border-white/5">
        <div className="flex flex-col md:flex-row justify-between items-center gap-10">
          <div className="flex items-center gap-3 opacity-30 grayscale hover:grayscale-0 hover:opacity-100 transition-all cursor-default">
            <ShieldCheck className="w-6 h-6 text-metallic-gold" />
            <span className="text-sm font-black tracking-[0.3em] uppercase">코칭패스 프리미엄</span>
          </div>
          <div className="flex flex-col items-center md:items-end gap-2">
            <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">프리미엄 AI 첨삭 엔진 탑재</p>
            <p className="text-[10px] text-gray-700 tracking-tighter">© 2024 COACHING PASS. 모든 권리 보유.</p>
          </div>
        </div>
      </footer>

    </div>

    {/* ── PDF 인쇄 전용 리포트(화면에서는 숨김, 인쇄 시에만 출력) ── */}
    {/* Docs 복사와 동일한 HTML을 사용해 PDF·복사 결과가 완전히 일치하도록 한다. */}
    {corrections.length > 0 && (
      <div
        className="print-only"
        dangerouslySetInnerHTML={{
          __html: buildReportHtml({ name, specialRequest, corrections, finalAdvice }),
        }}
      />
    )}
    </>
  );
}
