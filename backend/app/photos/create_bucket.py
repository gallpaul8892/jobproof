"""One-shot: create the local photos bucket (compose `photos-init`, scripts/dev.sh).

Uses the same settings as the backend. Refuses to run against AWS (staging, production), where
Terraform owns the bucket.
"""

import sys

from app.config import get_settings
from app.photos.object_store import S3ObjectStore


def main() -> int:
    settings = get_settings()
    if settings.app_env not in ("local", "test") or settings.photo_bucket is None:
        print("create_bucket is for local development only", file=sys.stderr)
        return 1
    S3ObjectStore(
        bucket=settings.photo_bucket,
        region=settings.aws_region,
        endpoint_url=settings.photo_s3_endpoint_url,
        public_endpoint_url=settings.photo_s3_public_endpoint_url,
        addressing_style=settings.photo_s3_addressing_style,
    ).ensure_bucket()
    print(f"bucket {settings.photo_bucket} is ready")
    return 0


if __name__ == "__main__":
    sys.exit(main())
