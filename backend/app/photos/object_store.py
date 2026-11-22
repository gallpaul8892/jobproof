"""ObjectStore: private object storage for uploaded photos (S3 on AWS, moto or SeaweedFS locally).

A Protocol with one product, kept because tests substitute it and the boundary is a network
service. Credentials come from the environment (the task role on AWS, dummy keys locally); the
endpoint settings are only ever set locally.
"""

from typing import Any, Protocol

import boto3
from botocore.config import Config


class ObjectStore(Protocol):
    def put(self, key: str, body: bytes, content_type: str) -> None: ...

    def delete(self, key: str) -> None: ...

    def presign_get(self, key: str, ttl_seconds: int) -> str: ...


class S3ObjectStore:
    def __init__(
        self,
        *,
        bucket: str,
        region: str,
        endpoint_url: str | None = None,
        public_endpoint_url: str | None = None,
        addressing_style: str = "virtual",
    ) -> None:
        self._bucket = bucket
        config = Config(
            signature_version="s3v4",
            s3={"addressing_style": addressing_style},
            connect_timeout=5,
            read_timeout=30,
            retries={"max_attempts": 3, "mode": "standard"},
        )
        self._client: Any = boto3.client(
            "s3", region_name=region, endpoint_url=endpoint_url, config=config
        )
        # Presigned URLs are opened by browsers and phones, which may reach the store under a
        # different host than the backend does (compose: `photos:8333` inside, `localhost:8333`
        # outside). Signing makes no network call, so a second client is all that is needed.
        public = public_endpoint_url or endpoint_url
        self._signer: Any = (
            self._client
            if public == endpoint_url
            else boto3.client("s3", region_name=region, endpoint_url=public, config=config)
        )

    def put(self, key: str, body: bytes, content_type: str) -> None:
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
            ContentDisposition="inline",
            ServerSideEncryption="AES256",
        )

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=key)

    def presign_get(self, key: str, ttl_seconds: int) -> str:
        url: str = self._signer.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=ttl_seconds,
        )
        return url

    def ensure_bucket(self) -> None:
        """Create the bucket if it is missing (local development only)."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except self._client.exceptions.ClientError:
            region = self._client.meta.region_name
            if region == "us-east-1":
                self._client.create_bucket(Bucket=self._bucket)
            else:
                self._client.create_bucket(
                    Bucket=self._bucket,
                    CreateBucketConfiguration={"LocationConstraint": region},
                )
