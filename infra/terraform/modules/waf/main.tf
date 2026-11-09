# WAF web ACL for CloudFront (prod only, decision P6; spec section 3, `waf`).
# MUST be created with a provider configured for us-east-1: a CLOUDFRONT-scope ACL exists only
# there. The env passes `providers = { aws = aws.us_east_1 }`.

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "JobProof CloudFront: sign-in rate limit and the AWS common rule set (photo upload body-size exception)"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Sign-in hashing is deliberately slow, so a flood of sign-ins could overload a small prod.
  # Scope: every POST under /api/v1/auth/, which includes both password endpoints,
  # POST /api/v1/auth/login (web) and POST /api/v1/auth/sessions (operative device sign-in,
  # T-003b), plus POST /api/v1/auth/sessions/refresh. Refresh shares the same per-IP budget; it
  # is not guessable (256-bit secret) but a legitimate burst of refreshes is far below the
  # limit. The scope is checked by check-scope.sh in this directory; do not narrow the prefix
  # to single paths without updating that check.
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
                # Whole auth prefix, decoded then lowercased, so /api/v1/auth/log%69n and
                # /API/V1/AUTH/Login cannot slip past the login rate limit (decision P6).
                search_string         = "/api/v1/auth/"
                positional_constraint = "STARTS_WITH"

                field_to_match {
                  uri_path {}
                }

                text_transformation {
                  priority = 0
                  type     = "URL_DECODE"
                }

                text_transformation {
                  priority = 1
                  type     = "LOWERCASE"
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

  # T-003 design risk R9. The common rule set's SizeRestrictions_BODY blocks any body over 8 KB.
  # Operative photo upload is PUT /api/v1/operative/jobs/{job_id}/photos/{photo_id}/content
  # (raw JPEG/PNG body, up to 10 MiB, enforced by the API), so it would be blocked as soon as
  # managed_rules_mode is switched from count to block. Two rules therefore evaluate the same
  # common rule set: this one for every request EXCEPT that photo upload, unchanged; the next one
  # only for the photo upload, with SizeRestrictions_BODY forced to count. Every other common
  # rule still applies to photo uploads in the second rule. The match is on the decoded, lowercased
  # path, like the sign-in rule.
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

        scope_down_statement {
          not_statement {
            statement {
              and_statement {
            statement {
              byte_match_statement {
                search_string         = "PUT"
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
            statement {
              byte_match_statement {
                search_string         = "/api/v1/operative/jobs/"
                positional_constraint = "STARTS_WITH"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "URL_DECODE"
                }
                text_transformation {
                  priority = 1
                  type     = "LOWERCASE"
                }
              }
            }
            statement {
              byte_match_statement {
                search_string         = "/photos/"
                positional_constraint = "CONTAINS"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "URL_DECODE"
                }
                text_transformation {
                  priority = 1
                  type     = "LOWERCASE"
                }
              }
            }
            statement {
              byte_match_statement {
                search_string         = "/content"
                positional_constraint = "ENDS_WITH"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "URL_DECODE"
                }
                text_transformation {
                  priority = 1
                  type     = "LOWERCASE"
                }
              }
            }
          }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  # Photo upload only: same rule set, but SizeRestrictions_BODY is count-only (never blocks, still
  # visible in the ${var.name}-common-rules-photo-upload metric and sampled requests). The API
  # itself rejects an oversized photo with 413 photo_too_large before reading the body.
  rule {
    name     = "aws-common-rule-set-photo-upload"
    priority = 3

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

        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }

        scope_down_statement {
          and_statement {
            statement {
              byte_match_statement {
                search_string         = "PUT"
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
            statement {
              byte_match_statement {
                search_string         = "/api/v1/operative/jobs/"
                positional_constraint = "STARTS_WITH"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "URL_DECODE"
                }
                text_transformation {
                  priority = 1
                  type     = "LOWERCASE"
                }
              }
            }
            statement {
              byte_match_statement {
                search_string         = "/photos/"
                positional_constraint = "CONTAINS"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "URL_DECODE"
                }
                text_transformation {
                  priority = 1
                  type     = "LOWERCASE"
                }
              }
            }
            statement {
              byte_match_statement {
                search_string         = "/content"
                positional_constraint = "ENDS_WITH"
                field_to_match {
                  uri_path {}
                }
                text_transformation {
                  priority = 0
                  type     = "URL_DECODE"
                }
                text_transformation {
                  priority = 1
                  type     = "LOWERCASE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common-rules-photo-upload"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}
