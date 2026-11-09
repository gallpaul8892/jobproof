output "cloudtrail_bucket" {
  value = aws_s3_bucket.trail.bucket
}

output "guardduty_detector_id" {
  value = var.enable_guardduty ? aws_guardduty_detector.this[0].id : null
}
