#!/usr/bin/env bash
# Load the image the `build` job saved and push it to ECR as <repository>:<tag> (INFRA spec 4.3
# step 3.2). Skips the push when the tag already exists (tags are immutable). Prints the digest.
#
#   IMAGE_TAR=... LOCAL_IMAGE=jobproof-backend:<sha> REPOSITORY_URL=<acct>.dkr.ecr.<region>.amazonaws.com/jobproof-backend \
#     TAG=<sha> infra/scripts/push-image.sh
#
# Writes digest=sha256:... to $GITHUB_OUTPUT when set.
set -euo pipefail

die() { printf 'push-image: %s\n' "$*" >&2; exit 1; }

: "${IMAGE_TAR:?}" "${LOCAL_IMAGE:?}" "${REPOSITORY_URL:?}" "${TAG:?}"
AWS_BIN="${AWS_BIN:-aws}"
[[ "$TAG" =~ ^[0-9a-f]{40}$ ]] || die "TAG must be a 40 character commit SHA"
registry="${REPOSITORY_URL%%/*}"
name="${REPOSITORY_URL#*/}"

digest_of() {
  "$AWS_BIN" ecr describe-images --repository-name "$name" --image-ids "imageTag=$TAG" \
    --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true
}

digest="$(digest_of)"
if [[ "$digest" == sha256:* ]]; then
  echo "push-image: $name:$TAG is already in ECR ($digest); nothing to push"
else
  [ -s "$IMAGE_TAR" ] || die "$IMAGE_TAR not found"
  trap 'docker logout "$registry" >/dev/null 2>&1 || true' EXIT
  "$AWS_BIN" ecr get-login-password | docker login --username AWS --password-stdin "$registry" >/dev/null
  docker load -i "$IMAGE_TAR"
  docker tag "$LOCAL_IMAGE" "$REPOSITORY_URL:$TAG"
  docker push "$REPOSITORY_URL:$TAG"
  digest="$(digest_of)"
  [[ "$digest" == sha256:* ]] || die "the image was pushed but its digest could not be read"
  echo "push-image: pushed $name:$TAG ($digest)"
fi
[ -z "${GITHUB_OUTPUT:-}" ] || echo "digest=$digest" >> "$GITHUB_OUTPUT"
