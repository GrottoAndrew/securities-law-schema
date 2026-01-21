# =============================================================================
# Variables for Evidence Locker Infrastructure
# =============================================================================

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "evidence-locker"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# -----------------------------------------------------------------------------
# Database Configuration
# -----------------------------------------------------------------------------
variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "db_username" {
  description = "Database master username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Database master password"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.db_password) >= 16
    error_message = "Database password must be at least 16 characters."
  }
}

# -----------------------------------------------------------------------------
# Compliance Configuration
# -----------------------------------------------------------------------------
variable "sec_retention_years" {
  description = "SEC Rule 17a-4 retention period in years"
  type        = number
  default     = 7

  validation {
    condition     = var.sec_retention_years >= 7
    error_message = "SEC retention must be at least 7 years."
  }
}

variable "enable_worm_storage" {
  description = "Enable WORM (Write Once Read Many) storage"
  type        = bool
  default     = true
}

# -----------------------------------------------------------------------------
# ECS Configuration
# -----------------------------------------------------------------------------
variable "ecs_task_cpu" {
  description = "CPU units for ECS task"
  type        = number
  default     = 256
}

variable "ecs_task_memory" {
  description = "Memory (MB) for ECS task"
  type        = number
  default     = 512
}

variable "ecs_desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 2
}

# -----------------------------------------------------------------------------
# Domain Configuration
# -----------------------------------------------------------------------------
variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Security Configuration
# -----------------------------------------------------------------------------
variable "jwt_secret" {
  description = "JWT signing secret for API authentication"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.jwt_secret) >= 32
    error_message = "JWT secret must be at least 32 characters."
  }
}
