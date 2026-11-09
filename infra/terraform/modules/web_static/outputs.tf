output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "domain_name" {
  description = "dXXXX.cloudfront.net"
  value       = aws_cloudfront_distribution.this.domain_name
}

output "origin" {
  description = "https://<distribution domain>: PUBLIC_API_BASE_URL, CORS_ALLOWED_ORIGINS and the config.js API origin."
  value       = "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "web_bucket_name" {
  value = aws_s3_bucket.web.bucket
}

output "web_bucket_arn" {
  value = aws_s3_bucket.web.arn
}

output "releases_bucket_name" {
  value = aws_s3_bucket.releases.bucket
}

output "releases_bucket_arn" {
  value = aws_s3_bucket.releases.arn
}
