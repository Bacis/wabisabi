import { NextRequest, NextResponse } from "next/server";
import { renderMediaOnLambda, getOrCreateBucket } from "@remotion/lambda";

export async function POST(req: NextRequest) {
  try {
    const { manifest } = await req.json();

    // Default configuration for Remotion Lambda
    const region = "us-east-1";
    const serveUrl = "wabisabi";
    const composition = "WabisabiManifest"; 

    // Find the right bucket
    const { bucketName } = await getOrCreateBucket({ region });

    const { renderId, bucketName: renderBucket } = await renderMediaOnLambda({
      region,
      functionName: "remotion-render-4-0-438-mem2048mb-disk2048mb-900sec", // Auto-generated default func name 
      serveUrl,
      composition,
      inputProps: manifest,
      codec: "h264",
      outName: {
        bucketName: bucketName,
        key: `renders/wabisabi_export_${Date.now()}.mp4`,
      },
      imageFormat: "jpeg",
      maxRetries: 1,
      privacy: "public",
      framesPerLambda: Math.max(30, Math.ceil(((manifest.sequence[manifest.sequence.length - 1]?.timestamp_start || 0) * 30 + 60) / 8)), // Dynamically targets exactly 8 parallel Lambdas purely based on time duration!
    });

    return NextResponse.json({ renderId, bucketName: renderBucket });
  } catch (error: any) {
    console.error("Failed to render on lambda:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
