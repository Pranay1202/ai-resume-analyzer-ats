import { useMemo, useRef, useState, type DragEvent, type ChangeEvent } from "react";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

export default function Home() {
  return <Index />;
}

interface MatchedKeyword { keyword: string; importance: "high" | "medium" | "low" }
interface MissingKeyword { keyword: string; importance: "high" | "medium" | "low"; why: string }
interface WeakBullet { original: string; rewritten: string }
interface AnalysisResult {
  overall_score: number;
  section_scores: { skills: number; experience: number; education: number; summary: number };
  matched_keywords: MatchedKeyword[];
  missing_keywords: MissingKeyword[];
  weak_bullets: WeakBullet[];
  top_3_actions: string[];
}

function ScoreGauge({ score }: { score: number }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
  const color = score >= 70 ? "#10B981" : score >= 50 ? "#F59E0B" : "#EF4444";
  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="14" />
        <circle
          cx="90" cy="90" r={radius} fill="none" stroke={color} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          transform="rotate(-90 90 90)"
          style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
        />
        <text x="90" y="92" textAnchor="middle" dominantBaseline="middle"
          fontSize="42" fontWeight="700" fill="#111827">{score}</text>
        <text x="90" y="120" textAnchor="middle" fontSize="12" fill="#6B7280">out of 100</text>
      </svg>
      <div className="mt-2 text-sm font-medium" style={{ color }}>
        {score >= 70 ? "Strong match" : score >= 50 ? "Moderate match" : "Needs work"}
      </div>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? "#10B981" : value >= 50 ? "#F59E0B" : "#EF4444";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-bold" style={{ color }}>{value}</span>
        <span className="text-sm text-gray-400">/100</span>
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
        <div className="h-1.5 rounded-full" style={{ width: `${value}%`, background: color, transition: "width 1s ease-out" }} />
      </div>
    </div>
  );
}

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [resumeBase64, setResumeBase64] = useState<string>("");
  const [jdText, setJdText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const analyzerRef = useRef<HTMLDivElement>(null);

  // kept for UI compatibility (word count / extracting badges)
  const extracting = false;
  const resumeText = resumeBase64;
  const wordCount = 0;

  const canAnalyze = !!resumeBase64 && jdText.trim().length > 0 && !loading;

  const readFileAsBase64 = (f: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(f);
    });

  const handleFile = async (f: File | undefined | null) => {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setError("Please upload a PDF file.");
      return;
    }
    setError("");
    setFile(f);
    setResumeBase64("");
    try {
      const dataUrl = await readFileAsBase64(f);
      setResumeBase64(dataUrl);
    } catch {
      setError("Could not read file.");
      setFile(null);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void handleFile(e.dataTransfer.files?.[0]);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFile(e.target.files && e.target.files[0]);
  };

  const scrollToAnalyzer = () => analyzerRef.current?.scrollIntoView({ behavior: "smooth" });

  const analyze = async () => {
    setError("");
    if (!file || !resumeBase64) { setError("Please upload your resume PDF"); return; }
    if (!jdText.trim()) { setError("Please paste a job description"); return; }
    if (!GEMINI_API_KEY) { setError("Missing VITE_GEMINI_API_KEY"); return; }
    setLoading(true);
    setResult(null);
    try {
      const base64Data = resumeBase64.includes(",") ? resumeBase64.split(",")[1] : resumeBase64;
      const prompt = `You are an expert ATS resume reviewer. Analyze the attached resume PDF against the job description below and return ONLY valid minified JSON (no markdown, no code fences) with this exact shape:
{"overall_score":number 0-100,"section_scores":{"skills":number,"experience":number,"education":number,"summary":number},"matched_keywords":[{"keyword":string,"importance":"high"|"medium"|"low"}],"missing_keywords":[{"keyword":string,"importance":"high"|"medium"|"low","why":string}],"weak_bullets":[{"original":string,"rewritten":string}],"top_3_actions":[string,string,string]}

JOB DESCRIPTION:
${jdText}`;

      const body = {
        contents: [{
          parts: [
            { inline_data: { mime_type: "application/pdf", data: base64Data } },
            { text: prompt },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      };

      console.log("[gemini] calling API");
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      console.log("[gemini] response:", json);
      if (!res.ok) {
        setError(json?.error?.message || `Gemini API error ${res.status}`);
        return;
      }
      const text: string | undefined = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join("") ;
      if (!text) { setError("Empty response from Gemini"); return; }
      let parsed: AnalysisResult;
      try {
        parsed = JSON.parse(text);
      } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) { setError("Could not parse AI response."); return; }
        parsed = JSON.parse(m[0]);
      }
      if (typeof parsed.overall_score !== "number") {
        setError("Invalid AI response shape.");
        return;
      }
      setResult(parsed);
    } catch (err) {
      console.error("[gemini] failed:", err);
      setError((err as Error).message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };



  const copyBullet = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch { /* ignore */ }
  };

  const pillImportance = useMemo(() => ({
    high: "ring-1 ring-red-300",
    medium: "ring-1 ring-amber-300",
    low: "ring-1 ring-gray-200",
  } as const), []);

  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>
      {/* Hero */}
      <section className="relative overflow-hidden px-6 py-20 sm:py-28">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(15,12,41,0.85), rgba(48,43,99,0.90)), url('https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=1920&q=80')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            zIndex: 0,
          }}
        />
        {/* Floating emojis */}
        <span className="absolute top-12 left-[10%] text-[80px] opacity-15 select-none pointer-events-none" style={{ zIndex: 1 }}>📄</span>
        <span className="absolute top-24 right-[12%] text-[80px] opacity-15 select-none pointer-events-none" style={{ zIndex: 1 }}>📊</span>
        <span className="absolute bottom-16 left-[15%] text-[80px] opacity-15 select-none pointer-events-none" style={{ zIndex: 1 }}>✅</span>
        <span className="absolute bottom-20 right-[8%] text-[80px] opacity-15 select-none pointer-events-none" style={{ zIndex: 1 }}>🎯</span>

        <div className="relative mx-auto max-w-4xl text-center" style={{ zIndex: 2 }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-gray-200">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#818CF8" }} />
            AI-powered resume analysis
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-6xl">
            Know your ATS score in seconds
          </h1>
          <p className="mt-5 text-lg text-gray-200 sm:text-xl">
            Upload your resume, paste a job description, get an AI-powered match score with fixes
          </p>
          <button
            onClick={scrollToAnalyzer}
            className="mt-10 inline-flex items-center justify-center rounded-xl px-7 py-3.5 text-base font-semibold text-white shadow-lg transition hover:opacity-90 active:scale-[0.98]"
            style={{ background: "#4F46E5", boxShadow: "0 10px 30px -10px rgba(79,70,229,0.5)" }}
          >
            Analyze my resume
          </button>
        </div>
      </section>

      {/* Analyzer */}
      <section
        ref={analyzerRef}
        className="relative border-t border-white/10 px-6 py-16"
        style={{
          backgroundImage: `linear-gradient(rgba(15,12,41,0.88), rgba(30,27,60,0.92)), url('https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=1920&q=80')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          zIndex: 0,
        }}
      >
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-8 md:grid-cols-2" style={{ zIndex: 1 }}>
          {/* Left: inputs */}
          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-100">Upload your resume (PDF)</label>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                role="button"
                tabIndex={0}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-white px-6 py-10 text-center transition ${
                  dragOver ? "border-indigo-500 bg-indigo-50/40" : "border-gray-300 hover:border-indigo-400"
                }`}
              >
                <svg className="h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.9 5 5 0 019.74-1.1A4.5 4.5 0 1116 16M12 12v9m0-9l-3 3m3-3l3 3" />
                </svg>
                <p className="mt-3 text-sm text-gray-600">Drag and drop your PDF here, or</p>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                  className="mt-3 inline-flex items-center justify-center rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                  style={{ background: "#4F46E5" }}
                >
                  Click to upload
                </button>
                <p className="mt-2 text-xs text-gray-400">PDF up to ~10MB</p>
              </div>
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileChange} />
              {file && (
                <div className="mt-3 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                  <span className="truncate text-gray-700">📄 {file.name}</span>
                  {extracting ? (
                    <span className="text-gray-500">Extracting text...</span>
                  ) : wordCount > 0 ? (
                    <span className="font-medium text-green-600">Resume text extracted — {wordCount} words found</span>
                  ) : null}
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-100">Paste the job description</label>
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="Copy and paste the full job description here..."
                className="w-full rounded-xl border border-gray-300 bg-white p-4 text-sm text-gray-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                style={{ minHeight: "200px" }}
              />
            </div>

            <button
              onClick={analyze}
              disabled={!canAnalyze}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-base font-semibold text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
              style={{ background: "#4F46E5" }}
            >
              {loading ? (
                <>
                  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                  Analyzing...
                </>
              ) : "Analyze Resume"}
            </button>

            {loading && (
              <p className="text-center text-sm text-gray-300">Analyzing your resume...</p>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}
          </div>

          {/* Right: results */}
          <div
            className="relative rounded-2xl p-6"
            style={{
              backgroundImage: `linear-gradient(rgba(20,18,45,0.85), rgba(35,32,65,0.90)), url('https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1920&q=80')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              zIndex: 0,
            }}
          >
            <div className="relative" style={{ zIndex: 1 }}>
              {result ? (
                <div className="space-y-6 animate-in fade-in duration-700" style={{ animation: "fadeIn 0.6s ease-out" }}>
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Overall ATS Score</h3>
                    <ScoreGauge score={result.overall_score} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <MetricBox label="Skills" value={result.section_scores.skills} />
                    <MetricBox label="Experience" value={result.section_scores.experience} />
                    <MetricBox label="Education" value={result.section_scores.education} />
                    <MetricBox label="Summary" value={result.section_scores.summary} />
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-6">
                    <h3 className="mb-3 font-semibold text-gray-900">Matched keywords</h3>
                    {result.matched_keywords.length === 0 ? (
                      <p className="text-sm text-gray-500">No matched keywords found.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {result.matched_keywords.map((k, i) => (
                          <span key={i}
                            className={`rounded-full px-3 py-1 text-xs font-medium ${pillImportance[k.importance]}`}
                            style={{ background: "#D1FAE5", color: "#065F46" }}>
                            {k.keyword}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-6">
                    <h3 className="mb-3 font-semibold text-gray-900">Missing keywords</h3>
                    {result.missing_keywords.length === 0 ? (
                      <p className="text-sm text-gray-500">Nothing critical is missing.</p>
                    ) : (
                      <ul className="space-y-3">
                        {result.missing_keywords.map((k, i) => (
                          <li key={i}>
                            <span
                              className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${pillImportance[k.importance]}`}
                              style={{ background: "#FEE2E2", color: "#991B1B" }}>
                              {k.keyword}
                            </span>
                            <p className="mt-1 text-xs text-gray-500">{k.why}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-6">
                    <h3 className="mb-3 font-semibold text-gray-900">Suggested bullet rewrites</h3>
                    {result.weak_bullets.length === 0 ? (
                      <p className="text-sm text-gray-500">Your bullets look strong.</p>
                    ) : (
                      <ul className="space-y-4">
                        {result.weak_bullets.map((b, i) => (
                          <li key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                            <p className="text-sm text-gray-500 line-through">{b.original}</p>
                            <p className="mt-2 text-sm font-medium" style={{ color: "#065F46" }}>{b.rewritten}</p>
                            <button
                              onClick={() => copyBullet(b.rewritten, i)}
                              className="mt-2 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              {copiedIdx === i ? "Copied!" : "Copy"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-6">
                    <h3 className="mb-3 font-semibold text-gray-900">Top 3 actions</h3>
                    <ol className="space-y-2">
                      {result.top_3_actions.map((a, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: "#4F46E5" }}>
                            {i + 1}
                          </span>
                          <span className="font-semibold text-gray-900">{a}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-[400px] items-center justify-center rounded-2xl border-2 border-dashed border-white/20 bg-white/10 p-8 text-center backdrop-blur-sm">
                  <div>
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
                      <svg className="h-6 w-6" fill="none" stroke="#4F46E5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-white">Your results will appear here</p>
                    <p className="mt-1 text-xs text-gray-300">Upload a resume and paste a job description to begin.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Gemini AI Badge */}
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-sm">
        <span className="text-[#4285F4]">G</span>
        <span className="text-[#EA4335]">o</span>
        <span className="text-[#FBBC05]">o</span>
        <span className="text-[#4285F4]">g</span>
        <span className="text-[#34A853]">l</span>
        <span className="text-[#EA4335]">e</span>
        <span className="ml-1 text-gray-600">Gemini AI</span>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
