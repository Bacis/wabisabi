import { getRenderProgress } from "@remotion/lambda";

async function run() {
    const progress = await getRenderProgress({
        renderId: "1xkgwf0hyx",
        bucketName: "remotionlambda-useast1-rvopuqxbxi",
        functionName: "remotion-render-4-0-438-mem2048mb-disk2048mb-900sec",
        region: "us-east-1",
    });
    console.log(JSON.stringify(progress, null, 2));
}
run();
