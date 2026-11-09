terraform {
  required_version = ">= 1.17.1, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.72"
    }
    random = {
      # Ephemeral random_password exists from 3.7.0 (verified 2026-11-09; latest seen 3.9.1).
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}
