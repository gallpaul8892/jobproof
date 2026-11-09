# infra

The bootstrap template (INFRA-1) and the Terraform modules and environments (INFRA-4, see
[terraform/README.md](terraform/README.md); not yet planned or applied) exist. The plan (awaiting
Paul's approval) is [specs/INFRA-aws-pipeline.md](../specs/INFRA-aws-pipeline.md); the summary and
decisions are in [ARCHITECTURE.md](../ARCHITECTURE.md) section 10.

Decision: **Terraform** (1.17.x, AWS provider `~> 6.72`) for everything except the
per-account bootstrap, which is one CloudFormation file uploaded in the console
(`bootstrap/bootstrap.cfn.yaml`, ticket INFRA-1).

Planned layout:

```
infra/
  bootstrap/bootstrap.cfn.yaml
  terraform/modules/<module>/
  terraform/envs/dev/     # APP_ENV=staging
  terraform/envs/prod/    # APP_ENV=production
  scripts/                # deploy helpers used by the GitHub workflows
```

## Runbook: one-off setup

About 60 to 90 minutes in total, done once. Paul follows this by hand. AWS moves buttons around
from time to time: if a label is slightly different, pick the nearest match, and do not create
anything not listed here.

**Rules that never change:**
- Never paste a password, secret value or access key into a chat, GitHub or a ticket. Account IDs,
  role names, bucket names and web addresses are fine to share.
- You never need an AWS access key. If any guide asks you to create one, stop and ask.
- Always work in **Europe (London) eu-west-2** (top right of the AWS screen).
- Sign in as root only in step A. After step C, always use the access portal.

### A. Create the management account (about 15 minutes)

1. Go to `aws.amazon.com` and click **Create an AWS account**.
2. Root email: an address used only for this account, for example `paul+jobproof-root@yourmail`.
   Account name: `JobProof Management`. Check your inbox and verify the email.
3. Choose a long, unique root password and save it in your password manager.
4. Enter your UK contact address, payment card and phone number. For the support plan choose
   **Basic (free)**.
5. Sign in as root. Click your account name (top right), then **Security credentials**, then
   **Assign MFA device**. Choose a passkey or authenticator app and follow the prompts.
6. In the region selector (top right) choose **Europe (London) eu-west-2**.
7. Search for **Billing and Cost Management**, open **Budgets**, then **Create budget**. Choose
   **Use a template**, then **Monthly cost budget**. Amount 250 (USD), add your email, click
   **Create budget**. It covers all three accounts.
8. Click your account name (top right), then **Account**. Scroll to **IAM user and role access to
   Billing information**, click **Edit**, tick **Activate**, then **Update**.

### B. Create the organisation and the two accounts (about 10 minutes)

1. Search for **AWS Organizations**, click **Create an organization**, and confirm the email AWS
   sends you.
2. Click **Add an AWS account**, then **Create an AWS account**. Name `jobproof-dev`. Email for
   example `paul+jobproof-dev@yourmail`. Leave the role name as `OrganizationAccountAccessRole`.
   Click **Create AWS account**.
3. Do the same for `jobproof-prod` (email `paul+jobproof-prod@yourmail`).
4. Wait until both show **Active**. Write down each 12-digit **Account ID** (not secret).
5. Search for **IAM**, open **Root access management** in the left menu and click **Enable**.
   Tick **Root credentials management**. This removes the root passwords of the two new accounts,
   so nobody can sign in to them as root.

### C. Your everyday sign-in: IAM Identity Center (about 15 minutes)

1. Check the region is London. Search for **IAM Identity Center**, click **Enable**, and choose
   the **organisation** option.
2. Open **Users**, click **Add user**. Username `paul`, then your email and name. Click **Next**,
   then **Add user**. Open the invitation email, set a password and register MFA when asked.
3. Open **Permission sets**, click **Create permission set**, choose **Predefined**, pick
   `AdministratorAccess`, then **Next** and **Create**. Do it again for `ReadOnlyAccess`.
4. Open **AWS accounts**, tick all three accounts, click **Assign users or groups**, choose
   `paul`, tick both permission sets, then **Submit**.
5. Open **Settings**, copy the **AWS access portal URL** and bookmark it. From now on sign in
   there, never as root.
6. Under **Settings**, **Authentication**, **Multi-factor authentication**, click **Configure**
   and choose **Every time they sign in**.

### D. Upload the bootstrap file: dev first, then prod (about 10 minutes each)

Before step 4, look up the two numeric IDs (GitHub CLI, signed in; they identify the account and
the repository permanently, even if either is renamed):

```
gh api users/gallpaul8892 --jq .id        # GitHubOwnerId
gh api repos/gallpaul8892/jobproof --jq .id   # GitHubRepoId
```

The file `infra/bootstrap/bootstrap.cfn.yaml` creates three things only: the GitHub sign-in link,
the bucket that holds Terraform's record of what exists, and two roles GitHub may use. It creates
no keys and no passwords. Details: [bootstrap/README.md](bootstrap/README.md).

1. On GitHub, open `infra/bootstrap/bootstrap.cfn.yaml` and click **Download raw file**.
2. Open your access portal, click **jobproof-dev**, then **AdministratorAccess**. Check the region
   (top right) says **Europe (London)**.
3. Search for **CloudFormation**. Click **Create stack**, then **With new resources (standard)**.
   Choose **Upload a template file**, pick the downloaded file, click **Next**.
4. Stack name: `jobproof-bootstrap`. Parameters: set `Environment` to `dev`. Leave `GitHubOwner`
   as `gallpaul8892`, `GitHubRepo` as `jobproof`. Set `GitHubOwnerId` and `GitHubRepoId` to the
   two numbers from the lookup below (they are not secret, and are required even in `branch`
   mode). Leave `SubjectMode` as `workflow` (choose `branch`
   only if you decided not to allow the GitHub setting in step E2). Click **Next**.
5. On the options page, scroll to **Stack failure options** and leave the defaults. Find
   **Termination protection** and choose **Activated**. Click **Next**.
6. Tick **I acknowledge that AWS CloudFormation might create IAM resources with custom names**,
   then click **Submit**.
7. Wait about 2 minutes, pressing the refresh button, until the status is **CREATE_COMPLETE**.
   Open the **Outputs** tab and copy the `AccountId`, `StateBucketName` and role ARNs somewhere
   safe. None are secret.
8. Repeat steps 2 to 7 in **jobproof-prod**, with `Environment` set to `prod`.

If it fails: click the **Events** tab, find the red **CREATE_FAILED** row and read its reason.
"already exists" for the GitHub sign-in link means that account already had one: tell Claude, do
not delete anything yourself. Click **Delete** on the failed stack (allowed; nothing useful was
made) and ask before retrying. A stack stuck in **ROLLBACK_COMPLETE** must be deleted before you
try again.

### E. GitHub settings (about 5 minutes)

1. Repository **Settings**, **Secrets and variables**, **Actions**, **Variables** tab, then
   **New repository variable**. Name `AWS_DEV_ACCOUNT_ID`, value the dev account ID. Repeat with
   `AWS_PROD_ACCOUNT_ID`. These are the only two values; nothing secret is stored in GitHub.
2. Tie the roles to workflow files (decision P2). GitHub has no button for this, only a command.
   Ask Claude to run it, and allow it when asked. It is run from a terminal with the GitHub CLI,
   signed in as the repository owner:

   ```
   gh api -X PUT repos/gallpaul8892/jobproof/actions/oidc/customization/sub \
     --input - <<'JSON'
   {"include_claim_keys": ["repo", "context", "job_workflow_ref", "repository_owner_id", "repository_id"]}
   JSON
   ```

   Do this **before** the first deploy, and do not change it afterwards without updating both
   bootstrap stacks. To check it: `gh api repos/gallpaul8892/jobproof/actions/oidc/customization/sub`
   should show those five keys, in that order (the order sets the subject, and the stack's trust
   must match it). If you chose not to allow this, you used `SubjectMode=branch` in
   step D and skip this step. (To undo the setting later, send `{"use_default": true}`
   instead.)

### F. Later, once per environment: the first Admin (about 5 minutes)

Available after the first deploy (tickets INFRA-6 and INFRA-7).

1. Open the access portal, choose the account (prod), search **Secrets Manager**, click **Store a
   new secret**, **Other type of secret**, **Plaintext**. Type a password of 12 or more characters
   from your password manager. Name it `jobproof/prod/admin-initial-password`. Leave rotation off
   and click **Store**.
2. On GitHub open the **Actions** tab, choose **Create admin**, click **Run workflow**: environment
   `prod`, your email and full name. It creates the account and deletes that secret.
3. Sign in to prod with that email and password.

To read dev's demo password: dev account, **Secrets Manager**, `jobproof/dev/demo-password`,
**Retrieve secret value**. Read it there; do not copy it anywhere else.

The rest of the runbook (first deploy, rollback, restore, break-glass) arrives with INFRA-6 and
INFRA-7.
