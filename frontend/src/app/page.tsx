"use client";

import { useState, useRef } from "react";
import { Upload, Image as ImageIcon, Video, Wand2, PlayCircle, Settings2, Sparkles, CheckCircle2 } from "lucide-react";

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<"idle" | "extracting" | "rendering" | "done">("idle");
  const [renderProgress, setRenderProgress] = useState(0);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    if (!videoFile || !imageFile) {
      alert("Please upload both a video and a reference image!");
      return;
    }
    
    setIsGenerating(true);
    setGenerationPhase("extracting");
    setFinalVideoUrl(null);
    setRenderProgress(0);

    try {
      const formData = new FormData();
      formData.append("video", videoFile);
      formData.append("ref_image", imageFile);
      formData.append("prompt", prompt);

      // 1. Start Python Pipeline
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await fetch(`${apiUrl}/api/generate`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error("Pipeline trigger failed");
      const { job_id } = await response.json();

      // 2. Poll Python Backend until complete
      let manifest = null;
      while (!manifest) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const statusRes = await fetch(`${apiUrl}/api/jobs/${job_id}`);
        const statusData = await statusRes.json();
        
        if (statusData.status === "failed") throw new Error("Pipeline extraction failed.");
        if (statusData.status === "completed" && statusData.result_manifest) {
          manifest = statusData.result_manifest;
        }
      }

      setGenerationPhase("rendering");

      // 3. Trigger AWS Lambda Render
      const renderRes = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest })
      });
      
      if (!renderRes.ok) {
          const err = await renderRes.json();
          throw new Error("AWS Lambda execution failed: " + err.error);
      }
      
      const { renderId, bucketName } = await renderRes.json();

      // 4. Poll AWS Lambda Progress
      let done = false;
      while (!done) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const progRes = await fetch(`/api/progress?renderId=${renderId}&bucketName=${bucketName}`);
        const progData = await progRes.json();

        if (progData.fatalErrorEncountered) {
          throw new Error("AWS Rendering fatal error.");
        }
        
        if (progData.overallProgress) {
          setRenderProgress(Math.round(progData.overallProgress * 100));
        }

        if (progData.done) {
          const finalUrl = progData.outputFile || 
            (progData.outKey ? `https://s3.us-east-1.amazonaws.com/${bucketName}/${progData.outKey}` : null) ||
            `https://s3.us-east-1.amazonaws.com/${bucketName}/renders/wabisabi_export_${Date.now()}.mp4`;
          setFinalVideoUrl(finalUrl);
          done = true;
        }
      }

      setGenerationPhase("done");
      console.log("Entire Pipeline finished successfully on AWS!");

    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Error starting pipeline");
      setGenerationPhase("idle");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-white relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-600/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-12 flex flex-col items-center min-h-screen">
        <div className="text-center mb-12 space-y-6 pt-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md text-sm font-medium text-purple-300 shadow-2xl">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse shadow-[0_0_10px_rgba(168,85,247,0.8)]" />
            Wabisabi Auto-Editor
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-white via-zinc-200 to-zinc-500 pb-2">
            Automated Production
          </h1>
          <p className="text-xl md:text-2xl text-zinc-400 max-w-3xl mx-auto tracking-wide font-light">
            Upload your footage, provide a <span className="text-zinc-200 font-semibold">styling reference</span>, and define the creative direction. Our AI agents will extract the visual aesthetic and map it perfectly to your video grid.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full flex-1">
          <div className="lg:col-span-4 space-y-6 flex flex-col">
            
            {/* Base Video Input */}
            <div className="relative overflow-hidden rounded-[2rem] bg-white/5 border border-white/10 p-1 flex flex-col flex-1 min-h-[220px]">
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
              <div 
                className={`flex-1 w-full rounded-[1.8rem] flex flex-col items-center justify-center p-8 transition-all duration-300 group cursor-pointer border relative overflow-hidden ${videoFile ? 'bg-green-500/10 border-green-500/30' : 'bg-black/40 border-transparent hover:border-white/10 hover:bg-black/20'}`}
                onClick={() => videoInputRef.current?.click()}
              >
                <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className={`p-4 rounded-3xl shadow-inner mb-4 transition-transform duration-300 ${videoFile ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-blue-300 group-hover:scale-110'}`}>
                  {videoFile ? <CheckCircle2 className="w-8 h-8" /> : <Video className="w-8 h-8" />}
                </div>
                <p className="font-semibold text-lg text-white">
                  {videoFile ? 'Video Ready' : 'Upload Base Video'}
                </p>
                <p className="text-sm text-zinc-500 mt-2 text-center truncate max-w-[200px]">
                  {videoFile ? videoFile.name : 'Drag and drop your raw footage'}
                </p>
                <input 
                  type="file" 
                  accept="video/*" 
                  className="hidden" 
                  ref={videoInputRef} 
                  onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            {/* Reference Design Image Array */}
            <div className="relative overflow-hidden rounded-[2rem] bg-white/5 border border-white/10 p-1 flex flex-col flex-1 min-h-[220px]">
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
              <div 
                className={`flex-1 w-full rounded-[1.8rem] flex flex-col items-center justify-center p-8 transition-all duration-300 group cursor-pointer border relative overflow-hidden ${imageFile ? 'bg-green-500/10 border-green-500/30' : 'bg-black/40 border-transparent hover:border-white/10 hover:bg-black/20'}`}
                onClick={() => imageInputRef.current?.click()}
              >
                <div className="absolute inset-0 bg-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className={`p-4 rounded-3xl shadow-inner mb-4 transition-transform duration-300 ${imageFile ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-purple-300 group-hover:scale-110'}`}>
                  {imageFile ? <CheckCircle2 className="w-8 h-8" /> : <ImageIcon className="w-8 h-8" />}
                </div>
                <p className="font-semibold text-lg text-white">
                  {imageFile ? 'Design Ready' : 'Reference Image'}
                </p>
                <p className="text-sm text-zinc-500 mt-2 text-center truncate max-w-[200px] text-balance">
                  {imageFile ? imageFile.name : 'The Vision Agent will extract fonts, colors, and shadows.'}
                </p>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  ref={imageInputRef} 
                  onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

          </div>

          <div className="lg:col-span-5 flex flex-col gap-6">
            <div className="flex-1 relative rounded-[2rem] bg-white/5 border border-white/10 overflow-hidden flex flex-col p-1 shadow-2xl backdrop-blur-3xl">
              <div className="flex-1 w-full bg-black/40 rounded-[1.8rem] flex flex-col p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-xl bg-orange-500/20 text-orange-400">
                    <Wand2 className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-semibold tracking-wide">Creative Orchestrator</h2>
                </div>
                <textarea 
                  className="w-full flex-1 bg-transparent text-white placeholder-zinc-600 resize-none outline-none text-xl leading-relaxed tracking-wide"
                  style={{ fieldSizing: "content" }}
                  placeholder="E.g., 'Put a hype synthwave track in the background and intercut with vintage computing B-roll when I talk about old software...'"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            </div>

            <button 
              onClick={handleGenerate}
              disabled={isGenerating || !videoFile || !imageFile}
              className="w-full relative group overflow-hidden rounded-[2rem] p-1 bg-gradient-to-r from-zinc-500 to-zinc-400 text-black font-semibold text-xl transition-all hover:scale-[1.01] active:scale-[0.99] shadow-[0_0_40px_rgba(255,255,255,0.1)] hover:shadow-[0_0_60px_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
            >
              <div className="w-full bg-white rounded-[1.8rem] py-5 px-8 flex items-center justify-center gap-3 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-slate-100 to-white opacity-0 group-hover:opacity-100 transition-opacity" />
                {generationPhase === "extracting" ? (
                  <>
                    <span className="w-6 h-6 rounded-full border-[3px] border-black/20 border-t-black animate-spin relative z-10" />
                    <span className="relative z-10 font-bold">Extracting Assets...</span>
                  </>
                ) : generationPhase === "rendering" ? (
                  <>
                    <span className="w-6 h-6 rounded-full border-[3px] border-black/20 border-t-black animate-spin relative z-10" />
                    <span className="relative z-10 font-bold">Cloud Rendering: {renderProgress}%</span>
                    <div className="absolute bottom-0 left-0 h-1 bg-blue-500 transition-all duration-300" style={{ width: `${renderProgress}%` }} />
                  </>
                ) : generationPhase === "done" ? (
                  <>
                    <CheckCircle2 className="w-6 h-6 text-green-600 relative z-10" />
                    <span className="relative z-10 font-bold tracking-wide text-green-700">Pipeline Complete! ✓</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-6 h-6 relative z-10" />
                    <span className="relative z-10 font-bold tracking-wide">Initiate AWS Render Pipeline</span>
                  </>
                )}
              </div>
            </button>
          </div>

          <div className="lg:col-span-3">
             <div className="h-full relative overflow-hidden rounded-[2rem] bg-white/5 border border-white/10 p-1 flex flex-col">
              <div className="flex-1 w-full bg-[#0a0a0a] rounded-[1.8rem] flex flex-col items-center justify-center p-8 border border-white/5 group relative overflow-hidden text-center">
                 <div className="absolute top-0 right-0 p-4">
                    <span className="bg-blue-500/20 text-blue-300 text-xs font-bold px-3 py-1 rounded-full border border-blue-500/30 uppercase tracking-widest">AWS Lambda</span>
                 </div>
                 {finalVideoUrl ? (
                   <div className="flex flex-col items-center justify-center w-full h-full gap-4">
                     <video src={finalVideoUrl} controls className="w-full rounded-xl border border-white/10 shadow-2xl max-h-[300px]" />
                     <a href={finalVideoUrl} download className="text-blue-400 hover:text-blue-300 text-sm font-semibold underline">
                       Download Master Edit
                     </a>
                   </div>
                 ) : (
                   <>
                     <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-6 shadow-2xl relative">
                        <div className="absolute w-full h-full bg-white/10 rounded-full animate-ping opacity-20" />
                        <PlayCircle className="w-8 h-8 text-zinc-400 pl-1" />
                     </div>
                     <h3 className="text-xl font-semibold mb-2 text-zinc-200">Cloud Output</h3>
                     <p className="text-zinc-500 text-sm leading-relaxed">
                       Once extraction and AWS cloud rendering are complete, your final generated MP4 will appear here for download.
                     </p>
                   </>
                 )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
