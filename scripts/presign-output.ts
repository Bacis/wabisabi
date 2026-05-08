import '../src/env.js';
import { presignOutputUrl } from '../src/lib/s3Outputs.js';

async function main() {
  const uri = process.argv[2];
  if (!uri) {
    console.error('usage: tsx scripts/presign-output.ts s3://...');
    process.exit(1);
  }
  const url = await presignOutputUrl(uri);
  console.log(url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
