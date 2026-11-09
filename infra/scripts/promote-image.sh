#!/usr/bin/env bash
# Copy the exact image (by digest) from dev's ECR to prod's ECR; nothing is rebuilt (INFRA spec
# 4.4 step 2). Fails if the copy does not have the same digest.
#
#   SOURCE_REPOSITORY_URL=<dev>.dkr.ecr.<region>.amazonaws.com/jobproof-backend \
#   TARGET_REPOSITORY_URL=<prod>.dkr.ecr.<region>.amazonaws.com/jobproof-backend TAG=<sha> \
#     infra/scripts/promote-image.sh
#
# Runs with the PROD deploy role: dev's repository policy lets that one role pull. One ECR login
# token from the prod account is accepted by both registries.
set -euo pipefail

die() { printf 'promote-image: %s\n' "$*" >&2; exit 1; }

: "${SOURCE_REPOSITORY_URL:?}" "${TARGET_REPOSITORY_URL:?}" "${TAG:?}"
AWS_BIN="${AWS_BIN:-aws}"
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || die "TAG must be a 40 character commit SHA"
src_registry="${SOURCE_REPOSITORY_URL%%/*}"
src_name="${SOURCE_REPOSITORY_URL#*/}"
dst_registry="${TARGET_REPOSITORY_URL%%/*}"
dst_name="${TARGET_REPOSITORY_URL#*/}"
src_account="${src_registry%%.*}"
[[ "$src_account" =~ ^[0-9]{12}$ ]] || die "SOURCE_REPOSITORY_URL does not look like an ECR repository"

src_digest="$("$AWS_BIN" ecr describe-images --registry-id "$src_account" --repository-name "$src_name" \
  --image-ids "imageTag=$TAG" --query 'imageDetails[0].imageDigest' --output text)"
[[ "$src_digest" == sha256:* ]] || die "dev has no image tagged $TAG"
echo "promote-image: dev image $src_name:$TAG is $src_digest"

dst_digest="$("$AWS_BIN" ecr describe-images --repository-name "$dst_name" --image-ids "imageTag=$TAG" \
  --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true)"
if [[ "$dst_digest" == sha256:* ]]; then
  [ "$dst_digest" = "$src_digest" ] || die "prod already has $TAG with a different digest ($dst_digest)"
  echo "promote-image: prod already has it; nothing to copy"
else
  trap 'docker logout "$src_registry" >/dev/null 2>&1 || true; docker logout "$dst_registry" >/dev/null 2>&1 || true' EXIT
  password="$("$AWS_BIN" ecr get-login-password)"
  printf '%s' "$password" | docker login --username AWS --password-stdin "$src_registry" >/dev/null
  printf '%s' "$password" | docker login --username AWS --password-stdin "$dst_registry" >/dev/null
  docker pull "$SOURCE_REPOSITORY_URL@$src_digest"
  docker tag "$SOURCE_REPOSITORY_URL@$src_digest" "$TARGET_REPOSITORY_URL:$TAG"
  docker push "$TARGET_REPOSITORY_URL:$TAG"
  dst_digest="$("$AWS_BIN" ecr describe-images --repository-name "$dst_name" --image-ids "imageTag=$TAG" \
    --query 'imageDetails[0].imageDigest' --output text)"
  [ "$dst_digest" = "$src_digest" ] || die "the copy has digest $dst_digest, not $src_digest"
  echo "promote-image: copied; prod $dst_name:$TAG is $dst_digest"
fi
[ -z "${GITHUB_OUTPUT:-}" ] || echo "digest=$src_digest" >> "$GITHUB_OUTPUT"
