// Read .env so this script picks up the same AWS credentials the worker uses.
process.loadEnvFile();

import {
  ServiceQuotasClient,
  GetServiceQuotaCommand,
  RequestServiceQuotaIncreaseCommand,
  ListRequestedServiceQuotaChangeHistoryCommand,
} from '@aws-sdk/client-service-quotas';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

// AWS quota for "Concurrent executions" of Lambda functions, per region.
// Default for new accounts is 10. Established accounts get 1000. We want
// at least 1000 so renderMediaOnLambda can fan out properly.
const SERVICE_CODE = 'lambda';
const QUOTA_CODE = 'L-B99A9384';
const TARGET_VALUE = 1000;
const REGION = process.env.AWS_REGION ?? 'us-east-1';

async function main() {
  // Identify the account so the user knows which AWS account this hits.
  const sts = new STSClient({ region: REGION });
  const caller = await sts.send(new GetCallerIdentityCommand({}));
  console.log(`account: ${caller.Account} (${caller.Arn})`);
  console.log(`region:  ${REGION}`);
  console.log('');

  const sq = new ServiceQuotasClient({ region: REGION });

  // Read the current value (and the AWS-side default).
  const current = await sq.send(
    new GetServiceQuotaCommand({ ServiceCode: SERVICE_CODE, QuotaCode: QUOTA_CODE }),
  );
  const value = current.Quota?.Value ?? 0;
  console.log(`current "Concurrent executions" quota: ${value}`);

  if (value >= TARGET_VALUE) {
    console.log(`already >= ${TARGET_VALUE} — nothing to request.`);
    process.exit(0);
  }

  // Check if there's already a pending request so we don't double-submit.
  const history = await sq.send(
    new ListRequestedServiceQuotaChangeHistoryCommand({
      ServiceCode: SERVICE_CODE,
      Status: 'PENDING',
    }),
  );
  const existing = (history.RequestedQuotas ?? []).find((r) => r.QuotaCode === QUOTA_CODE);
  if (existing) {
    console.log(
      `pending request already exists: id=${existing.Id}, desired=${existing.DesiredValue}, status=${existing.Status}`,
    );
    process.exit(0);
  }

  // Submit the increase request. AWS auto-approves for low values within
  // a few minutes for established accounts. Newer accounts may need
  // human review and can take hours.
  console.log(`requesting increase to ${TARGET_VALUE}...`);
  const result = await sq.send(
    new RequestServiceQuotaIncreaseCommand({
      ServiceCode: SERVICE_CODE,
      QuotaCode: QUOTA_CODE,
      DesiredValue: TARGET_VALUE,
    }),
  );
  console.log('request submitted:');
  console.log(`  id:     ${result.RequestedQuota?.Id}`);
  console.log(`  status: ${result.RequestedQuota?.Status}`);
  console.log(`  case:   ${result.RequestedQuota?.CaseId ?? '(none yet)'}`);
  console.log('');
  console.log('Track status in the AWS console:');
  console.log(`  https://${REGION}.console.aws.amazon.com/servicequotas/home/services/${SERVICE_CODE}/quotas/${QUOTA_CODE}`);
}

main().catch((err) => {
  console.error('quota request failed:', err.message ?? err);
  process.exit(1);
});
