"use client";

import { useState, useRef } from "react";
import { Upload, Image as ImageIcon, Video, Wand2, PlayCircle, Settings2, Sparkles, CheckCircle2, Info } from "lucide-react";

export default function Home() {
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [connectMusic, setConnectMusic] = useState(true);
  const [bRollLimit, setBRollLimit] = useState(10);
  const [outputFormat, setOutputFormat] = useState("9:16 Vertical");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<"idle" | "extracting" | "rendering" | "done">("idle");
  const [renderProgress, setRenderProgress] = useState(0);
  const [backendDetails, setBackendDetails] = useState<any>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    if (videoFiles.length === 0 || imageFiles.length === 0) {
      alert("Please upload at least one video and one reference image!");
      return;
    }
    
    setIsGenerating(true);
    setGenerationPhase("extracting");
    setFinalVideoUrl(null);
    setRenderProgress(0);
    setBackendDetails(null);

    try {
      const formData = new FormData();
      videoFiles.forEach(v => formData.append("videos", v));
      imageFiles.forEach(img => formData.append("ref_images", img));
      formData.append("prompt", prompt);
      formData.append("connect_music", connectMusic.toString());
      formData.append("external_videos_amount", bRollLimit.toString());
      formData.append("output_format", outputFormat);

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
        
        if (statusData.details) {
          setBackendDetails(statusData.details);
        }
        
        if (statusData.status === "failed") throw new Error(statusData.error_message || "Pipeline extraction failed.");
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

  const stylePresets = [
    { label: "Fast & energetic", text: "Make it fast-paced and energetic. Add rapid B-roll on key concepts." },
    { label: "Cinematic lo-fi", text: "Give it a cinematic, moody lo-fi aesthetic. Slow zooms and chill vibes." },
    { label: "Professional corporate", text: "Keep it clean and professional. Minimalist text and crisp B-roll." },
    { label: "Imperfect & organic", text: "Raw, organic feel. Minimal text, let the emotion speak for itself." },
  ];

  const hookStrategies = [
    { label: "Hook: Question", text: "Start with a thought-provoking question to hook the viewer." },
    { label: "Hook: Controversial", text: "Open with a bold or controversial statement to stop the scroll." },
    { label: "Hook: Story", text: "Begin with 'Here is the story of how...' to build narrative intrigue." }
  ];

  return (
    <main className="min-h-screen bg-[#121110] text-[#EBE5DF] relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[#4E443A]/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-[#2A3125]/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-12 flex flex-col items-center min-h-screen">
        <div className="text-center mb-10 space-y-6 pt-8 w-full max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-stone-800/50 border border-stone-700/50 backdrop-blur-md text-sm font-medium text-stone-300 shadow-xl">
            <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
            Wabisabi AI
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-[#F5F2EC] via-[#D1C9BE] to-[#8C8377] pb-2 text-balance leading-tight">
            Create Viral Shorts in Seconds
          </h1>
          <p className="text-xl md:text-2xl text-stone-400 tracking-wide font-light text-balance leading-relaxed">
            Upload raw clips, inspire the AI with your brand style, and automatically generate highly-engaging vertical short drops.
          </p>
          
          {/* Demo Video Section for immediate social proof/example */}
          <div className="w-full mt-10 mb-6 bg-[#1A1918] rounded-3xl border border-stone-800/50 shadow-2xl overflow-hidden flex flex-col md:flex-row shadow-[0_0_40px_rgba(0,0,0,0.4)]">
             <div className="w-full md:w-1/2 p-8 md:p-10 flex flex-col justify-center text-left">
                <span className="text-amber-500/80 font-bold tracking-widest uppercase text-xs mb-3">See it in action</span>
                <h2 className="text-3xl font-semibold mb-4 text-[#EBE5DF]">100% AI Generated</h2>
                <p className="text-stone-400 mb-6 font-light leading-relaxed">Watch how our pipeline transforms unedited footage into a viral-ready asset with automatic B-roll, dynamic stylized captions, and trending audio.</p>
                <div className="flex gap-4 items-center">
                  <div className="flex -space-x-3">
                    <img src="https://i.pravatar.cc/100?img=1" className="w-10 h-10 rounded-full border-2 border-[#1A1918] z-30" />
                    <img src="https://i.pravatar.cc/100?img=2" className="w-10 h-10 rounded-full border-2 border-[#1A1918] z-20" />
                    <img src="https://i.pravatar.cc/100?img=3" className="w-10 h-10 rounded-full border-2 border-[#1A1918] z-10" />
                  </div>
                  <div className="text-sm text-stone-400"><span className="text-stone-200 font-semibold">10k+</span> creators</div>
                </div>
             </div>
             <div className="w-full md:w-1/2 bg-black relative max-h-[400px] flex items-center justify-center overflow-hidden">
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#1A1918] to-transparent z-10 pointer-events-none" />
                <video src="https://s3.us-east-1.amazonaws.com/remotionlambda-useast1-rvopuqxbxi/renders/wabisabi_export_1774459550586.mp4" autoPlay muted loop playsInline className="w-full h-full object-cover opacity-90 scale-105" />
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full flex-1">
          <div className="lg:col-span-4 space-y-6 flex flex-col">
            
            {/* Base Video Input */}
            <div className="relative overflow-hidden rounded-[2rem] bg-[#1A1918] border border-stone-800 p-1 flex flex-col flex-1 min-h-[260px] shadow-lg">
              <div className="absolute inset-0 bg-gradient-to-br from-stone-800/10 to-transparent pointer-events-none" />
              <div 
                className={`flex-1 w-full rounded-[1.8rem] flex flex-col items-center justify-center p-8 transition-all duration-300 group cursor-pointer border relative overflow-hidden ${videoFiles.length > 0 ? 'bg-sage-900/10 border-green-800/30' : 'bg-black/20 border-transparent hover:border-stone-700/50 hover:bg-stone-900/40'}`}
                onClick={() => videoInputRef.current?.click()}
              >
                <div className={`p-4 rounded-3xl shadow-inner mb-4 transition-transform duration-300 ${videoFiles.length > 0 ? 'bg-green-900/30 text-green-400' : 'bg-stone-800/50 text-stone-300 group-hover:scale-110'}`}>
                  {videoFiles.length > 0 ? <CheckCircle2 className="w-8 h-8" /> : <Upload className="w-8 h-8" />}
                </div>
                <p className="font-semibold text-lg text-stone-200">
                  {videoFiles.length > 0 ? `${videoFiles.length} Clips Ready` : 'Upload Raw Footage'}
                </p>
                {videoFiles.length > 0 ? (
                  <div className="mt-4 flex flex-col items-center gap-3 relative z-10 w-full">
                    <div className="flex gap-2">
                       <button className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 rounded-full text-xs font-semibold text-stone-200 transition-all shadow-md"
                         onClick={(e) => { e.stopPropagation(); videoInputRef.current?.click(); }}
                       >
                         + Add More
                       </button>
                       <button className="px-4 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-300/80 rounded-full text-xs font-semibold transition-all shadow-md"
                         onClick={(e) => { e.stopPropagation(); setVideoFiles([]); if (videoInputRef.current) videoInputRef.current.value = ''; }}
                       >
                         Clear
                       </button>
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center mt-3">
                      {videoFiles.map(v => (
                        <div key={v.name} className="relative w-24 h-14 rounded-lg overflow-hidden border border-stone-700/50 shadow-lg group/thumb bg-black">
                          <video src={URL.createObjectURL(v)} className="w-full h-full object-cover opacity-70 group-hover/thumb:opacity-100 transition-opacity pointer-events-none" />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent pt-4 pb-1 px-1 text-[9px] text-center text-stone-300 truncate font-medium pointer-events-none">
                            {v.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-stone-500 mt-2 text-center text-balance max-w-[200px]">
                    Drag & drop emotional, raw clips up to 60s
                  </p>
                )}
                <input 
                  type="file" 
                  accept="video/*"
                  multiple
                  className="hidden" 
                  ref={videoInputRef} 
                  onChange={(e) => setVideoFiles(prev => [...prev, ...Array.from(e.target.files || [])])}
                />
              </div>
            </div>

            {/* Folded Brand Inspiration Section */}
            <div className="rounded-[1.5rem] bg-[#1A1918] border border-stone-800 p-4 transition-all overflow-hidden flex flex-col">
               <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center justify-between w-full text-left text-sm font-semibold text-stone-300">
                  <div className="flex items-center gap-2">
                     <ImageIcon className="w-4 h-4 text-stone-400" />
                     Brand Inspiration & Design (Optional)
                  </div>
                  <span className="text-lg text-stone-500">{showAdvanced ? '−' : '+'}</span>
               </button>
               {showAdvanced && (
                 <div className="mt-4 pt-4 border-t border-stone-800">
                    <div 
                      className={`w-full rounded-[1rem] flex flex-col items-center justify-center p-6 transition-all duration-300 group cursor-pointer border relative overflow-hidden ${imageFiles.length > 0 ? 'bg-sage-900/10 border-green-800/30' : 'bg-black/20 border-dashed border-stone-700/50 hover:bg-stone-900/40'}`}
                      onClick={() => imageInputRef.current?.click()}
                    >
                      <div className="p-3 rounded-2xl mb-3 bg-stone-800/50 text-stone-400 group-hover:scale-110 transition-transform">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                      {imageFiles.length > 0 ? (
                        <div className="flex flex-col items-center gap-2 relative z-10">
                          <p className="font-semibold text-sm text-stone-200">{imageFiles.length} Styles Uploaded</p>
                          <div className="flex flex-wrap gap-2 justify-center mt-2">
                            {imageFiles.map(i => (
                              <img key={i.name} src={URL.createObjectURL(i)} className="w-10 h-10 rounded-lg object-cover border border-stone-700/50 shadow-md" />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-stone-500 text-center text-balance max-w-[180px]">
                          Upload images to match your desired fonts & colors
                        </p>
                      )}
                      <input type="file" accept="image/*" multiple className="hidden" ref={imageInputRef} onChange={(e) => setImageFiles(prev => [...prev, ...Array.from(e.target.files || [])])} />
                    </div>
                 </div>
               )}
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-6">
            <div className="flex-1 relative rounded-[2rem] bg-[#1A1918] border border-stone-800 overflow-hidden flex flex-col p-1 shadow-lg backdrop-blur-3xl min-h-[300px]">
              <div className="flex-1 w-full bg-[#121110] rounded-[1.8rem] flex flex-col p-6 border border-stone-800/50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-500/80">
                    <Wand2 className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-semibold tracking-wide text-stone-200">Describe Your Vision</h2>
                </div>
                <textarea 
                  className="w-full flex-1 bg-transparent text-stone-100 placeholder-stone-600 resize-none outline-none text-lg leading-relaxed tracking-wide min-h-[120px]"
                  style={{ fieldSizing: "content" }}
                  placeholder="Tell us what you want to create... E.g., 'Make it fast-paced and energetic. Use a trending pop track...'"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />

                {/* Prompt Presets & Hooks Gallery */}
                <div className="mt-4 pt-4 border-t border-stone-800/50">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-widest mb-3 block">Quick-Start Templates</span>
                  <div className="flex overflow-x-auto gap-2 pb-2 custom-scrollbar">
                    {stylePresets.map((preset, idx) => (
                      <button 
                        key={idx}
                        onClick={() => setPrompt(prev => prev ? prev + " " + preset.text : preset.text)}
                        className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-stone-700 bg-stone-800/30 text-xs font-medium text-stone-300 hover:bg-stone-700 hover:text-white transition-colors text-left"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-widest mt-2 mb-2 block">Social Media Hooks</span>
                  <div className="flex overflow-x-auto gap-2 pb-1 custom-scrollbar">
                    {hookStrategies.map((hook, idx) => (
                      <button 
                        key={idx}
                        onClick={() => setPrompt(prev => prev ? prev + " " + hook.text : hook.text)}
                        className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-blue-900/30 bg-blue-900/10 text-xs font-medium text-blue-300/80 hover:bg-blue-900/30 transition-colors text-left"
                      >
                        {hook.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap lg:flex-nowrap bg-[#1A1918] border border-stone-800 rounded-[1.5rem] p-4 gap-4 items-center justify-around shadow-inner">
              <div className="flex items-center gap-3">
                <Settings2 className="w-4 h-4 text-stone-400" />
                <span className="text-sm font-medium text-stone-300">Viral Music</span>
                <input type="checkbox" checked={connectMusic} onChange={(e) => setConnectMusic(e.target.checked)} className="w-5 h-5 ml-1 accent-stone-500 cursor-pointer" />
              </div>
              <div className="w-px h-8 bg-stone-800 hidden lg:block" />
              <div className="flex items-center gap-2 relative group">
                <Video className="w-4 h-4 text-stone-400" />
                <span className="text-sm font-medium text-stone-300 flex items-center gap-1">
                  B-Roll
                  <Info className="w-3 h-3 text-stone-500 cursor-help" />
                </span>
                <input type="number" min="0" max="20" value={bRollLimit} onChange={(e) => setBRollLimit(parseInt(e.target.value) || 0)} className="w-14 bg-[#121110] border border-stone-700 rounded-lg px-2 py-1 text-stone-200 text-center shadow-inner ml-1" />
                
                {/* Tooltip for B-Roll */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-[#2A2928] text-xs text-stone-300 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl border border-stone-700 z-20 text-center">
                  Maximum number of stock video clips to intercut with your footage.
                </div>
              </div>
              <div className="w-px h-8 bg-stone-800 hidden lg:block" />
              <div className="flex items-center gap-2">
                 <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className="bg-[#121110] border border-stone-700 text-sm text-stone-300 rounded-lg px-2 py-1.5 outline-none font-medium cursor-pointer">
                   <option>9:16 Vertical</option>
                   <option>16:9 Landscape</option>
                   <option>1:1 Square</option>
                 </select>
              </div>
            </div>

            {/* CTA Button with expectations */}
            <div className="flex flex-col gap-2">
              <button 
                onClick={handleGenerate}
                disabled={isGenerating || videoFiles.length === 0}
                className="w-full relative group overflow-hidden rounded-[2rem] p-1 bg-gradient-to-r from-[#DFD5C5] to-[#B0A69D] text-black font-semibold text-xl transition-all hover:scale-[1.01] active:scale-[0.99] shadow-[0_0_30px_rgba(223,213,197,0.1)] hover:shadow-[0_0_50px_rgba(223,213,197,0.2)] disabled:from-stone-800 disabled:to-stone-800 disabled:text-stone-500 disabled:hover:scale-100 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <div className="w-full bg-[#EBE5DF] disabled:bg-stone-800 rounded-[1.8rem] py-5 px-8 flex items-center justify-center gap-3 relative overflow-hidden group-disabled:bg-stone-900 border border-transparent group-disabled:border-stone-800">
                  {!isGenerating && videoFiles.length > 0 && <div className="absolute inset-0 bg-gradient-to-r from-white to-[#EBE5DF] opacity-0 group-hover:opacity-100 transition-opacity" />}
                  
                  {generationPhase === "extracting" ? (
                    <>
                      <span className="w-6 h-6 rounded-full border-[3px] border-stone-500/30 border-t-stone-200 animate-spin relative z-10" />
                      <span className="relative z-10 font-bold text-stone-200">Analyzing Content...</span>
                    </>
                  ) : generationPhase === "rendering" ? (
                    <>
                      <span className="w-6 h-6 rounded-full border-[3px] border-stone-500/30 border-t-stone-200 animate-spin relative z-10" />
                      <span className="relative z-10 font-bold text-stone-200">Generating Video: {renderProgress}%</span>
                      <div className="absolute bottom-0 left-0 h-1 bg-amber-600 transition-all duration-300" style={{ width: `${renderProgress}%` }} />
                    </>
                  ) : generationPhase === "done" ? (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-green-600 relative z-10" />
                      <span className="relative z-10 font-bold tracking-wide text-green-700">Video Finished! ✓</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className={`w-6 h-6 relative z-10 ${videoFiles.length === 0 ? 'text-stone-600' : 'text-stone-800'}`} />
                      <span className={`relative z-10 font-bold tracking-wide ${videoFiles.length === 0 ? 'text-stone-500' : 'text-stone-900'}`}>
                        {videoFiles.length === 0 ? 'Upload clips to begin' : 'Generate My Video'}
                      </span>
                    </>
                  )}
                </div>
              </button>
              
              <div className="flex justify-between items-center px-4 text-xs font-medium">
                 <span className={`${videoFiles.length > 0 ? 'text-amber-500/80' : 'text-stone-600'}`}>
                    Free to try — 1 Credit
                 </span>
                 <span className="text-stone-500 flex items-center gap-1">
                    Takes ~2 minutes • Output: {outputFormat}
                 </span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
             <div className="h-full relative overflow-hidden rounded-[2rem] bg-[#1A1918] border border-stone-800 p-1 flex flex-col shadow-lg">
              <div className="flex-1 w-full bg-[#121110] rounded-[1.8rem] flex flex-col items-center justify-center p-8 border border-stone-800/50 group relative overflow-hidden text-center min-h-[400px]">
                 <div className="absolute top-0 right-0 p-4">
                    <span className="bg-stone-800/50 text-stone-400 text-[10px] font-bold px-3 py-1 rounded-full border border-stone-700/50 uppercase tracking-widest">Final Edit</span>
                 </div>
                 {finalVideoUrl ? (
                   <div className="flex flex-col items-center justify-center w-full h-full gap-4">
                     <video src={finalVideoUrl} controls className="w-full rounded-xl border border-stone-800 shadow-2xl mt-4" />
                     <a href={finalVideoUrl} download className="px-4 py-2 bg-stone-200 text-stone-900 rounded-lg text-sm font-bold hover:bg-white transition-colors">
                       Download Master Edit
                     </a>
                   </div>
                 ) : backendDetails ? (
                   <div className="flex flex-col text-left w-full h-full overflow-y-auto pr-2 custom-scrollbar fade-in pt-8">
                     <h3 className="text-xs font-bold text-amber-500/80 uppercase tracking-widest mb-3 border-b border-stone-800 pb-2 flex items-center gap-2">
                       <Sparkles className="w-4 h-4" /> Stage: {backendDetails.stage}
                     </h3>
                     {backendDetails.words_count > 0 && <p className="text-sm text-stone-300 flex items-center gap-2 mt-2"><CheckCircle2 className="w-4 h-4 text-green-700" /> Extracted Words: {backendDetails.words_count}</p>}
                     {backendDetails.broll_fetched !== undefined && <p className="text-sm text-stone-300 flex items-center gap-2 mt-2"><CheckCircle2 className="w-4 h-4 text-green-700" /> B-Roll Extracted: {backendDetails.broll_fetched}</p>}
                     {backendDetails.styles && (
                       <div className="mt-4 bg-stone-900/50 rounded-xl p-3 border border-stone-800">
                         <h4 className="text-[10px] uppercase text-stone-500 font-bold mb-3 tracking-wider">Font Styles</h4>
                         <div className="flex flex-col gap-2">
                           {Object.keys(backendDetails.styles).filter(k => k.startsWith('style_')).map(k => {
                             const s = backendDetails.styles[k];
                             return (
                               <div key={k} style={{ color: s.primaryColor, backgroundColor: s.backgroundColor || 'transparent', fontFamily: s.fontFamily, fontWeight: s.fontWeight, textTransform: s.textTransform }} className="px-3 py-2 rounded-lg text-xs border border-stone-800 shadow-lg text-center break-words">
                                 {k.replace('style_', '')} - {s.primaryColor}
                               </div>
                             )
                           })}
                         </div>
                       </div>
                     )}
                     {backendDetails.manifest && (
                       <div className="mt-4 bg-stone-900/50 rounded-xl p-3 border border-stone-800 text-left">
                         <h4 className="text-[10px] uppercase text-stone-500 font-bold mb-3 tracking-wider">Sequence Sample</h4>
                         <div className="text-xs text-stone-400 pr-2 space-y-2">
                           {backendDetails.manifest.slice(0, 5).map((m: any, idx: number) => (
                             <div key={idx} className="flex gap-2">
                               <span className="text-stone-500 w-10 shrink-0">[{m.timestamp_start?.toFixed(1)}s]</span> 
                               <span className="text-stone-300 truncate w-32">{m.text}</span> 
                               {m.b_roll_search_term && <span className="text-amber-500/70 text-[9px] ml-1 shrink-0">(B-Roll)</span>}
                             </div>
                           ))}
                         </div>
                       </div>
                     )}
                   </div>
                 ) : (
                   <>
                     <div className="w-16 h-16 rounded-full bg-stone-800/50 flex items-center justify-center mb-6 shadow-2xl relative">
                        <div className="absolute w-full h-full bg-stone-700/20 rounded-full animate-ping opacity-20" />
                        <PlayCircle className="w-8 h-8 text-stone-500 pl-1" />
                     </div>
                     <h3 className="text-lg font-semibold mb-2 text-stone-200">Your Masterpiece</h3>
                     <p className="text-stone-500 text-sm leading-relaxed max-w-[200px] text-balance">
                       Your final edited output will appear here.
                     </p>
                   </>
                 )}
              </div>
            </div>
          </div>

        </div>

        {/* Rendered Videos Showcase Grid (Social Proof) */}
        <div className="w-full mt-32 mb-12">
          <div className="flex flex-col items-center justify-center gap-3 mb-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs font-bold text-amber-500 uppercase tracking-widest shadow-xl">
               Creator Showcase
            </div>
            <h2 className="text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-stone-200 via-stone-400 to-stone-600">Built with Wabisabi</h2>
            <p className="text-stone-500 text-lg font-light">Join thousands of creators producing viral-ready content</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div className="rounded-[2.5rem] bg-[#1A1918] border border-stone-800 p-2 overflow-hidden group hover:border-stone-600 transition-all duration-500 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
              <video 
                src="https://s3.us-east-1.amazonaws.com/remotionlambda-useast1-rvopuqxbxi/renders/wabisabi_export_1774459550586.mp4" 
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover rounded-[2rem] bg-black aspect-[9/16] cursor-pointer group-hover:scale-[1.02] transition-transform duration-700" 
              />
            </div>
            <div className="rounded-[2.5rem] bg-[#1A1918] border border-stone-800 p-2 overflow-hidden group hover:border-stone-600 transition-all duration-500 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
              <video 
                src="https://remotionlambda-useast1-rvopuqxbxi.s3.us-east-1.amazonaws.com/renders/wabisabi_export_1774629211794.mp4" 
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover rounded-[2rem] bg-black aspect-[9/16] cursor-pointer group-hover:scale-[1.02] transition-transform duration-700" 
              />
            </div>
            <div className="rounded-[2.5rem] bg-[#1A1918] border border-stone-800 p-8 flex flex-col items-center justify-center text-stone-600 shadow-2xl aspect-[9/16] hidden lg:flex opacity-40">
              <Video className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-medium text-lg text-center">Generate more content</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
