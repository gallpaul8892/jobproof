output "arn" {
  value = aws_lb.this.arn
}

output "arn_suffix" {
  value = aws_lb.this.arn_suffix
}

output "dns_name" {
  value = aws_lb.this.dns_name
}

output "security_group_id" {
  value = aws_security_group.alb.id
}

output "target_group_arn" {
  description = "Waits for the listener, because ECS refuses a target group that no listener uses yet."
  value       = aws_lb_target_group.api.arn

  depends_on = [aws_lb_listener.http]
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.api.arn_suffix
}
