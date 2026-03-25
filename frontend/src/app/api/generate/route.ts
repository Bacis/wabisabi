import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const video = formData.get("video") as File | null;
    const image = formData.get("image") as File | null;
    const prompt = formData.get("prompt") as string | null;

    if (!video || !image) {
      return NextResponse.json({ error: "Missing required files" }, { status: 400 });
    }

    const backendAssets = path.join(process.cwd(), "..", "backend", "assets");
    
    // Clear old input files to prevent backend from prioritizing them
    try { await unlink(path.join(backendAssets, "input_video.MOV")); } catch (e) {}
    try { await unlink(path.join(backendAssets, "input_video.mp4")); } catch (e) {}

    // Save Video - Force mp4 extension to match main.py fallback logic
    const videoBuffer = Buffer.from(await video.arrayBuffer());
    await writeFile(path.join(backendAssets, "input_video.mp4"), videoBuffer);

    // Save Image
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const imageExt = path.extname(image.name) || ".png";
    await writeFile(path.join(backendAssets, `reference_image${imageExt}`), imageBuffer);

    // Save Prompt
    if (prompt) {
      await writeFile(path.join(backendAssets, "prompt.txt"), prompt);
    }

    // Trigger python backend and wait for it
    const backendDir = path.join(process.cwd(), "..", "backend");
    const venvPython = path.join(backendDir, "venv", "bin", "python");
    
    try {
      const { stdout, stderr } = await execAsync(`"${venvPython}" main.py`, { cwd: backendDir });
      console.log(`Backend stdout:\n${stdout}`);
      if (stderr) console.error(`Backend stderr:\n${stderr}`);
    } catch (e: any) {
      console.error(`Backend pipeline error:`, e);
      return NextResponse.json({ error: "Pipeline failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Pipeline completed" }, { status: 200 });
  } catch (error: any) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
