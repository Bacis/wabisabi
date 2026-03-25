import { renderMediaOnLambda, getRenderProgress } from "@remotion/lambda";
import fs from "fs";

async function run() {
    try {
        const manifest = JSON.parse(fs.readFileSync("/Users/bacis/Dev/hopecore-stuff/renderer/src/mock_manifest.json", "utf-8"));
        
        console.log("Triggering Lambda...");
        const { renderId, bucketName } = await renderMediaOnLambda({
            region: "us-east-1",
            functionName: "remotion-render-4-0-438-mem2048mb-disk2048mb-900sec",
            serveUrl: "wabisabi",
            composition: "WabisabiManifest",
            inputProps: manifest,
            codec: "h264",
            outName: {
              bucketName: "remotionlambda-useast1-rvopuqxbxi",
              key: `renders/test_${Date.now()}.mp4`,
            },
            imageFormat: "jpeg",
            maxRetries: 1,
            privacy: "public",
        });

        console.log(`Render started: ${renderId}`);
        let done = false;
        while (!done) {
            await new Promise(r => setTimeout(r, 2000));
            const progress = await getRenderProgress({
                renderId,
                bucketName,
                functionName: "remotion-render-4-0-438-mem2048mb-disk2048mb-900sec",
                region: "us-east-1",
            });
            console.log(`Progress: ${progress.renderProgress * 100}%`);
            if (progress.fatalErrorEncountered) {
                console.log("FATAL:", JSON.stringify(progress.errors, null, 2));
                done = true;
            }
            if (progress.done) {
                console.log("Done!", progress.outputFile);
                done = true;
            }
        }
    } catch (e) {
        console.error(e);
    }
}
run();
