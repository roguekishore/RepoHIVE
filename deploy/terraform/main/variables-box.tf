# Settings of the app box. The memory limits and heap flags are unmeasured defaults.

variable "box_root_volume_gb" {
  type        = number
  description = "Size of the encrypted gp3 root volume. Root and data volumes together stay within 30 GB."
  default     = 12

  validation {
    condition     = var.box_root_volume_gb >= 8 && var.box_root_volume_gb + var.box_data_volume_gb <= 30
    error_message = "box_root_volume_gb must be at least 8, and the root and data volumes together at most 30 GB."
  }
}

variable "box_data_volume_gb" {
  type        = number
  description = "Size of the encrypted gp3 volume that holds SQLite data at /var/lib/repohive."
  default     = 8

  validation {
    condition     = var.box_data_volume_gb >= 1
    error_message = "box_data_volume_gb must be at least 1."
  }
}

variable "web_memory_max_mb" {
  type        = number
  description = "systemd MemoryMax of repohive-web, in MB."
  default     = 768
}

variable "web_node_heap_mb" {
  type        = number
  description = "Node --max-old-space-size of repohive-web, in MB. Keep it below web_memory_max_mb."
  default     = 512

  validation {
    condition     = var.web_node_heap_mb < var.web_memory_max_mb
    error_message = "web_node_heap_mb must be below web_memory_max_mb."
  }
}

variable "worker_memory_max_mb" {
  type        = number
  description = "systemd MemoryMax of repohive-worker, in MB."
  default     = 256
}

variable "worker_node_heap_mb" {
  type        = number
  description = "Node --max-old-space-size of repohive-worker, in MB. Keep it below worker_memory_max_mb."
  default     = 192

  validation {
    condition     = var.worker_node_heap_mb < var.worker_memory_max_mb
    error_message = "worker_node_heap_mb must be below worker_memory_max_mb."
  }
}

variable "caddy_rate_limit_per_minute" {
  type        = number
  description = "Caddy backstop: requests a minute from one client address, over all paths."
  default     = 300

  validation {
    condition     = var.caddy_rate_limit_per_minute >= 1
    error_message = "caddy_rate_limit_per_minute must be at least 1."
  }
}

variable "caddy_rate_limit_api_post_per_minute" {
  type        = number
  description = "Caddy backstop: POST requests a minute from one client address under /api/."
  default     = 30

  validation {
    condition     = var.caddy_rate_limit_api_post_per_minute >= 1
    error_message = "caddy_rate_limit_api_post_per_minute must be at least 1."
  }
}
