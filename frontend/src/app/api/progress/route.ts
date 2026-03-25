import { NextRequest, NextResponse } from "next/server";
import { getRenderProgress } from "@remotion/lambda";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const renderId = searchParams.get("renderId");
    const bucketName = searchParams.get("bucketName");

    if (!renderId || !bucketName) {
      return NextResponse.json({ error: "Missing renderId or bucketName" }, { status: 400 });
    }

    const progress = await getRenderProgress({
      renderId,
      bucketName,
      functionName: "remotion-render-4-0-438-mem2048mb-disk2048mb-900sec",
      region: "us-east-1",
    });

    return NextResponse.json(progress);
  } catch (error: any) {
    console.error("Failed to get render progress:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
