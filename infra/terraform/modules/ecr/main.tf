resource "aws_ecr_repository" "this" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last ${var.keep_images} images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.keep_images
      }
      action = { type = "expire" }
    }]
  })
}

locals {
  pull_account_id = var.pull_from_role_arn == "" ? "" : split(":", var.pull_from_role_arn)[4]
}

# Only dev has this (prod's repository admits nothing from outside the account).
resource "aws_ecr_repository_policy" "pull" {
  count = var.pull_from_role_arn == "" ? 0 : 1

  repository = aws_ecr_repository.this.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PromotionPull"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${local.pull_account_id}:root" }
      Action = [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
      ]
      Condition = {
        ArnEquals = { "aws:PrincipalArn" = var.pull_from_role_arn }
      }
    }]
  })
}
