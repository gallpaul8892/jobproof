output "bucket_name" {
  value = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "regional_origin" {
  description = "Virtual-hosted regional origin of presigned URLs, for the CSP img-src."
  value       = "https://${aws_s3_bucket.this.bucket}.s3.${data.aws_region.current.region}.amazonaws.com"
}
