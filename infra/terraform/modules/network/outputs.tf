output "vpc_id" {
  value = aws_vpc.this.id
}

output "vpc_cidr" {
  value = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "app_subnet_ids" {
  description = "Private subnets: the internal ALB, and the Fargate tasks when there is a NAT."
  value       = aws_subnet.app[*].id
}

output "db_subnet_ids" {
  value = aws_subnet.db[*].id
}

output "task_subnet_ids" {
  description = "Where Fargate tasks run: public subnets without a NAT (dev), private app subnets with one (prod)."
  value       = var.enable_nat_gateway ? aws_subnet.app[*].id : aws_subnet.public[*].id
}

output "task_assign_public_ip" {
  description = "true when tasks run in public subnets (dev). Outbound only: the task security group admits only the ALB."
  value       = !var.enable_nat_gateway
}
