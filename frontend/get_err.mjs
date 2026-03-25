import { getRenderProgress } from "@remotion/lambda";

async function run() {
    const progress = await getRenderProgress({
        renderId: "1xkgwf0hyx",
        bucketName: "remotionlambda-useast1-rvopuqxbxi",
        functionName: "remotion-render-4-0-438-mem2048mb-disk2048mb-120sec",
        region: "us-east-1",
    });
    console.log("FATAL:", progress.fatalErrorEncountered);
    console.log(JSON.stringify(progress.errors, null, 2));
}
run();
