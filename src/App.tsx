/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
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
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface Correction {
  original: string;
  corrected: string;
  reason: string;
  isSpecialRequestRelated?: boolean;
}

interface AnalysisResult {
  corrections: Correction[];
  finalAdvice: string;
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
  const [error, setError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
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

    let progressInterval: NodeJS.Timeout | null = null;

    try {
      setIsExtracting(true);
      setError(null);
      setCorrections([]);
      setProgress(0);
      setProgressMessage('파일 추출 준비 중...');

      // Initialize Gemini inside the function to ensure fresh API key
      const genAIInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

      // Helper to extract text from a file
      const extractText = async (targetFile: File) => {
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

      // 2. Analyze with Gemini
      // Switch to a faster, supported model to avoid 404 errors and 504 timeouts
      const modelId = "gemini-3-flash-preview";
      
      const parts: any[] = [];
      let promptText = `
       당신은 코칭패스의 '수석 서류평가위원'이자 대기업/공기업 채용 설계를 담당했던 HR 전문가입니다.
       제공된 서류 내용을 매우 날카롭고 세밀하게 분석하여, '합격할 수밖에 없는 서류'로 완벽하게 재탄생시키기 위한 독설적이면서도 건설적인 초정밀 첨삭 리포트를 작성하세요.
       전체적인 리포트의 분량은 평소보다 2배 이상, 최대한 방대하고 수준 높게 구성해야 합니다.
       
       전문 가이드라인:
       1. 양적/질적 팽창: 분석 리포트의 전체 분량은 최소 3,000자 이상을 목표로 매우 방대하게 작성해야 합니다. 
       2. 무자비한 분석: 문장 하나하나를 쪼개어 분석하세요. 단순히 문법 교정이 아니라, 단어 선택이 주는 인상, 문장의 호흡, 논리적 허점 등 전문가만이 포착할 수 있는 지점을 최소 15개 이상의 수정 사항(corrections)으로 찾아내세요.
       3. 역량의 구체적 증명: "열심히 했다"는 식의 추상적 표현은 모두 배제하고, 참고 서류(이력서 등)에 있는 수치, 성과, 구체적 액션을 활용하여 신뢰도를 300% 높이세요.
       4. 비즈니스 임팩트: 지원자의 경험이 회사에 어떤 이익을 줄 수 있는지(ROI 관점)가 명확히 드러나도록 문장을 완전히 재구성하세요.
       5. 시각적 가독성 극대화: 
          - 각 문단은 최대 2줄을 넘지 않도록 매우 세밀하게 나눕니다.
          - 모든 소제목마다 문단을 구분하고 공백 라인을 두세요.

       ${specialRequest ? `특히 다음 요청사항에 집중하여 평가위원의 시각에서 첨삭을 진행해주세요: "${specialRequest}"\n` : ''}
       
       분석 및 첨삭 가이드라인 (평가위원 관점):
       1. 채용공고 적합성: ${jobPostingData ? '제공된 채용공고의 직무 기술서(JD)와 자격 요건을 바탕으로, 지원자가 해당 직무에 얼마나 최적화된 인재인지 평가하고 부족한 키워드를 삽입하세요.' : '지원 직무의 일반적인 요구 역량과 비교하여 전문성이 드러나는지 확인하세요.'}
       ${jobMaterialData ? '1-1. 직무자료 반영: 제공된 직무자료를 바탕으로 해당 직무에 대한 깊은 이해도를 반영하여, 지원자의 경험이 실무에 어떻게 적용될 수 있는지 구체적으로 첨삭하세요.\n' : ''}
       ${experienceData ? '1-2. 경험정리 반영: 제공된 경험정리 자료를 바탕으로 지원자의 구체적인 경험과 성과를 자소서에 자연스럽게 녹여내고, 추상적인 표현을 구체적인 사례로 대체하세요.\n' : ''}
       ${referenceData ? '1-3. 참고자료 활용: 제공된 참고자료의 내용을 분석하여 첨삭 시 필요한 배경 지식이나 보충 정보로 적극 활용하세요.\n' : ''}
       
       응답 형식 (JSON):
       - corrections: 수정 사항들의 배열 (최소 15개 이상, 가능한 한 많이 찾아내어 매우 상세하게 작성)
         - original: 수정이 필요한 원본 문장/문항
         - corrected: 평가위원이 합격시키고 싶을 정도로 압도적으로 개선된 제안 문장 (전문적이고 파괴력 있는 표현 사용)
         - reason: 평가위원의 관점에서 작성한 '매우 상세하고 날카로운' 분석. 이 문장이 왜 탈락 사유가 되는지, 수정된 문장이 어떤 심리학적/비즈니스적 효과를 주는지 자세히 작성하세요.
         - isSpecialRequestRelated: 해당 수정 사항이 사용자의 요청사항("${specialRequest || '없음'}")과 직접적으로 관련이 있는지 여부
       - finalAdvice: 서류 전체를 검토한 후, 서류평가위원의 입장에서 내리는 냉철한 총평과 전략적 제언. 
         - 분량은 매우 방대하게 작성하세요.
         - [총평], [직무 역량 분석], [치명적 감점 요인], [합격 확률 높이기], [향후 보완 전략] 등 소제목별로 상세히 기술하세요.
         - 절대 '\n\n' 문자열을 그대로 출력하지 말고 실제 줄바꿈을 사용하세요.
      `;

      parts.push({ text: promptText });

      const addDocumentPart = (name: string, data: any) => {
        if (!data) return;
        if (data.text) {
          parts.push({ text: `\n[${name} 내용]\n${data.text.substring(0, 10000)}\n` });
        } else if (data.image) {
          parts.push({ text: `\n[${name} 이미지]\n` });
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

      const response = await genAIInstance.models.generateContent({
        model: modelId,
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
      if (!resultText) throw new Error('AI 분석 결과가 비어있습니다.');
      
      let parsedResult: AnalysisResult;
      try {
        // Clean markdown if present
        const cleanedText = resultText.replace(/```json\n?|```/g, '').trim();
        parsedResult = JSON.parse(cleanedText);
      } catch (parseErr) {
        console.error('JSON parse error. Raw text:', resultText);
        throw new Error('AI 응답 형식이 올바르지 않습니다. 다시 시도해주세요.');
      }

      setCorrections(parsedResult.corrections);
      setFinalAdvice(parsedResult.finalAdvice);
      
      if (progressInterval) clearInterval(progressInterval);
      setProgress(100);
      setProgressMessage('분석 완료!');

      // Auto-download after successful analysis
      setTimeout(() => {
        downloadCorrectedDoc(parsedResult.corrections, parsedResult.finalAdvice, name);
      }, 500);
      
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

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-metallic-gold selection:text-black">
      {/* Header */}
      <header className="bg-black/80 backdrop-blur-md border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-metallic-gold to-deep-gold p-2 rounded-xl shadow-lg shadow-metallic-gold/20">
              <ShieldCheck className="w-6 h-6 text-black" />
            </div>
            <h1 className="text-xl font-black tracking-tighter text-white">
              코칭패스 <span className="text-metallic-gold">서류 첨삭 AI</span>
            </h1>
          </div>
          <div className="text-[10px] font-bold tracking-widest text-metallic-gold border border-metallic-gold/30 px-3 py-1 rounded-full uppercase">
            Professional Reviewer AI
          </div>
        </div>
      </header>

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
                <label className="text-xs font-bold text-metallic-gold uppercase tracking-widest ml-1">Applicant Name</label>
                <input 
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="지원자 성함을 입력하세요"
                  className="w-full bg-black/50 text-white px-5 py-4 rounded-2xl border border-white/10 focus:border-metallic-gold focus:ring-1 focus:ring-metallic-gold/50 outline-none transition-all placeholder:text-gray-600 font-medium"
                />
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold text-metallic-gold uppercase tracking-widest ml-1">Special Request</label>
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
                  <p className="text-xs text-gray-600 mt-2 tracking-wide">ONLY .DOCX / .PDF / .PNG / .JPG</p>
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
                  PREMIUM ANALYSIS
                </button>
              )}
            </div>

            {/* Features */}
            <div className="grid grid-cols-1 gap-5">
              {[
                { icon: CheckCircle2, title: "GOLD HIGHLIGHT", desc: "핵심 개선 포인트를 시각적으로 완벽하게 분리합니다.", color: "text-metallic-gold" },
                { icon: MessageSquareQuote, title: "HR INSIGHT", desc: "실제 채용 담당자의 시각에서 논리적 근거를 제시합니다.", color: "text-white" }
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
                        <p className="text-xs text-gray-500 uppercase tracking-widest">{corrections.length} CRITICAL POINTS FOUND</p>
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
                        onClick={() => downloadCorrectedDoc()}
                        disabled={isGenerating}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-white text-black rounded-xl font-black text-sm hover:bg-metallic-gold transition-all disabled:opacity-50 active:scale-95"
                      >
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        DOWNLOAD REPORT
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
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">Original Content</span>
                              </div>
                              {item.isSpecialRequestRelated && (
                                <span className="text-[10px] font-black uppercase tracking-[0.1em] text-green-500 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/20">
                                  요청사항 반영됨
                                </span>
                              )}
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
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-metallic-gold">Premium Correction</span>
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
                              <p className={`text-[10px] font-black uppercase tracking-[0.3em] ${item.isSpecialRequestRelated ? 'text-blue-400' : 'text-metallic-gold'}`}>Expert Insight</p>
                              <p className={`text-sm leading-[2] font-light ${item.isSpecialRequestRelated ? 'text-blue-300' : 'text-gray-400'}`}>
                                {item.reason}
                              </p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}

                    {finalAdvice && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        className="relative bg-gradient-to-br from-metallic-gold to-deep-gold text-black rounded-[40px] p-10 shadow-[0_20px_50px_-15px_rgba(212,175,55,0.3)] overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
                        <div className="relative z-10">
                          <div className="flex items-center gap-4 mb-8">
                            <div className="bg-black p-3 rounded-2xl shadow-xl">
                              <ShieldCheck className="w-8 h-8 text-metallic-gold" />
                            </div>
                            <h4 className="text-2xl font-black tracking-tight">평가위원의 최종 조언</h4>
                          </div>
                          <div className="text-black/80 text-lg leading-[2] font-medium whitespace-pre-wrap">
                            {finalAdvice.split('\n').map((line, i) => (
                              <p key={i} className="mb-4">
                                {line}
                              </p>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
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
            <span className="text-sm font-black tracking-[0.3em] uppercase">Coaching Pass Premium</span>
          </div>
          <div className="flex flex-col items-center md:items-end gap-2">
            <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Powered by Gemini 3.1 Pro Elite</p>
            <p className="text-[10px] text-gray-700 tracking-tighter">© 2024 COACHING PASS. ALL RIGHTS RESERVED.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
