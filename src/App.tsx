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
  X,
  Key
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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

  const [customApiKey, setCustomApiKey] = useState<string>(() => localStorage.getItem('user_gemini_api_key') || '');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [modalApiKeyInput, setModalApiKeyInput] = useState(() => localStorage.getItem('user_gemini_api_key') || '');

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

      // 2. Analyze with Gemini on the server side to protect API keys and prevent runtime failures
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': customApiKey || '',
        },
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

      if (!response.ok) {
        let errMsg = '';
        try {
          const errData = await response.json();
          errMsg = errData.error || '알 수 없는 오류';
        } catch {
          errMsg = `HTTP error ${response.status}`;
        }
        throw new Error(`AI 분석 중 오류가 발생했습니다: ${errMsg}`);
      }

      const responseData = await response.json();
      const resultText = responseData.resultText;
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
            <div className="relative w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-metallic-gold/15 border border-metallic-gold/30">
              <img 
                id="header-logo-image"
                src="/logo.png" 
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
            <button 
              id="api-key-auth-btn"
              onClick={() => {
                const storedKey = localStorage.getItem('user_gemini_api_key') || '';
                setModalApiKeyInput(storedKey);
                setIsApiKeyModalOpen(true);
              }}
              className="flex items-center gap-1.5 text-[11px] font-bold tracking-tight text-white hover:text-metallic-gold bg-white/5 border border-white/10 hover:border-metallic-gold/50 px-3.5 py-1.5 rounded-full transition-all duration-300 shadow-md hover:shadow-metallic-gold/10 cursor-pointer"
            >
              <ShieldCheck className={`w-3.5 h-3.5 ${customApiKey ? 'text-green-400' : 'text-gray-400'}`} />
              <span>{customApiKey ? 'API Key 인증됨' : 'API Key 인증'}</span>
            </button>
            <div className="hidden sm:block text-[10px] font-bold tracking-widest text-metallic-gold border border-metallic-gold/30 px-3 py-1.5 rounded-full uppercase">
              전문 평가위원 AI
            </div>
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
                        onClick={() => downloadCorrectedDoc()}
                        disabled={isGenerating}
                        className="flex items-center justify-center gap-2 px-6 py-3 bg-white text-black rounded-xl font-black text-sm hover:bg-metallic-gold transition-all disabled:opacity-50 active:scale-95"
                      >
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        분석 리포트 다운로드
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
                              <p className={`text-sm leading-[2] font-light ${item.isSpecialRequestRelated ? 'text-blue-300' : 'text-gray-400'}`}>
                                {item.reason}
                              </p>
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
                        // Strip raw markdown asterisks and single quotes to guarantee clean rendering
                        const cleaned = text.replace(/\*\*/g, '').replace(/'/g, '');
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
                                        {para}
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
            <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">Gemini 3.1 Pro 인텔리전스 탑재</p>
            <p className="text-[10px] text-gray-700 tracking-tighter">© 2024 COACHING PASS. 모든 권리 보유.</p>
          </div>
        </div>
      </footer>

      {/* API Key Modal */}
      <AnimatePresence>
        {isApiKeyModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsApiKeyModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            
            {/* Modal Box */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-md bg-[#141414] rounded-3xl border border-white/10 shadow-2xl overflow-hidden p-8 space-y-6"
            >
              {/* Close Button */}
              <button 
                onClick={() => setIsApiKeyModalOpen(false)}
                className="absolute top-5 right-5 text-gray-500 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-metallic-gold/10 border border-metallic-gold/20 text-metallic-gold">
                    <Key className="w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-bold text-white tracking-tight">Gemini API Key 설정</h3>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed pt-1">
                  이 서비스는 Cloudflare 분산 클라우드 환경에 최적화되어 있습니다. 직접 발급받으신 개인 API Key를 입력하여 사용 제한과 한도 걱정 없이 무제한으로 고퀄리티 독설 첨삭을 받아보세요.
                </p>
              </div>
              
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-metallic-gold uppercase tracking-widest block ml-1">API KEY 입력</label>
                <input 
                  type="password"
                  value={modalApiKeyInput}
                  onChange={(e) => setModalApiKeyInput(e.target.value)}
                  placeholder="AI Studio에서 발급받은 API Key (AIzaSy...)"
                  className="w-full bg-black/50 text-white px-5 py-4 rounded-2xl border border-white/10 focus:border-metallic-gold focus:ring-1 focus:ring-metallic-gold/50 outline-none transition-all placeholder:text-gray-600 font-mono text-sm"
                />
              </div>

              <div className="bg-metallic-gold/5 border border-metallic-gold/10 rounded-2xl p-4 text-[11px] text-gray-400 leading-relaxed space-y-1">
                <p className="text-metallic-gold font-bold">🔒 보안 및 개인정보 보안 안내</p>
                <p>입력하신 API Key는 브라우저 내부의 안전한 로컬 저장소(localStorage)에만 저장되며, 어떠한 외부 서버로도 전송되거나 기록되지 않고 오직 Gemini API 요청 중계용 프록시로만 전달됩니다.</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('user_gemini_api_key');
                    setCustomApiKey('');
                    setModalApiKeyInput('');
                    setIsApiKeyModalOpen(false);
                  }}
                  className="flex-1 bg-white/5 hover:bg-red-500/10 text-gray-400 hover:text-red-400 px-5 py-3.5 rounded-2xl text-xs font-bold transition-all border border-white/10 hover:border-red-500/20 cursor-pointer"
                >
                  초기화
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const trimmedKey = modalApiKeyInput.trim();
                    if (trimmedKey) {
                      localStorage.setItem('user_gemini_api_key', trimmedKey);
                      setCustomApiKey(trimmedKey);
                    } else {
                      localStorage.removeItem('user_gemini_api_key');
                      setCustomApiKey('');
                    }
                    setIsApiKeyModalOpen(false);
                  }}
                  className="flex-1 bg-metallic-gold text-black hover:bg-white hover:text-black px-5 py-3.5 rounded-2xl text-xs font-bold transition-all border border-transparent shadow-lg shadow-metallic-gold/25 cursor-pointer"
                >
                  인증 및 저장
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
