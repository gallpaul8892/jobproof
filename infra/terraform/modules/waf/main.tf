# WAF web ACL for CloudFront (prod only, decision P6; spec section 3, `waf`).
# MUST be created with a provider configured for us-east-1: a CLOUDFRONT-scope ACL exists only
# there. The env passes `providers = { aws = aws.us_east_1 }`.

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "JobProof CloudFront: sign-in rate limit and the AWS common rule set"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Sign-in hashing is deliberately slow, so a flood of sign-ins could overload a small prod.
  rule {
    name     = "login-rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = var.login_rate_limit
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300

        scope_down_statement {
          and_statement {
            statement {
              byte_match_statement {
                search_string         = "/api/v1/auth/login"
                positional_constraint = "EXACTLY"

                field_to_match {
                  uri_path {}
                }

                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }

            statement {
              byte_match_statement {
                search_string         = "POST"
                positional_constraint = "EXACTLY"

                field_to_match {
                  method {}
                }

                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-login-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common-rule-set"
    priority = 2

    override_action {
      dynamic "count" {
        for_each = var.managed_rules_mode == "count" ? [1] : []
        content {}
      }
      dynamic "none" {
        for_each = var.managed_rules_mode == "block" ? [1] : []
        content {}
      }
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}
